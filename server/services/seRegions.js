/**
 * SE Ranking regional database codes (ISO 3166-1 alpha-2), per
 * https://seranking.com/api/data/reference/#regional-database-codes
 *
 * Two important gotchas from the docs:
 *  - The UK database code is `uk`, NOT `gb` (gb is rejected until a future update).
 *  - "Worldwide" is NOT a source code — it routes to a different endpoint. We
 *    represent it as the sentinel 'worldwide' and the client handles routing.
 *
 * An invalid source returns HTTP 400 "Invalid source", which is exactly the
 * error we were seeing when a lead's country was a full name ("India") or an
 * unsupported code.
 */

// Full supported list: code -> country name. Used to build the lead dropdown.
const REGIONS = [
  ['worldwide', 'Worldwide (all regions)'],
  ['us', 'United States'], ['uk', 'United Kingdom'], ['ca', 'Canada'],
  ['au', 'Australia'], ['in', 'India'], ['ae', 'United Arab Emirates'],
  ['sg', 'Singapore'], ['de', 'Germany'], ['fr', 'France'], ['es', 'Spain'],
  ['it', 'Italy'], ['nl', 'Netherlands'], ['ie', 'Ireland'], ['nz', 'New Zealand'],
  ['za', 'South Africa'], ['af', 'Afghanistan'], ['al', 'Albania'], ['dz', 'Algeria'],
  ['as', 'American Samoa'], ['ao', 'Angola'], ['ai', 'Anguilla'], ['ag', 'Antigua and Barbuda'],
  ['ar', 'Argentina'], ['am', 'Armenia'], ['aw', 'Aruba'], ['at', 'Austria'], ['az', 'Azerbaijan'],
  ['bs', 'Bahamas'], ['bh', 'Bahrain'], ['bd', 'Bangladesh'], ['bb', 'Barbados'], ['by', 'Belarus'],
  ['be', 'Belgium'], ['bz', 'Belize'], ['bj', 'Benin'], ['bt', 'Bhutan'], ['bo', 'Bolivia'],
  ['ba', 'Bosnia and Herzegovina'], ['bw', 'Botswana'], ['br', 'Brazil'], ['vg', 'British Virgin Islands'],
  ['bn', 'Brunei'], ['bg', 'Bulgaria'], ['bf', 'Burkina Faso'], ['bi', 'Burundi'], ['cv', 'Cabo Verde'],
  ['kh', 'Cambodia'], ['cm', 'Cameroon'], ['ky', 'Cayman Islands'], ['cf', 'Central African Republic'],
  ['td', 'Chad'], ['cl', 'Chile'], ['cn', 'China'], ['co', 'Colombia'], ['cd', 'Congo (Democratic Republic)'],
  ['cg', 'Congo (Republic)'], ['ck', 'Cook Islands'], ['cr', 'Costa Rica'], ['ci', 'Côte d’Ivoire'],
  ['hr', 'Croatia'], ['cu', 'Cuba'], ['cy', 'Cyprus'], ['cz', 'Czechia'], ['dk', 'Denmark'],
  ['dj', 'Djibouti'], ['dm', 'Dominica'], ['do', 'Dominican Republic'], ['ec', 'Ecuador'], ['eg', 'Egypt'],
  ['sv', 'El Salvador'], ['gq', 'Equatorial Guinea'], ['ee', 'Estonia'], ['et', 'Ethiopia'],
  ['fo', 'Faroe Islands'], ['fj', 'Fiji'], ['fi', 'Finland'], ['gf', 'French Guiana'], ['pf', 'French Polynesia'],
  ['ga', 'Gabon'], ['gm', 'Gambia'], ['ge', 'Georgia'], ['gh', 'Ghana'], ['gi', 'Gibraltar'], ['gr', 'Greece'],
  ['gl', 'Greenland'], ['gd', 'Grenada'], ['gp', 'Guadeloupe'], ['gu', 'Guam'], ['gt', 'Guatemala'],
  ['gg', 'Guernsey'], ['gn', 'Guinea'], ['gy', 'Guyana'], ['ht', 'Haiti'], ['hn', 'Honduras'], ['hk', 'Hong Kong'],
  ['hu', 'Hungary'], ['is', 'Iceland'], ['id', 'Indonesia'], ['iq', 'Iraq'], ['il', 'Israel'],
  ['jm', 'Jamaica'], ['jp', 'Japan'], ['je', 'Jersey'], ['jo', 'Jordan'], ['kz', 'Kazakhstan'], ['ke', 'Kenya'],
  ['ki', 'Kiribati'], ['kw', 'Kuwait'], ['kg', 'Kyrgyzstan'], ['la', 'Laos'], ['lv', 'Latvia'], ['lb', 'Lebanon'],
  ['ls', 'Lesotho'], ['ly', 'Libya'], ['li', 'Liechtenstein'], ['lt', 'Lithuania'], ['lu', 'Luxembourg'],
  ['mg', 'Madagascar'], ['mw', 'Malawi'], ['my', 'Malaysia'], ['mv', 'Maldives'], ['ml', 'Mali'], ['mt', 'Malta'],
  ['mq', 'Martinique'], ['mr', 'Mauritania'], ['mu', 'Mauritius'], ['yt', 'Mayotte'], ['mx', 'Mexico'],
  ['fm', 'Micronesia'], ['md', 'Moldova'], ['mc', 'Monaco'], ['mn', 'Mongolia'], ['me', 'Montenegro'],
  ['ms', 'Montserrat'], ['ma', 'Morocco'], ['mz', 'Mozambique'], ['mm', 'Myanmar'], ['na', 'Namibia'],
  ['nr', 'Nauru'], ['np', 'Nepal'], ['nc', 'New Caledonia'], ['ni', 'Nicaragua'], ['ne', 'Niger'],
  ['ng', 'Nigeria'], ['nu', 'Niue'], ['mk', 'North Macedonia'], ['no', 'Norway'], ['om', 'Oman'],
  ['pk', 'Pakistan'], ['pa', 'Panama'], ['pg', 'Papua New Guinea'], ['py', 'Paraguay'], ['pe', 'Peru'],
  ['ph', 'Philippines'], ['pn', 'Pitcairn Islands'], ['pl', 'Poland'], ['pt', 'Portugal'], ['pr', 'Puerto Rico'],
  ['qa', 'Qatar'], ['re', 'Réunion'], ['ro', 'Romania'], ['ru', 'Russia'], ['rw', 'Rwanda'], ['sh', 'Saint Helena'],
  ['kn', 'Saint Kitts and Nevis'], ['lc', 'Saint Lucia'], ['vc', 'Saint Vincent and the Grenadines'],
  ['ws', 'Samoa'], ['sm', 'San Marino'], ['st', 'São Tomé and Príncipe'], ['sa', 'Saudi Arabia'], ['sn', 'Senegal'],
  ['rs', 'Serbia'], ['sc', 'Seychelles'], ['sl', 'Sierra Leone'], ['sk', 'Slovakia'], ['si', 'Slovenia'],
  ['sb', 'Solomon Islands'], ['so', 'Somalia'], ['kr', 'South Korea'], ['lk', 'Sri Lanka'], ['ps', 'State of Palestine'],
  ['sr', 'Suriname'], ['se', 'Sweden'], ['ch', 'Switzerland'], ['tw', 'Taiwan'], ['tj', 'Tajikistan'],
  ['tz', 'Tanzania'], ['th', 'Thailand'], ['tl', 'Timor-Leste'], ['tg', 'Togo'], ['tk', 'Tokelau'], ['to', 'Tonga'],
  ['tt', 'Trinidad and Tobago'], ['tn', 'Tunisia'], ['tr', 'Türkiye'], ['tm', 'Turkmenistan'],
  ['vi', 'U.S. Virgin Islands'], ['ug', 'Uganda'], ['ua', 'Ukraine'], ['uy', 'Uruguay'], ['uz', 'Uzbekistan'],
  ['vu', 'Vanuatu'], ['ve', 'Venezuela'], ['vn', 'Vietnam'], ['ye', 'Yemen'], ['zm', 'Zambia'], ['zw', 'Zimbabwe'],
];

const VALID_CODES = new Set(REGIONS.map(([c]) => c));

// Common aliases / full names / wrong codes → the correct SE Ranking source code.
const ALIASES = {
  gb: 'uk', 'united kingdom': 'uk', 'great britain': 'uk', england: 'uk', uk: 'uk',
  usa: 'us', 'united states': 'us', 'united states of america': 'us', america: 'us',
  uae: 'ae', 'united arab emirates': 'ae',
  india: 'in', bharat: 'in',
  worldwide: 'worldwide', global: 'worldwide', international: 'worldwide', all: 'worldwide', ww: 'worldwide',
};
// Add every "name -> code" so a stored full country name resolves correctly.
for (const [code, name] of REGIONS) ALIASES[name.toLowerCase()] = code;

/**
 * Resolve any stored country value (code, full name, or common alias) to a
 * valid SE Ranking source code. Falls back to 'us' if we can't recognise it,
 * so a report never fails with "Invalid source" — worst case it queries the US
 * database, which is better than a hard error.
 */
function normaliseSource(input, fallback = 'us') {
  if (!input) return fallback;
  const raw = String(input).trim().toLowerCase();
  if (raw === 'worldwide') return 'worldwide';
  if (VALID_CODES.has(raw)) return raw;
  if (ALIASES[raw]) return ALIASES[raw];
  // Sometimes stored as "in-en" / "us_desktop" — take the leading 2 letters,
  // but only when the input looks like a code (short, or has a separator), so a
  // real word like "Narnia" doesn't accidentally match "na" (Namibia).
  const looksLikeCode = raw.length <= 3 || /[^a-z]/.test(raw);
  if (looksLikeCode) {
    const lead = raw.slice(0, 2);
    if (VALID_CODES.has(lead)) return lead;
    if (ALIASES[lead]) return ALIASES[lead];
  }
  return fallback;
}

module.exports = { REGIONS, VALID_CODES, normaliseSource };
