/**
 * Gmail integration (per-user OAuth). Each agent/manager/admin connects their
 * own Google Workspace mailbox. We store only a refresh token (encrypted) and
 * mint access tokens on demand. A background job syncs inbox messages that
 * match a lead (by the lead's email address or its email domain).
 *
 * Setup (one-time, by a Workspace admin):
 *   1. Google Cloud project → enable the Gmail API.
 *   2. Create an OAuth 2.0 Client ID (Web application).
 *   3. Add the redirect URI: {APP_URL}/api/gmail/callback
 *   4. Paste the Client ID + Secret into Site Analysis Admin → Email (Gmail).
 */
const { google } = require('googleapis');

// Read + send + read-only profile. gmail.modify lets us mark read; gmail.send
// lets us send replies. Both are "restricted" scopes (need Google verification
// for >100 users), which is fine for internal rollout.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

function getKeys(settings) {
  return {
    clientId: settings.getKey('gmailClientId'),
    clientSecret: settings.getKey('gmailClientSecret'),
  };
}

function isConfigured(settings) {
  const k = getKeys(settings);
  return !!(k.clientId && k.clientSecret);
}

function redirectUri() {
  const base = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return base ? `${base}/api/gmail/callback` : '';
}

// True only when APP_URL/PUBLIC_URL is set to a proper absolute https URL.
function hasValidBaseUrl() {
  return /^https?:\/\/.+/.test(redirectUri());
}

function oauthClient(settings) {
  const { clientId, clientSecret } = getKeys(settings);
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri());
}

/** The consent URL a user visits to connect their mailbox. `state` carries the
 *  user id so the callback knows whom to attach the token to. */
function authUrl(settings, state) {
  const client = oauthClient(settings);
  return client.generateAuthUrl({
    access_type: 'offline',        // ask for a refresh token
    prompt: 'consent',             // force refresh-token issuance every time
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

/** Exchange the one-time code for tokens; also read the connected email. */
async function exchangeCode(settings, code) {
  const client = oauthClient(settings);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  let email = '';
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const me = await oauth2.userinfo.get();
    email = me.data.email || '';
  } catch { /* non-fatal */ }
  return { refreshToken: tokens.refresh_token || '', email };
}

/** A Gmail API client authorised as a given user (using their refresh token). */
function gmailFor(settings, refreshToken) {
  const client = oauthClient(settings);
  client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: client });
}

// --- message parsing --------------------------------------------------------

function headerVal(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function parseAddress(raw) {
  // "Jane Doe <jane@acme.com>" → { name, email }; "jane@acme.com" → { email }.
  const s = String(raw || '').trim();
  const angle = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (angle) return { name: (angle[1] || '').trim(), email: (angle[2] || '').trim().toLowerCase() };
  const bare = s.match(/([^\s<>]+@[^\s<>]+)/);
  if (bare) return { name: '', email: bare[1].trim().toLowerCase() };
  return { name: '', email: s.toLowerCase() };
}

function decodeBody(data) {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Walk the MIME tree collecting text/plain and text/html parts.
function extractBodies(payload) {
  let html = '', text = '';
  const attachments = [];
  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || '';
    if (mime === 'text/html' && part.body && part.body.data) html += decodeBody(part.body.data);
    else if (mime === 'text/plain' && part.body && part.body.data) text += decodeBody(part.body.data);
    // A part with a filename + attachmentId is a file attachment.
    if (part.filename && part.body && part.body.attachmentId) {
      attachments.push({ filename: part.filename, mimeType: mime, attachmentId: part.body.attachmentId, size: part.body.size || 0 });
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return { html, text, attachments };
}

/** Turn a full Gmail message resource into our flat record shape. */
function normalizeMessage(msg, connectedEmail) {
  const headers = (msg.payload && msg.payload.headers) || [];
  const from = parseAddress(headerVal(headers, 'From'));
  const to = headerVal(headers, 'To');
  const cc = headerVal(headers, 'Cc');
  const subject = headerVal(headers, 'Subject');
  const dateHdr = headerVal(headers, 'Date');
  const messageIdHdr = headerVal(headers, 'Message-ID') || headerVal(headers, 'Message-Id');
  const { html, text, attachments } = extractBodies(msg.payload);
  const isOutbound = from.email && connectedEmail && from.email === String(connectedEmail).toLowerCase();
  return {
    gmailMessageId: msg.id,
    threadId: msg.threadId || '',
    rfcMessageId: messageIdHdr,
    direction: isOutbound ? 'outbound' : 'inbound',
    fromEmail: from.email,
    fromName: from.name,
    toEmail: to,
    ccEmail: cc,
    subject,
    snippet: msg.snippet || '',
    bodyHtml: html,
    bodyText: text,
    attachments,
    sentAt: dateHdr ? new Date(dateHdr) : new Date(Number(msg.internalDate) || Date.now()),
    isRead: !(msg.labelIds || []).includes('UNREAD'),
  };
}

/**
 * Fetch recent messages for the given search query. Returns normalized records.
 * `query` is a Gmail search string, e.g. 'from:jane@acme.com OR to:jane@acme.com'.
 */
async function searchMessages(settings, refreshToken, connectedEmail, query, max = 25) {
  const gmail = gmailFor(settings, refreshToken);
  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: max });
  const ids = (list.data.messages || []).map((m) => m.id);
  const out = [];
  for (const id of ids) {
    try {
      const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      out.push(normalizeMessage(full.data, connectedEmail));
    } catch (e) { /* skip individual failures */ }
  }
  return out;
}

/** Send an email as the connected user. Optionally in-reply-to a thread. */
// Build a MIME message. Supports To/Cc/Bcc (comma-joined strings or arrays),
// an HTML body, and attachments [{ filename, mimeType, contentBase64 }].
function buildRaw({ from, to, cc, bcc, subject, bodyHtml, inReplyTo, attachments }) {
  const asList = (v) => Array.isArray(v) ? v.filter(Boolean).join(', ') : (v || '');
  const headers = [`From: ${from}`, `To: ${asList(to)}`];
  if (asList(cc)) headers.push(`Cc: ${asList(cc)}`);
  if (asList(bcc)) headers.push(`Bcc: ${asList(bcc)}`);
  headers.push(`Subject: ${subject || ''}`, 'MIME-Version: 1.0');
  if (inReplyTo) { headers.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`); }

  const list = Array.isArray(attachments) ? attachments.filter((a) => a && a.contentBase64) : [];
  if (list.length === 0) {
    const msg = `${headers.join('\r\n')}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${bodyHtml || ''}`;
    return Buffer.from(msg).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  const boundary = `qtx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  let body = `${headers.join('\r\n')}\r\n\r\n`;
  body += `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${bodyHtml || ''}\r\n`;
  for (const a of list) {
    body += `--${boundary}\r\n`;
    body += `Content-Type: ${a.mimeType || 'application/octet-stream'}; name="${a.filename}"\r\n`;
    body += `Content-Disposition: attachment; filename="${a.filename}"\r\n`;
    body += 'Content-Transfer-Encoding: base64\r\n\r\n';
    // Wrap base64 at 76 chars per MIME convention.
    body += `${String(a.contentBase64).replace(/(.{76})/g, '$1\r\n')}\r\n`;
  }
  body += `--${boundary}--`;
  return Buffer.from(body).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendMessage(settings, refreshToken, connectedEmail, opts) {
  const gmail = gmailFor(settings, refreshToken);
  const raw = buildRaw({ from: opts.from || connectedEmail, ...opts });
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId: opts.threadId || undefined } });
  return res.data;
}

/** Fetch every message in a Gmail thread, normalized. */
async function getThread(settings, refreshToken, connectedEmail, threadId) {
  const gmail = gmailFor(settings, refreshToken);
  const t = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  return (t.data.messages || []).map((m) => normalizeMessage(m, connectedEmail));
}

/** Download a single attachment's bytes (base64) from a message. */
async function getAttachment(settings, refreshToken, messageId, attachmentId) {
  const gmail = gmailFor(settings, refreshToken);
  const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId });
  return a.data.data; // base64url
}

/** Mark a message read in Gmail (remove UNREAD label). */
async function markRead(settings, refreshToken, gmailMessageId) {
  const gmail = gmailFor(settings, refreshToken);
  await gmail.users.messages.modify({ userId: 'me', id: gmailMessageId, requestBody: { removeLabelIds: ['UNREAD'] } });
}

module.exports = {
  SCOPES, isConfigured, redirectUri, hasValidBaseUrl, authUrl, exchangeCode,
  searchMessages, sendMessage, getThread, getAttachment, markRead, parseAddress, buildRaw,
};
