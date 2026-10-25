// ---------------------------------------------------------------------------
// NumVerify (apilayer) phone line-type lookup.
//
// One number per request: GET http(s)://apilayer.net/api/validate
//   ?access_key=KEY&number=<E.164 or national>&country_code=US&format=1
//
// Success response fields we use:
//   valid (bool), line_type (mobile|landline|voip|toll_free|...), carrier (str),
//   country_code, location.
// NumVerify is ONE lookup per call (no batch endpoint), so the caller must
// dedupe and cache aggressively — which the Data Cleanup flow does: only new,
// rule-passing, uncached numbers ever reach here.
// ---------------------------------------------------------------------------

// Line types NumVerify may return. We map them to a dialer verdict.
const BAD_LINE_TYPES = new Set(['landline', 'voip', 'toll_free', 'premium_rate', 'shared_cost', 'paging', 'special_services']);
// mobile (and, debatably, 'fixed_line_or_mobile') are the good ones for cold calls.

function lineTypeIsDialable(lt) {
  const t = String(lt || '').toLowerCase();
  if (!t) return null;            // unknown — don't exclude on this alone
  if (t === 'mobile') return true;
  if (BAD_LINE_TYPES.has(t)) return false;
  return null;                     // anything else: treat as unknown
}

// Look up one number. Returns:
//   { ok:true, valid, lineType, carrier, location, raw } on success
//   { ok:false, error } on failure (network/quota/invalid key)
// `useHttps` defaults true (paid plans); the free plan is http-only, so the
// caller can pass false if the key is a free one.
async function lookup(number, { accessKey, countryCode = 'US', useHttps = true } = {}) {
  if (!accessKey) return { ok: false, error: 'No NumVerify access key configured.' };
  const digits = String(number || '').replace(/\D+/g, '');
  if (!digits) return { ok: false, error: 'Empty number.' };
  const scheme = useHttps ? 'https' : 'http';
  const url = `${scheme}://apilayer.net/api/validate?access_key=${encodeURIComponent(accessKey)}&number=${encodeURIComponent(digits)}&country_code=${encodeURIComponent(countryCode)}&format=1`;
  try {
    const resp = await fetch(url, { method: 'GET' });
    const data = await resp.json().catch(() => ({}));
    // NumVerify returns 200 with an `error` object on auth/quota problems.
    if (data && data.success === false && data.error) {
      return { ok: false, error: data.error.info || data.error.type || 'NumVerify error', code: data.error.code };
    }
    return {
      ok: true,
      valid: !!data.valid,
      lineType: data.line_type || null,
      carrier: data.carrier || null,
      location: data.location || null,
      countryCode: data.country_code || null,
      raw: { valid: data.valid, line_type: data.line_type, carrier: data.carrier, country_code: data.country_code, location: data.location },
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'NumVerify request failed' };
  }
}

module.exports = { lookup, lineTypeIsDialable, BAD_LINE_TYPES };
