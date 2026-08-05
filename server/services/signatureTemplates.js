/**
 * Built-in signature templates — elegant, professional, WiseStamp-style. Each is
 * self-contained inline HTML/CSS (email-client safe: tables + inline styles) so
 * it renders consistently across Gmail, Outlook, and Apple Mail.
 *
 * Values: name, title, company, phone, email, website, tagline, disclaimer,
 * photo (avatar or company-logo URL), plus links linkedin/facebook/instagram
 * (company, universal) and calendly (agent's own). Rows render only when a
 * value is present.
 */

const NAVY = '#050A1F';
const ORANGE = '#FF4500';
const ORANGE_LIGHT = '#FF6A00';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';

// Social icons are served from our own domain (see routes/icons.js) so they
// render reliably in the in-app preview and don't depend on a third-party icon
// CDN. Built from APP_URL at render time.
function iconBase() {
  return (process.env.APP_URL || '').replace(/\/+$/, '') + '/api/icons';
}
// Calendly is intentionally NOT in this list: it's shown as a dedicated
// "Book a meeting" button, so including it as a social icon too would be a
// duplicate link.
const ICON_NAMES = ['linkedin', 'facebook', 'instagram'];

// Render the social icons as a single-row table so email clients (and the
// contenteditable preview) can never stack them vertically. Each icon is a
// table cell, not a block element.
function socialIcons(v, size = 22) {
  const base = iconBase();
  const present = ICON_NAMES.filter((k) => v[k]);
  if (present.length === 0) return '';
  const cells = present.map((k) =>
    `<td style="padding:0 6px 0 0"><a href="${v[k]}" target="_blank" style="text-decoration:none"><img src="${base}/${k}.svg" width="${size}" height="${size}" alt="${k}" style="display:block;border:0;width:${size}px;height:${size}px" /></a></td>`
  ).join('');
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse"><tr>${cells}</tr></table>`;
}

// A dedicated Calendly "Book a meeting" button (separate from the icon row) so
// the call-to-action is obvious.
function calendlyButton(v) {
  if (!v.calendly) return '';
  return `<a href="${v.calendly}" target="_blank" style="display:inline-block;background:${ORANGE};color:#fff;text-decoration:none;font-size:11px;font-weight:700;padding:6px 12px;border-radius:6px;font-family:'Segoe UI',Arial,sans-serif">📅 Book a meeting</a>`;
}

// Round avatar. Uses the photo when present; otherwise a coloured circle with
// the person's initials so there's always something in the ring.
function avatar(v, size = 66) {
  if (v.photo) {
    return `<img src="${v.photo}" width="${size}" height="${size}" alt="" style="border-radius:50%;object-fit:cover;display:block;width:${size}px;height:${size}px" />`;
  }
  const initials = String(v.name || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  // Table-based circle so it renders in email clients without CSS flexbox. No
  // border — just a solid navy circle with white initials.
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse"><tr><td width="${size}" height="${size}" align="center" valign="middle" style="width:${size}px;height:${size}px;border-radius:50%;background:${NAVY};color:#fff;font-family:'Segoe UI',Arial,sans-serif;font-size:${Math.round(size * 0.36)}px;font-weight:700;text-align:center">${initials}</td></tr></table>`;
}

const templates = [
  {
    id: 'elegant-card',
    name: 'Elegant card',
    description: 'Photo on the left with an accent ring, a clean vertical divider, and a single-row social bar.',
    build: (v) => `
<table cellpadding="0" cellspacing="0" role="presentation" style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#111827;font-size:13px;line-height:1.55;border-collapse:collapse">
  <tr>
    <td style="padding-right:18px;vertical-align:middle">${avatar(v, 72)}</td>
    <td style="vertical-align:middle;border-left:1px solid ${LINE};padding-left:18px">
      <div style="font-size:17px;font-weight:700;color:${NAVY};letter-spacing:.2px">${v.name}</div>
      <div style="color:${ORANGE};font-weight:600;font-size:12px;margin-top:1px">${v.title}</div>
      <div style="color:${MUTED};font-size:12px;margin-top:1px">${v.company}</div>
      <div style="margin-top:8px;font-size:12px;color:#374151">
        ${v.phone ? `<a href="tel:${v.phone}" style="color:#374151;text-decoration:none">${v.phone}</a>&nbsp;&nbsp;` : ''}
        <a href="mailto:${v.email}" style="color:#374151;text-decoration:none">${v.email}</a>
        ${v.website ? `&nbsp;&nbsp;<a href="${v.website}" style="color:${ORANGE};text-decoration:none;font-weight:600">${String(v.website).replace(/^https?:\/\//, '')}</a>` : ''}
      </div>
      ${socialIcons(v) ? `<div style="margin-top:9px">${socialIcons(v)}</div>` : ''}
      ${v.calendly ? `<div style="margin-top:10px">${calendlyButton(v)}</div>` : ''}
    </td>
  </tr>
</table>`.trim(),
  },
  {
    id: 'banner-footer',
    name: 'Bold banner',
    description: 'Name and title up top, contacts inline, a single-row social bar, finished with a gradient brand banner.',
    build: (v) => `
<table cellpadding="0" cellspacing="0" role="presentation" style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#111827;font-size:13px;line-height:1.5;border-collapse:collapse;min-width:360px">
  <tr>
    <td style="padding-right:16px;vertical-align:top">${avatar(v, 60)}</td>
    <td style="vertical-align:top;border-left:1px solid ${LINE};padding-left:16px">
      <div style="font-size:16px;font-weight:700;color:${NAVY}">${v.name}</div>
      <div style="color:${MUTED};font-size:12px">${v.title} &middot; ${v.company}</div>
      <div style="margin-top:6px;font-size:12px">
        <a href="mailto:${v.email}" style="color:#374151;text-decoration:none">${v.email}</a>
        ${v.phone ? ` &nbsp;|&nbsp; <a href="tel:${v.phone}" style="color:#374151;text-decoration:none">${v.phone}</a>` : ''}
      </div>
      <table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;margin-top:8px"><tr>
        ${socialIcons(v) ? `<td style="padding-right:10px;vertical-align:middle">${socialIcons(v)}</td>` : ''}
        ${v.calendly ? `<td style="vertical-align:middle">${calendlyButton(v)}</td>` : ''}
      </tr></table>
    </td>
  </tr>
  <tr><td colspan="2" style="padding-top:10px">
    <div style="background:linear-gradient(90deg,${ORANGE_LIGHT},${ORANGE});color:#fff;padding:8px 12px;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:.2px">
      ${v.website ? `<a href="${v.website}" style="color:#fff;text-decoration:none">${String(v.website).replace(/^https?:\/\//, '')}</a>` : v.company}
      <span style="opacity:.85;font-weight:400"> &nbsp;&mdash;&nbsp; ${v.tagline}</span>
    </div>
  </td></tr>
</table>`.trim(),
  },
  {
    id: 'minimal-pro',
    name: 'Minimal professional',
    description: 'Understated single-column layout with a thin rule, a single-row social bar, and a confidentiality note.',
    build: (v) => `
<table cellpadding="0" cellspacing="0" role="presentation" style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#111827;font-size:13px;line-height:1.55;border-collapse:collapse;max-width:500px">
  <tr>
    <td style="padding-right:16px;vertical-align:middle">${avatar(v, 58)}</td>
    <td style="vertical-align:middle;border-left:1px solid ${LINE};padding-left:16px">
      <div style="font-size:15px;font-weight:700;color:${NAVY}">${v.name} <span style="color:${MUTED};font-weight:400;font-size:12px">| ${v.title}</span></div>
      <div style="color:${MUTED};font-size:12px;margin-top:2px">${v.company}</div>
      <div style="margin-top:6px;font-size:12px;color:#374151">
        ${v.phone ? `<a href="tel:${v.phone}" style="color:#374151;text-decoration:none">${v.phone}</a> &middot; ` : ''}
        <a href="mailto:${v.email}" style="color:#374151;text-decoration:none">${v.email}</a>
        ${v.website ? ` &middot; <a href="${v.website}" style="color:${ORANGE};text-decoration:none">${String(v.website).replace(/^https?:\/\//, '')}</a>` : ''}
      </div>
      <table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;margin-top:8px"><tr>
        ${socialIcons(v) ? `<td style="padding-right:10px;vertical-align:middle">${socialIcons(v)}</td>` : ''}
        ${v.calendly ? `<td style="vertical-align:middle">${calendlyButton(v)}</td>` : ''}
      </tr></table>
    </td>
  </tr>
  <tr><td colspan="2" style="padding-top:10px">
    <div style="border-top:1px solid ${LINE};padding-top:7px;color:#9ca3af;font-size:10px;line-height:1.45">${v.disclaimer}</div>
  </td></tr>
</table>`.trim(),
  },
];

function values(vals) {
  return {
    name: vals.name || 'Your Name',
    title: vals.title || 'Sales Manager',
    company: vals.company || 'Qtonix',
    phone: vals.phone || '',
    email: vals.email || 'you@qtonix.com',
    website: vals.website || '',
    tagline: vals.tagline || 'Digital Marketing, Web Design & Development',
    disclaimer: vals.disclaimer || 'This email and any attachments are confidential and intended solely for the addressee. If you are not the intended recipient, please notify the sender and delete this message.',
    photo: vals.photo || '',
    linkedin: vals.linkedin || '',
    facebook: vals.facebook || '',
    instagram: vals.instagram || '',
    calendly: vals.calendly || '',
  };
}

function render(template, vals) {
  const v = values(vals);
  return typeof template.build === 'function' ? template.build(v) : '';
}

module.exports = { templates, render, values };
