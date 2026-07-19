/**
 * Google Places (New) client — Local SEO / Google Business Profile signals.
 *
 * Pulls what a prospect's Google Business Profile looks like to a buyer:
 *   - NAP (Name, Address, Phone) and website — the citation-consistency baseline
 *   - review count + average rating (the strongest map-pack ranking factors)
 *   - a handful of recent reviews, so Claude can summarise sentiment
 *   - business status, opening hours, and a posting-activity signal
 *
 * Honesty note on "posts": the public Places API does NOT expose Google Business
 * Profile posts (Google removed that from the public surface). We therefore do
 * not claim a post count we cannot see. Instead we report review *recency* as a
 * proxy for whether the profile is actively maintained, and label it as such.
 * The report copy must not state a fabricated number of posts.
 *
 * Auth: API key via ?key= (same key as PageSpeed if Places API is enabled on it).
 * Docs verified against https://developers.google.com/maps/documentation/places/web-service
 */

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS_URL = 'https://places.googleapis.com/v1/places/'; // + placeId

// Field mask keeps billing predictable — we ask only for what the report uses.
const DETAIL_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'internationalPhoneNumber',
  'nationalPhoneNumber',
  'websiteUri',
  'rating',
  'userRatingCount',
  'businessStatus',
  'regularOpeningHours',
  'primaryTypeDisplayName',
  'googleMapsUri',
  'reviews',
].join(',');

class GooglePlacesError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GooglePlacesError';
    this.status = status;
  }
}

class GooglePlaces {
  constructor(apiKey) {
    if (!apiKey) throw new Error('Google Places API key is missing. Add it in Admin → Settings.');
    this.apiKey = apiKey;
  }

  async _post(url, body, fieldMask) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GooglePlacesError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    return res.json();
  }

  async _get(url, fieldMask) {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GooglePlacesError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    return res.json();
  }

  /**
   * Find the most likely GBP for this business. We bias the text query with the
   * business name + location, and (if we have it) match the website host so we
   * don't pick a same-named business in another city.
   */
  async findPlace({ businessName, location, website }) {
    const textQuery = [businessName, location].filter(Boolean).join(' ');
    if (!textQuery) return null;

    const data = await this._post(
      SEARCH_URL,
      { textQuery, maxResultCount: 5 },
      'places.id,places.displayName,places.websiteUri,places.formattedAddress'
    );

    const candidates = (data && data.places) || [];
    if (!candidates.length) return null;

    // Prefer a candidate whose website host matches the audited domain.
    if (website) {
      const host = safeHost(website);
      const matched = candidates.find((p) => host && safeHost(p.websiteUri) === host);
      if (matched) return matched.id;
    }
    return candidates[0].id;
  }

  async getDetails(placeId) {
    const url = DETAILS_URL + encodeURIComponent(placeId);
    return this._get(url, DETAIL_FIELDS);
  }

  /**
   * One call from the pipeline. Returns a normalised `local` object shaped for
   * scoring.scoreLocal() plus everything the report template needs to render the
   * Google Maps / GBP section. Never throws for "not found" — returns
   * { enabled:true, gbpFound:false } so the section renders a clean "no profile".
   */
  async getBusinessProfile({ businessName, location, website }) {
    const placeId = await this.findPlace({ businessName, location, website });
    if (!placeId) {
      return { enabled: true, gbpFound: false };
    }

    const d = await this.getDetails(placeId);
    const reviews = Array.isArray(d.reviews) ? d.reviews : [];

    // Review recency: newest review timestamp, used as a maintenance proxy.
    const reviewTimes = reviews
      .map((r) => (r.publishTime ? Date.parse(r.publishTime) : NaN))
      .filter((t) => !isNaN(t));
    const newest = reviewTimes.length ? Math.max(...reviewTimes) : null;
    const daysSinceNewestReview = newest
      ? Math.round((Date.now() - newest) / 86400000)
      : null;

    // NAP consistency vs the audited website host.
    const gbpHost = safeHost(d.websiteUri);
    const siteHost = safeHost(website);
    const websiteMatches = gbpHost && siteHost ? gbpHost === siteHost : null;

    return {
      enabled: true,
      gbpFound: true,
      placeId: d.id,
      googleMapsUri: d.googleMapsUri || null,

      // NAP
      name: (d.displayName && d.displayName.text) || businessName,
      address: d.formattedAddress || null,
      phone: d.internationalPhoneNumber || d.nationalPhoneNumber || null,
      website: d.websiteUri || null,
      websiteMatches,
      category: (d.primaryTypeDisplayName && d.primaryTypeDisplayName.text) || null,

      // Reviews
      rating: typeof d.rating === 'number' ? d.rating : null,
      reviewCount: typeof d.userRatingCount === 'number' ? d.userRatingCount : 0,
      reviews: reviews.slice(0, 5).map((r) => ({
        author: (r.authorAttribution && r.authorAttribution.displayName) || 'A customer',
        rating: r.rating || null,
        text: (r.text && r.text.text) || (r.originalText && r.originalText.text) || '',
        publishTime: r.publishTime || null,
        relativeTime: r.relativePublishTimeDescription || null,
      })),

      // Profile completeness / activity
      businessStatus: d.businessStatus || null,
      hasHours: !!(d.regularOpeningHours && d.regularOpeningHours.weekdayDescriptions),
      openingHours:
        (d.regularOpeningHours && d.regularOpeningHours.weekdayDescriptions) || null,

      // Posting-activity signal (proxy; see file header — NOT a GBP post count).
      daysSinceNewestReview,
      activitySignal:
        daysSinceNewestReview === null
          ? 'unknown'
          : daysSinceNewestReview <= 30
          ? 'active'
          : daysSinceNewestReview <= 90
          ? 'slowing'
          : 'stale',
    };
  }
}

function safeHost(url) {
  if (!url) return null;
  try {
    return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

module.exports = { GooglePlaces, GooglePlacesError };
