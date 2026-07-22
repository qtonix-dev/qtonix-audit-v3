/**
 * SE Ranking Data API client.
 *
 * Base URL and auth verified against https://seranking.com/api/data/getting-started
 *   - Auth header:  Authorization: Token <API_KEY>
 *   - Rate limit:   5 requests/second (429 on breach, escalating lockouts)
 *   - Billing:      credits per request/record (noted per method below)
 */

const BASE = 'https://api.seranking.com/v1';

// ---------------------------------------------------------------------------
// Rate limiter: SE Ranking hard-caps at 5 req/sec. Repeated breaches trigger a
// 10-minute block that escalates. We self-limit to 4/sec to stay safe.
// ---------------------------------------------------------------------------
class RateLimiter {
  constructor(perSecond = 4) {
    this.interval = 1000 / perSecond;
    this.last = 0;
    this.queue = Promise.resolve();
  }
  schedule(fn) {
    this.queue = this.queue.then(async () => {
      const wait = Math.max(0, this.last + this.interval - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    return this.queue;
  }
}

const limiter = new RateLimiter(4);

class SERankingError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'SERankingError';
    this.status = status;
    this.body = body;
  }
}

class SERanking {
  constructor(apiKey) {
    if (!apiKey) throw new Error('SE Ranking API key is missing. Add it in Admin → Settings.');
    this.apiKey = apiKey;
  }

  async request(path, params = {}, { method = 'GET', retries = 3 } = {}) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.append(k, String(v));
    }

    return limiter.schedule(async () => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        let res;
        try {
          res = await fetch(url.toString(), {
            method,
            headers: {
              Authorization: `Token ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
          });
        } catch (networkErr) {
          if (attempt === retries) throw new SERankingError(networkErr.message, 0, null);
          await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
          continue;
        }

        // 429 = rate limited. Back off exponentially.
        if (res.status === 429) {
          if (attempt === retries) throw new SERankingError('Rate limited by SE Ranking', 429, null);
          await new Promise((r) => setTimeout(r, 2 ** attempt * 2000));
          continue;
        }

        // 244 = "huge site unsupported" (google.com, twitter.com etc). Not an error we retry.
        if (res.status === 244) return { __unsupported: true };

        const text = await res.text();
        let body;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }

        if (!res.ok) {
          // 400 "Insufficient funds" = out of credits. Surface clearly, don't retry.
          const msg =
            (body && (body.message || body.error || body.detail)) || `HTTP ${res.status}`;
          throw new SERankingError(msg, res.status, body);
        }
        return body;
      }
    });
  }

  /**
   * Account balance / remaining credits. Free (does not consume credits).
   * SE Ranking exposes this on the research-API balance endpoint; shape varies
   * a little between plans so the caller normalises defensively.
   */
  getBalance() {
    return this.request('/balance', {});
  }

  /** Domain overview for one regional DB. Cost: 100 credits. */
  getDomainOverview(domain, source = 'us') {
    return this.request('/domain/overview/db', { source, domain, with_subdomains: 1 });
  }

  /** Worldwide aggregate overview. Cost: 100 credits. */
  getWorldwideOverview(domain, currency = 'USD') {
    return this.request('/domain/overview/worldwide', {
      domain,
      currency,
      fields: 'price,traffic,keywords,positions_diff,positions_tops',
      show_zones_list: 0,
    });
  }

  /** 12-month traffic/keyword history. Cost: 100 credits. */
  getDomainHistory(domain, source = 'us', type = 'organic') {
    return this.request('/domain/overview/history', { source, domain, type });
  }

  /**
   * Keyword rankings. Cost: 100 credits.
   * Returns 16 default cols incl. position, volume, cpc, difficulty, intents, serp_features.
   */
  getDomainKeywords(domain, source = 'us', opts = {}) {
    return this.request('/domain/keywords', {
      source,
      domain,
      type: 'organic',
      limit: opts.limit || 100,
      page: opts.page || 1,
      order_field: opts.orderField || 'traffic',
      order_type: 'desc',
      ...opts.filters,
    });
  }

  /**
   * Keywords where an AI Overview (sge) appears but does NOT cite this domain.
   * This is the GEO/AEO citation-gap opportunity set. Cost: 100 credits.
   */
  getAiOverviewGaps(domain, source = 'us', limit = 50) {
    return this.request('/domain/keywords', {
      source,
      domain,
      type: 'organic',
      limit,
      order_field: 'volume',
      order_type: 'desc',
      'filter[serp_features_2][mode]': 'without_link',
      'filter[serp_features_2][value][0]': 'sge',
    });
  }

  /** Keywords where the AI Overview DOES cite this domain. Cost: 100 credits. */
  getAiOverviewWins(domain, source = 'us', limit = 50) {
    return this.request('/domain/keywords', {
      source,
      domain,
      type: 'organic',
      limit,
      order_field: 'volume',
      order_type: 'desc',
      'filter[serp_features_2][mode]': 'with_link',
      'filter[serp_features_2][value][0]': 'sge',
    });
  }

  /** Striking-distance keywords: positions 11-20. One push from page 1. */
  getStrikingDistance(domain, source = 'us', limit = 50) {
    return this.request('/domain/keywords', {
      source,
      domain,
      type: 'organic',
      limit,
      order_field: 'volume',
      order_type: 'desc',
      'filter[position][from]': 11,
      'filter[position][to]': 20,
    });
  }

  /** Top ranking pages. Cost: 100 credits. */
  getDomainPages(domain, source = 'us', limit = 25) {
    return this.request('/domain/pages', {
      target: domain,
      scope: 'base_domain',
      source,
      type: 'organic',
      order_field: 'traffic_sum',
      order_type: 'desc',
      limit,
    });
  }

  /** Organic competitors, ranked by keyword overlap. Cost: 100 credits. */
  getCompetitors(domain, source = 'us') {
    return this.request('/domain/competitors', { source, domain, type: 'organic' });
  }

  /** Keyword gap vs one competitor. Cost: 100 credits. */
  getKeywordGap(domain, competitor, source = 'us', limit = 50) {
    return this.request('/domain/keywords/comparison', {
      source,
      domain,
      compare: competitor,
      type: 'organic',
      diff: 1, // keywords competitor ranks for, we don't
      limit,
      order_field: 'volume',
      order_type: 'desc',
    });
  }

  /**
   * Backlink summary. Cost: 100 credits/target.
   * NOTE: this family requires apikey as a GET param IN ADDITION to the header.
   */
  getBacklinkSummary(target, mode = 'domain') {
    return this.request('/backlinks/summary', { apikey: this.apiKey, target, mode, output: 'json' });
  }

  /** Lightweight backlink counts. Cost: 10 credits/target — use for competitors. */
  getBacklinkMetrics(target, mode = 'domain') {
    return this.request('/backlinks/metrics', { apikey: this.apiKey, target, mode, output: 'json' });
  }

  /** Referring domains with authority, for the toxic-link split. Cost: 1 credit each. */
  getReferringDomains(target, mode = 'domain', limit = 200) {
    return this.request('/backlinks/refdomains', {
      apikey: this.apiKey,
      target,
      mode,
      limit,
      order_by: 'domain_inlink_rank',
      output: 'json',
    });
  }

  /** Anchor text distribution — over-optimised anchors are a penalty signal. */
  getAnchors(target, mode = 'domain', limit = 25) {
    return this.request('/backlinks/anchors', {
      apikey: this.apiKey,
      target,
      mode,
      limit,
      order_by: 'refdomains',
      output: 'json',
    });
  }

  // -------------------------------------------------------------------------
  // Website Audit (async: create → poll → fetch report)
  // -------------------------------------------------------------------------

  createAudit(domain, title) {
    return this.request(
      '/audit/create',
      { url: domain, title: title || `Qtonix audit — ${domain}` },
      { method: 'POST' }
    );
  }

  getAuditStatus(auditId) {
    return this.request(`/audit/${auditId}/status`);
  }

  getAuditReport(auditId) {
    return this.request(`/audit/${auditId}/report`);
  }

  getAuditPagesByIssue(auditId, code, limit = 25) {
    return this.request(`/audit/${auditId}/pages-by-issue`, { code, limit });
  }

  /** Poll an audit to completion, with a hard ceiling so a job can't hang forever. */
  async waitForAudit(auditId, { timeoutMs = 240000, intervalMs = 10000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.getAuditStatus(auditId);
      const s = (status && (status.status || status.task_status)) || '';
      if (['finished', 'complete', 'done'].includes(String(s).toLowerCase())) return status;
      if (String(s).toLowerCase() === 'failed') throw new SERankingError('Audit failed', 0, status);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new SERankingError('Audit timed out', 0, null);
  }

  /** Remaining credits — surfaced on the admin dashboard. */
  getSubscription() {
    return this.request('/account/subscription');
  }
}

module.exports = { SERanking, SERankingError };
