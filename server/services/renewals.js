// ---------------------------------------------------------------------------
// Renewal helpers — shared between the deal payment flow and the Converted page.
//
// Some services are contracts that must be re-approached for renewal when the
// term ends. When a deal for one of these is marked paid, the admin records a
// tenure (billing term) and a next-renewal date, which drives the "Upcoming
// Renewals" view and the cross-sell "next renewal date" column.
// ---------------------------------------------------------------------------

// Services whose contracts renew (case-insensitive match on the deal's service).
const RENEWAL_SERVICES = [
  'SEO',
  'AI SEO',
  'Google Ads Campaign',
  'Meta Ads Campaign',
  'Social Media Promotion',
  'Complete Digital Marketing',
  'Website Maintenance',
  'SSL',
  'SSL + Web server',
];

// Valid tenure keys and how many calendar months each adds.
const TENURE_MONTHS = {
  onetime: 0,
  monthly: 1,
  quarterly: 3,
  '6month': 6,
  '1year': 12,
  '2year': 24,
};

const TENURE_LABELS = {
  onetime: 'One time',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  '6month': '6 months',
  '1year': '1 Year',
  '2year': '2 Year',
};

function isRenewalService(service) {
  if (!service) return false;
  const s = String(service).trim().toLowerCase();
  return RENEWAL_SERVICES.some((r) => r.toLowerCase() === s);
}

// The sensible default tenure for a service: Monthly for renewal-eligible
// services, One time otherwise.
function defaultTenure(service) {
  return isRenewalService(service) ? 'monthly' : 'onetime';
}

// Add N calendar months to a YYYY-MM-DD date string, returning YYYY-MM-DD.
// Clamps to the last valid day of the target month (e.g. Jan 31 + 1mo → Feb 28).
function addMonths(dateStr, months) {
  if (!dateStr || !months) return null;
  const base = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// Compute the next renewal date from a payment-received date + tenure key.
// One time (or unknown tenure) → null (no renewal).
function computeRenewalDate(paymentDate, tenure) {
  const months = TENURE_MONTHS[tenure];
  if (!months) return null; // onetime or invalid
  return addMonths(paymentDate, months);
}

module.exports = {
  RENEWAL_SERVICES, TENURE_MONTHS, TENURE_LABELS,
  isRenewalService, defaultTenure, addMonths, computeRenewalDate,
};
