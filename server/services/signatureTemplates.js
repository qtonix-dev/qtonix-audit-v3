/**
 * Built-in, WiseStamp-style signature templates. Each is self-contained inline
 * HTML/CSS (email-client safe: tables + inline styles, no external CSS) with
 * {{placeholder}} tokens the agent fills in. Agents pick one, customise it, and
 * save it as their own signature.
 *
 * Placeholders: name, title, company, phone, email, website, tagline, disclaimer.
 */

const BRAND_NAVY = '#050A1F';
const BRAND_ORANGE = '#FF4500';

const templates = [
  {
    id: 'classic-orange',
    name: 'Classic (orange accent)',
    description: 'Clean two-line name + role with an orange divider and contact row.',
    html: `
<table cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:13px;line-height:1.5">
  <tr>
    <td style="padding-right:16px;border-right:3px solid ${BRAND_ORANGE};vertical-align:top">
      <div style="font-size:16px;font-weight:bold;color:${BRAND_NAVY}">{{name}}</div>
      <div style="color:#6b7280">{{title}} · {{company}}</div>
    </td>
    <td style="padding-left:16px;vertical-align:top">
      <div>📞 <a href="tel:{{phone}}" style="color:#1f2937;text-decoration:none">{{phone}}</a></div>
      <div>✉️ <a href="mailto:{{email}}" style="color:#1f2937;text-decoration:none">{{email}}</a></div>
      <div>🌐 <a href="{{website}}" style="color:${BRAND_ORANGE};text-decoration:none">{{website}}</a></div>
    </td>
  </tr>
</table>`.trim(),
  },
  {
    id: 'simple-green-footer',
    name: 'Simple with footer bar',
    description: 'Minimal name/role with a coloured footer strip and tagline.',
    html: `
<table cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:13px;line-height:1.5;min-width:340px">
  <tr><td style="padding-bottom:6px">
    <div style="font-size:15px;font-weight:bold;color:${BRAND_NAVY}">{{name}}</div>
    <div style="color:#6b7280">{{title}}, {{company}}</div>
    <div style="margin-top:4px">
      <a href="mailto:{{email}}" style="color:#1f2937;text-decoration:none">{{email}}</a> &nbsp;|&nbsp;
      <a href="tel:{{phone}}" style="color:#1f2937;text-decoration:none">{{phone}}</a>
    </div>
  </td></tr>
  <tr><td style="background:${BRAND_NAVY};color:#ffffff;padding:6px 10px;border-radius:4px;font-size:12px">
    <a href="{{website}}" style="color:#ffffff;text-decoration:none;font-weight:bold">{{website}}</a>
    <span style="color:#c7cbd4"> — {{tagline}}</span>
  </td></tr>
</table>`.trim(),
  },
  {
    id: 'with-disclaimer',
    name: 'With confidentiality disclaimer',
    description: 'Contact block plus a small legal/no-virus disclaimer footer.',
    html: `
<table cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:13px;line-height:1.5;max-width:460px">
  <tr><td>
    <div style="font-size:15px;font-weight:bold;color:${BRAND_NAVY}">{{name}}</div>
    <div style="color:#6b7280">{{title}} · {{company}}</div>
    <div style="margin-top:4px">
      <a href="tel:{{phone}}" style="color:#1f2937;text-decoration:none">{{phone}}</a> ·
      <a href="mailto:{{email}}" style="color:#1f2937;text-decoration:none">{{email}}</a> ·
      <a href="{{website}}" style="color:${BRAND_ORANGE};text-decoration:none">{{website}}</a>
    </div>
  </td></tr>
  <tr><td style="padding-top:8px">
    <div style="border-top:1px solid #e5e7eb;padding-top:6px;color:#9ca3af;font-size:10px;line-height:1.4">{{disclaimer}}</div>
  </td></tr>
</table>`.trim(),
  },
];

// Default placeholder values used when an agent picks a template — filled with
// what we know so the preview looks real immediately.
function fill(html, vals) {
  const v = {
    name: vals.name || 'Your Name',
    title: vals.title || 'Sales Manager',
    company: vals.company || 'Qtonix',
    phone: vals.phone || '+1 (000) 000-0000',
    email: vals.email || 'you@qtonix.com',
    website: vals.website || 'https://qtonix.com',
    tagline: vals.tagline || 'Digital Marketing & Web Design',
    disclaimer: vals.disclaimer || 'This email and any attachments are confidential and intended solely for the addressee. This message has been scanned for viruses.',
  };
  return String(html).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in v ? v[k] : m));
}

module.exports = { templates, fill };
