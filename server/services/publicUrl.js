/**
 * Central builder for absolute PUBLIC URLs, keyed by "surface":
 *   - 'hrms'    → the HR portal              (e.g. people.qtonix.com)
 *   - 'careers' → careers / jobs / task / onboarding pages (career.qtonix.com)
 *   - 'crm'     → the Sales CRM app          (e.g. crmnest.com)
 *   - 'reports' → public Site-Analysis report links (reports.qtonix.com)
 *
 * Admins set these in the Domains settings panel; nothing else in the codebase
 * needs to hard-code a host. Resolution order for each surface:
 *   1. the configured custom domain (Settings.publicDomains[surface])
 *   2. the incoming request's own host (so it "just works" before DNS is set)
 *   3. process.env.APP_URL  (for background jobs with no request in hand)
 *
 * Domains may be stored as a bare host ("career.qtonix.com") or a full origin
 * ("https://career.qtonix.com"); both normalize to a clean https origin.
 */
let _cache = { at: 0, domains: null };
const TTL_MS = 30 * 1000; // brief cache so we don't hit the DB per URL

function normalizeOrigin(value) {
  if (!value) return '';
  let v = String(value).trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { const u = new URL(v); return `${u.protocol}//${u.host}`; } catch { return ''; }
}

async function loadDomains() {
  const now = Date.now();
  if (_cache.domains && now - _cache.at < TTL_MS) return _cache.domains;
  let domains = {};
  try {
    const { Settings } = require('../models');
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    domains = (s && s.publicDomains) || {};
  } catch { domains = {}; }
  _cache = { at: now, domains };
  return domains;
}

// Invalidate the cache immediately after an admin saves new domains.
function clearCache() { _cache = { at: 0, domains: null }; }

function reqOrigin(req) {
  if (!req || typeof req.get !== 'function') return '';
  const proto = (req.headers && req.headers['x-forwarded-proto']) ? String(req.headers['x-forwarded-proto']).split(',')[0].trim() : req.protocol;
  const host = req.get('host');
  return host ? `${proto || 'https'}://${host}` : '';
}

function envOrigin() {
  return normalizeOrigin(process.env.APP_URL || process.env.PUBLIC_URL || '');
}

/**
 * Resolve the base origin for a surface.
 * @param {string} surface one of hrms|careers|crm|reports
 * @param {object} [req] optional Express request for host fallback
 */
async function baseFor(surface, req) {
  const domains = await loadDomains();
  const configured = normalizeOrigin(domains[surface]);
  if (configured) return configured;
  const fromReq = normalizeOrigin(reqOrigin(req));
  if (fromReq) return fromReq;
  return envOrigin();
}

/**
 * Build an absolute URL for a surface + path.
 *   await publicUrl('careers', '/jobs/abc', req) → https://career.qtonix.com/jobs/abc
 */
async function publicUrl(surface, pathname = '/', req) {
  const base = await baseFor(surface, req);
  const p = pathname ? (pathname.startsWith('/') ? pathname : `/${pathname}`) : '';
  return `${base}${p}`;
}

// Synchronous variant when the caller already has the domains map + a fallback
// base in hand (used inside a request where we've already loaded settings).
function join(base, pathname = '/') {
  const b = normalizeOrigin(base) || String(base || '').replace(/\/+$/, '');
  const p = pathname ? (pathname.startsWith('/') ? pathname : `/${pathname}`) : '';
  return `${b}${p}`;
}

module.exports = { publicUrl, baseFor, normalizeOrigin, clearCache, loadDomains, join, reqOrigin, envOrigin };
