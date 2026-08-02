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

const ICON = {
  linkedin: 'https://cdn.simpleicons.org/linkedin/0A66C2',
  facebook: 'https://cdn.simpleicons.org/facebook/1877F2',
  instagram: 'https://cdn.simpleicons.org/instagram/E4405F',
  calendly: 'https://cdn.simpleicons.org/calendly/006BFF',
};

function socialIcons(v, gap = 8) {
  const order = ['linkedin', 'facebook', 'instagram', 'calendly'];
  const links = order.filter((k) => v[k]).map((k) =>
    `<a href="${v[k]}" style="text-decoration:none;margin-right:${gap}px"><img src="${ICON[k]}" width="18" height="18" alt="${k}" style="vertical-align:middle;border:0" /></a>`
  );
  return links.join('');
}

// Round avatar with an accent ring; falls back to nothing if no photo.
function avatar(v, size = 66) {
  if (!v.photo) return '';
  return `<img src="${v.photo}" width="${size}" height="${size}" alt="" style="border-radius:50%;object-fit:cover;display:block;border:2px solid ${ORANGE}" />`;
}

const templates = [
  {
    id: 'elegant-card',
    name: 'Elegant card',
    description: 'Photo with accent ring, a clean vertical divider, and a social row. Modern and balanced.',
    build: (v) => `
<table cellpadding="0" cellspacing="0" role="presentation" style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#111827;font-size:13px;line-height:1.55;border-collapse:collapse">
  <tr>
    ${v.photo ? `<td style="padding-right:18px;vertical-align:middle">${avatar(v, 70)}</td>` : ''}
    <td style="vertical-align:middle;border-left:2px solid ${ORANGE};padding-left:18px">
      <div style="font-size:17px;font-weight:700;color:${NAVY};letter-spacing:.2px">${v.name}</div>
      <div style="color:${ORANGE};font-weight:600;font-size:12px;margin-top:1px">${v.title}</div>
      <div style="color:${MUTED};font-size:12px;margin-top:1px">${v.company}</div>
      <div style="margin-top:8px;font-size:12px;color:#374151">
        ${v.phone ? `<a href="tel:${v.phone}" style="color:#374151;text-decoration:none">${v.phone}</a>&nbsp;&nbsp;` : ''}
        <a href="mailto:${v.email}" style="color:#374151;text-decoration:none">${v.email}</a>
        ${v.website ? `&nbsp;&nbsp;<a href="${v.website}" style="color:${ORANGE};text-decoration:none;font-weight:600">${String(v.website).replace(/^https?:\/\//, '')}</a>` : ''}
      </div>
      ${socialIcons(v) ? `<div style="margin-top:9px">${socialIcons(v)}</div>` : ''}
    </td>
  </tr>
</table>`.trim(),
  },
  {
    id: 'banner-footer',
    name: 'Bold banner',
    description: 'Name and title up top, contacts inline, finished with a gradient brand banner and socials.',
    build: (v) => `
<table cellpadding="0" cellspacing="0" role="presentation" style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#111827;font-size:13px;line-height:1.5;border-collapse:collapse;min-width:360px">
  <tr>
    ${v.photo ? `<td style="padding-right:16px;vertical-align:top">${avatar(v, 60)}</td>` : ''}
    <td style="vertical-align:top">
      <div style="font-size:16px;font-weight:700;color:${NAVY}">${v.name}</div>
      <div style="color:${MUTED};font-size:12px">${v.title} &middot; ${v.company}</div>
      <div style="margin-top:6px;font-size:12px">
        <a href="mailto:${v.email}" style="color:#374151;text-decoration:none">${v.email}</a>
        ${v.phone ? ` &nbsp;|&nbsp; <a href="tel:${v.phone}" style="color:#374151;text-decoration:none">${v.phone}</a>` : ''}
      </div>
      ${socialIcons(v) ? `<div style="margin-top:8px">${socialIcons(v)}</div>` : ''}
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
    description: 'Understated single-column layout with a thin rule and a confidentiality note.',
    build: (v) => `
<table cellpadding="0" cellspacing="0" role="presentation" style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#111827;font-size:13px;line-height:1.55;border-collapse:collapse;max-width:500px">
  <tr>
    ${v.photo ? `<td style="padding-right:16px;vertical-align:middle">${avatar(v, 58)}</td>` : ''}
    <td style="vertical-align:middle">
      <div style="font-size:15px;font-weight:700;color:${NAVY}">${v.name} <span style="color:${MUTED};font-weight:400;font-size:12px">| ${v.title}</span></div>
      <div style="color:${MUTED};font-size:12px;margin-top:2px">${v.company}</div>
      <div style="margin-top:6px;font-size:12px;color:#374151">
        ${v.phone ? `<a href="tel:${v.phone}" style="color:#374151;text-decoration:none">${v.phone}</a> &middot; ` : ''}
        <a href="mailto:${v.email}" style="color:#374151;text-decoration:none">${v.email}</a>
        ${v.website ? ` &middot; <a href="${v.website}" style="color:${ORANGE};text-decoration:none">${String(v.website).replace(/^https?:\/\//, '')}</a>` : ''}
      </div>
      ${socialIcons(v) ? `<div style="margin-top:8px">${socialIcons(v)}</div>` : ''}
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
