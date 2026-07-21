// Full list of country names for lead/report country pickers.
export const COUNTRY_NAMES = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia','Australia','Austria',
  'Azerbaijan','Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia',
  'Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cabo Verde','Cambodia',
  'Cameroon','Canada','Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo','Costa Rica',
  'Croatia','Cuba','Cyprus','Czechia','Denmark','Djibouti','Dominica','Dominican Republic','Ecuador','Egypt',
  'El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia','Fiji','Finland','France','Gabon',
  'Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana','Haiti',
  'Honduras','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy','Ivory Coast','Jamaica',
  'Japan','Jordan','Kazakhstan','Kenya','Kiribati','Kosovo','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Lesotho',
  'Liberia','Libya','Liechtenstein','Lithuania','Luxembourg','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta',
  'Marshall Islands','Mauritania','Mauritius','Mexico','Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco',
  'Mozambique','Myanmar','Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Korea',
  'North Macedonia','Norway','Oman','Pakistan','Palau','Palestine','Panama','Papua New Guinea','Paraguay','Peru',
  'Philippines','Poland','Portugal','Qatar','Romania','Russia','Rwanda','Saint Kitts and Nevis','Saint Lucia',
  'Saint Vincent and the Grenadines','Samoa','San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia',
  'Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands','Somalia','South Africa','South Korea',
  'South Sudan','Spain','Sri Lanka','Sudan','Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania',
  'Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu','Uganda',
  'Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan','Vanuatu','Vatican City',
  'Venezuela','Vietnam','Yemen','Zambia','Zimbabwe',
];

// Country -> list of common IANA/offset time zones. Countries with one zone
// auto-fill; multi-zone countries present a picker.
export const COUNTRY_TIMEZONES = {
  'India': ['GMT+5:30 (IST)'],
  'United States': ['GMT-5 (Eastern)', 'GMT-6 (Central)', 'GMT-7 (Mountain)', 'GMT-8 (Pacific)', 'GMT-9 (Alaska)', 'GMT-10 (Hawaii)'],
  'United Kingdom': ['GMT+0 (GMT/BST)'],
  'Australia': ['GMT+10 (AEST)', 'GMT+9:30 (ACST)', 'GMT+8 (AWST)'],
  'Canada': ['GMT-3:30 (Newfoundland)', 'GMT-4 (Atlantic)', 'GMT-5 (Eastern)', 'GMT-6 (Central)', 'GMT-7 (Mountain)', 'GMT-8 (Pacific)'],
  'United Arab Emirates': ['GMT+4 (GST)'],
  'Singapore': ['GMT+8 (SGT)'],
  'Malaysia': ['GMT+8 (MYT)'],
  'Germany': ['GMT+1 (CET)'],
  'France': ['GMT+1 (CET)'],
  'Spain': ['GMT+1 (CET)'],
  'Italy': ['GMT+1 (CET)'],
  'Netherlands': ['GMT+1 (CET)'],
  'Ireland': ['GMT+0 (GMT/IST)'],
  'New Zealand': ['GMT+12 (NZST)'],
  'South Africa': ['GMT+2 (SAST)'],
  'Brazil': ['GMT-3 (Brasilia)', 'GMT-4 (Amazon)', 'GMT-5 (Acre)'],
  'Russia': ['GMT+3 (Moscow)', 'GMT+4', 'GMT+5', 'GMT+6', 'GMT+7', 'GMT+8', 'GMT+9', 'GMT+10', 'GMT+11', 'GMT+12'],
  'China': ['GMT+8 (CST)'],
  'Japan': ['GMT+9 (JST)'],
  'South Korea': ['GMT+9 (KST)'],
  'Indonesia': ['GMT+7 (WIB)', 'GMT+8 (WITA)', 'GMT+9 (WIT)'],
  'Mexico': ['GMT-6 (Central)', 'GMT-7 (Mountain)', 'GMT-8 (Pacific)'],
  'Pakistan': ['GMT+5 (PKT)'],
  'Bangladesh': ['GMT+6 (BST)'],
  'Saudi Arabia': ['GMT+3 (AST)'],
  'Nigeria': ['GMT+1 (WAT)'],
  'Philippines': ['GMT+8 (PHT)'],
  'Thailand': ['GMT+7 (ICT)'],
  'Vietnam': ['GMT+7 (ICT)'],
  'Sri Lanka': ['GMT+5:30 (IST)'],
  'Nepal': ['GMT+5:45 (NPT)'],
  'Switzerland': ['GMT+1 (CET)'],
  'Sweden': ['GMT+1 (CET)'],
  'Norway': ['GMT+1 (CET)'],
  'Denmark': ['GMT+1 (CET)'],
  'Belgium': ['GMT+1 (CET)'],
  'Austria': ['GMT+1 (CET)'],
  'Poland': ['GMT+1 (CET)'],
  'Portugal': ['GMT+0 (WET)'],
  'Greece': ['GMT+2 (EET)'],
  'Turkey': ['GMT+3 (TRT)'],
  'Egypt': ['GMT+2 (EET)'],
  'Kenya': ['GMT+3 (EAT)'],
  'Israel': ['GMT+2 (IST)'],
  'Qatar': ['GMT+3 (AST)'],
  'Kuwait': ['GMT+3 (AST)'],
  'Argentina': ['GMT-3 (ART)'],
  'Chile': ['GMT-3 (CLT)', 'GMT-5 (EAST)'],
  'Colombia': ['GMT-5 (COT)'],
  'Peru': ['GMT-5 (PET)'],
};

// International dialing codes by country (E.164 country calling code, no plus).
// Covers the countries our sales team actually works. Fallback handled in the
// phone helper below.
export const COUNTRY_DIAL = {
  'India': '91', 'United States': '1', 'United Kingdom': '44', 'Canada': '1', 'Australia': '61',
  'New Zealand': '64', 'Ireland': '353', 'Singapore': '65', 'Malaysia': '60', 'United Arab Emirates': '971',
  'Saudi Arabia': '966', 'Qatar': '974', 'Kuwait': '965', 'Bahrain': '973', 'Oman': '968',
  'South Africa': '27', 'Germany': '49', 'France': '33', 'Spain': '34', 'Italy': '39',
  'Netherlands': '31', 'Belgium': '32', 'Switzerland': '41', 'Sweden': '46', 'Norway': '47',
  'Denmark': '45', 'Finland': '358', 'Poland': '48', 'Portugal': '351', 'Austria': '43',
  'Greece': '30', 'Czechia': '420', 'Hungary': '36', 'Romania': '40', 'Russia': '7',
  'China': '86', 'Japan': '81', 'South Korea': '82', 'Hong Kong': '852', 'Taiwan': '886',
  'Thailand': '66', 'Indonesia': '62', 'Philippines': '63', 'Vietnam': '84', 'Pakistan': '92',
  'Bangladesh': '880', 'Sri Lanka': '94', 'Nepal': '977', 'Israel': '972', 'Turkey': '90',
  'Egypt': '20', 'Nigeria': '234', 'Kenya': '254', 'Ghana': '233', 'Brazil': '55',
  'Mexico': '52', 'Argentina': '54', 'Chile': '56', 'Colombia': '57', 'Peru': '51',
};

// Digit-grouping templates per dial code (how the local number is chunked).
// Each string uses 'x' for a digit and spaces/hyphens as separators. The helper
// applies the first template long enough for the digits provided.
const PHONE_TEMPLATES = {
  '91': ['xxxx-xxx-xxx'],                 // India: 9812-345-678
  '1': ['xxx xxx-xxxx'],                  // US/Canada: 213 555-0123
  '44': ['xx xxxx xxxx', 'xxxx xxxxxx'],  // UK: 20 7123 4567
  '61': ['x xxxx xxxx'],                  // Australia
  '971': ['xx xxx xxxx'],                 // UAE
  '65': ['xxxx xxxx'],                    // Singapore
  '60': ['xx xxxx xxxx'],                 // Malaysia
  '49': ['xxx xxxxxxxx'],                 // Germany
  '33': ['x xx xx xx xx'],                // France
  '86': ['xxx xxxx xxxx'],                // China
  '81': ['xx xxxx xxxx'],                 // Japan
};

export function dialFor(country) {
  return COUNTRY_DIAL[country] || '91';
}

// Format a phone number for a given country: "+<dial> <grouped local digits>".
// `raw` may contain any punctuation or an existing code; we keep only the local
// digits (stripping a leading dial code if present) and regroup.
export function formatPhone(raw, country) {
  const dial = dialFor(country);
  let digits = String(raw || '').replace(/[^\d]/g, '');
  if (digits.startsWith(dial)) digits = digits.slice(dial.length);
  // Guard: if someone typed the code with a leading 0 trunk prefix, drop it.
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (!digits) return `+${dial} `;
  const templates = PHONE_TEMPLATES[dial] || ['xxxxxxxxxx'];
  const tmpl = templates.find((t) => (t.match(/x/g) || []).length >= digits.length) || templates[templates.length - 1];
  let out = '', di = 0;
  for (const ch of tmpl) {
    if (di >= digits.length) break;
    if (ch === 'x') { out += digits[di++]; } else { out += ch; }
  }
  if (di < digits.length) out += digits.slice(di); // overflow digits appended
  return `+${dial} ${out.trim()}`;
}
