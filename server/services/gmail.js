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
  'https://www.googleapis.com/auth/calendar.events',
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
  const grantedScopes = String(tokens.scope || '');
  const hasCalendar = /calendar\.events|\/calendar(\s|$)/.test(grantedScopes);
  return { refreshToken: tokens.refresh_token || '', email, grantedScopes, hasCalendar };
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

// Walk the MIME tree collecting text/plain and text/html parts, plus both file
// attachments and inline images (which are referenced from the HTML via cid:).
function extractBodies(payload) {
  let html = '', text = '';
  const attachments = [];
  const inlines = []; // { contentId, filename, mimeType, attachmentId }
  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || '';
    if (mime === 'text/html' && part.body && part.body.data) html += decodeBody(part.body.data);
    else if (mime === 'text/plain' && part.body && part.body.data) text += decodeBody(part.body.data);
    // Read headers for Content-ID / disposition so we can tell inline from file.
    const headers = part.headers || [];
    const hget = (n) => { const h = headers.find((x) => (x.name || '').toLowerCase() === n); return h ? h.value : ''; };
    const contentId = (hget('content-id') || '').replace(/^<|>$/g, '');
    const disposition = (hget('content-disposition') || '').toLowerCase();
    if (part.body && part.body.attachmentId) {
      const isImage = /^image\//i.test(mime);
      const isInline = disposition.includes('inline') || (!!contentId && isImage);
      if (isInline) {
        inlines.push({ contentId, filename: part.filename || contentId || 'image', mimeType: mime, attachmentId: part.body.attachmentId, size: part.body.size || 0 });
      } else if (part.filename) {
        attachments.push({ filename: part.filename, mimeType: mime, attachmentId: part.body.attachmentId, size: part.body.size || 0 });
      }
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return { html, text, attachments, inlines };
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
  const { html, text, attachments, inlines } = extractBodies(msg.payload);
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
    inlines: inlines || [],
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
  // RFC 2047 encoded-word for non-ASCII subjects (otherwise they mojibake too).
  const encodeSubject = (sub) => {
    const str = sub || '';
    if (/^[\x00-\x7F]*$/.test(str)) return str; // pure ASCII — leave as-is
    return `=?UTF-8?B?${Buffer.from(str, 'utf8').toString('base64')}?=`;
  };
  headers.push(`Subject: ${encodeSubject(subject)}`, 'MIME-Version: 1.0');
  if (inReplyTo) { headers.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`); }

  // Encode the HTML body as base64 with an explicit transfer encoding. Without
  // this, multibyte UTF-8 characters (en-dashes, curly quotes, emoji) can be
  // re-interpreted by the mail transport and arrive mojibake'd (e.g. "–" → "Ã¢Â€Â“").
  const htmlPartB64 = Buffer.from(bodyHtml || '', 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const list = Array.isArray(attachments) ? attachments.filter((a) => a && a.contentBase64) : [];
  if (list.length === 0) {
    const msg = `${headers.join('\r\n')}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${htmlPartB64}`;
    return Buffer.from(msg, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  const boundary = `qtx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  let body = `${headers.join('\r\n')}\r\n\r\n`;
  body += `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${htmlPartB64}\r\n`;
  for (const a of list) {
    body += `--${boundary}\r\n`;
    body += `Content-Type: ${a.mimeType || 'application/octet-stream'}; name="${a.filename}"\r\n`;
    body += `Content-Disposition: attachment; filename="${a.filename}"\r\n`;
    body += 'Content-Transfer-Encoding: base64\r\n\r\n';
    // Wrap base64 at 76 chars per MIME convention.
    body += `${String(a.contentBase64).replace(/(.{76})/g, '$1\r\n')}\r\n`;
  }
  body += `--${boundary}--`;
  return Buffer.from(body, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build a standard iCalendar (.ics) invitation with METHOD:REQUEST. Attaching
 * this to the invite email makes every mail client — Gmail, Outlook, Apple Mail,
 * Yahoo — render Accept/Decline buttons and add the event to the recipient's
 * calendar, independent of whether they use Google. The Meet/join link is
 * embedded in both LOCATION and DESCRIPTION so it's always reachable.
 */
function buildIcsInvite({ uid, summary, description, start, end, organizerEmail, organizerName, attendees = [], location, meetLink, timeZone = 'Asia/Kolkata', sequence = 0, method = 'REQUEST', status = 'CONFIRMED' }) {
  const toUtc = (d) => {
    const dt = new Date(d);
    return dt.getUTCFullYear().toString().padStart(4, '0')
      + (dt.getUTCMonth() + 1).toString().padStart(2, '0')
      + dt.getUTCDate().toString().padStart(2, '0') + 'T'
      + dt.getUTCHours().toString().padStart(2, '0')
      + dt.getUTCMinutes().toString().padStart(2, '0')
      + dt.getUTCSeconds().toString().padStart(2, '0') + 'Z';
  };
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const loc = location || meetLink || '';
  const desc = [description || '', meetLink ? `\\n\\nJoin: ${meetLink}` : ''].join('');
  const lines = [
    'BEGIN:VCALENDAR', 'PRODID:-//Qtonix//HRMS//EN', 'VERSION:2.0', `METHOD:${method}`, 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toUtc(new Date())}`,
    `DTSTART:${toUtc(start)}`,
    `DTEND:${toUtc(end)}`,
    `SEQUENCE:${sequence}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(desc)}`,
    loc ? `LOCATION:${esc(loc)}` : '',
    `ORGANIZER;CN=${esc(organizerName || organizerEmail)}:mailto:${organizerEmail}`,
    ...attendees.filter(Boolean).map((a) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${esc(a)}:mailto:${a}`),
    `STATUS:${status}`,
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  // Fold lines >75 octets per RFC 5545, and use CRLF line endings.
  const folded = lines.map((l) => {
    if (l.length <= 74) return l;
    let out = l.slice(0, 74); let rest = l.slice(74);
    while (rest.length > 73) { out += '\r\n ' + rest.slice(0, 73); rest = rest.slice(73); }
    return out + '\r\n ' + rest;
  });
  return folded.join('\r\n');
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

/**
 * List messages in a Gmail folder/label. `box` maps to a system label
 * (INBOX/SENT/SPAM/TRASH/STARRED) or a custom label id. Supports an optional
 * search string. Returns normalized message summaries (metadata only — no
 * bodies — for a fast list view) plus the next page token.
 */
async function listFolder(settings, refreshToken, connectedEmail, { box = 'INBOX', labelId, q = '', max = 25, pageToken } = {}) {
  const gmail = gmailFor(settings, refreshToken);
  const params = { userId: 'me', maxResults: max };
  const labelIds = [];
  if (box === 'STARRED') labelIds.push('STARRED');
  else if (box === 'ALL') { /* no label filter = all mail */ }
  else if (labelId) labelIds.push(labelId);
  else labelIds.push(box); // INBOX / SENT / SPAM / TRASH / DRAFT
  if (labelIds.length) params.labelIds = labelIds;
  if (q) params.q = q;
  if (pageToken) params.pageToken = pageToken;
  const list = await gmail.users.messages.list(params);
  const ids = (list.data.messages || []).map((m) => m.id);
  const out = [];
  for (const id of ids) {
    try {
      // metadata format is much lighter than full — good for a list.
      const meta = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] });
      const m = meta.data;
      const headers = (m.payload && m.payload.headers) || [];
      const from = parseAddress(headerVal(headers, 'From'));
      const isOutbound = from.email && connectedEmail && from.email === String(connectedEmail).toLowerCase();
      out.push({
        gmailMessageId: m.id,
        threadId: m.threadId || '',
        fromEmail: from.email, fromName: from.name,
        toEmail: headerVal(headers, 'To'),
        subject: headerVal(headers, 'Subject'),
        snippet: m.snippet || '',
        sentAt: new Date(Number(m.internalDate) || Date.now()),
        isRead: !(m.labelIds || []).includes('UNREAD'),
        starred: (m.labelIds || []).includes('STARRED'),
        labelIds: m.labelIds || [],
        direction: isOutbound ? 'outbound' : 'inbound',
        hasAttachments: /attachment/i.test(JSON.stringify(m.payload && m.payload.parts || [])) || false,
      });
    } catch (e) { /* skip individual failures */ }
  }
  return { messages: out, nextPageToken: list.data.nextPageToken || null };
}

/** List the user's Gmail labels (system + custom). */
async function listLabels(settings, refreshToken) {
  const gmail = gmailFor(settings, refreshToken);
  const res = await gmail.users.labels.list({ userId: 'me' });
  return (res.data.labels || []).map((l) => ({ id: l.id, name: l.name, type: l.type, color: l.color || null }));
}

/** Create a custom Gmail label. */
async function createLabel(settings, refreshToken, name, color) {
  const gmail = gmailFor(settings, refreshToken);
  const body = { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' };
  if (color && color.backgroundColor) body.color = color;
  const res = await gmail.users.labels.create({ userId: 'me', requestBody: body });
  return { id: res.data.id, name: res.data.name, color: res.data.color || null };
}

/** Rename / recolor a label. */
async function updateLabel(settings, refreshToken, id, patch) {
  const gmail = gmailFor(settings, refreshToken);
  const res = await gmail.users.labels.patch({ userId: 'me', id, requestBody: patch });
  return { id: res.data.id, name: res.data.name, color: res.data.color || null };
}

/** Delete a custom label. */
async function deleteLabel(settings, refreshToken, id) {
  const gmail = gmailFor(settings, refreshToken);
  await gmail.users.labels.delete({ userId: 'me', id });
}

/** Apply/remove labels on a message. */
async function modifyMessageLabels(settings, refreshToken, gmailMessageId, { add = [], remove = [] } = {}) {
  const gmail = gmailFor(settings, refreshToken);
  await gmail.users.messages.modify({ userId: 'me', id: gmailMessageId, requestBody: { addLabelIds: add, removeLabelIds: remove } });
}

/** Move a message to Trash (soft delete). */
async function trashMessage(settings, refreshToken, gmailMessageId) {
  const gmail = gmailFor(settings, refreshToken);
  await gmail.users.messages.trash({ userId: 'me', id: gmailMessageId });
}

/** Star / unstar a message in Gmail. */
async function setStar(settings, refreshToken, gmailMessageId, starred) {
  const gmail = gmailFor(settings, refreshToken);
  await gmail.users.messages.modify({ userId: 'me', id: gmailMessageId, requestBody: starred ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] } });
}

/** Create a Google Calendar event with a Meet link, inviting the attendees.
 *  Returns { htmlLink, meetLink, eventId }. */
async function createCalendarEvent(settings, refreshToken, { summary, description, start, end, attendees = [], timeZone = 'Asia/Kolkata' }) {
  const client = oauthClient(settings);
  client.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: client });
  const attendeeList = attendees.filter(Boolean).map((email) => ({ email }));
  const baseBody = {
    summary, description,
    start: { dateTime: start, timeZone },
    end: { dateTime: end, timeZone },
  };

  // Try progressively simpler requests so a single unsupported feature (Meet
  // conferencing, attendee invites on a personal Gmail account, or update
  // emails) can't block the whole event. We record why each attempt failed so
  // the surfaced error names the real cause.
  // We attach our own branded .ics to the invite email (see the schedule
  // route), so Google itself must NOT also email the attendees — otherwise the
  // candidate gets two invites. Hence sendUpdates:'none' throughout; the event
  // still lands on career@qtonix.com's calendar with the Meet link.
  const attempts = [
    { label: 'meet+attendees', params: { calendarId: 'primary', conferenceDataVersion: 1, sendUpdates: 'none', requestBody: { ...baseBody, attendees: attendeeList, conferenceData: { createRequest: { requestId: 'meet-' + Date.now(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } } },
    { label: 'attendees-only', params: { calendarId: 'primary', sendUpdates: 'none', requestBody: { ...baseBody, attendees: attendeeList } } },
    { label: 'plain-event', params: { calendarId: 'primary', conferenceDataVersion: 1, requestBody: { ...baseBody, conferenceData: { createRequest: { requestId: 'meet-' + Date.now(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } } },
    { label: 'plain-no-meet', params: { calendarId: 'primary', requestBody: { ...baseBody } } },
  ];

  let lastErr;
  for (const a of attempts) {
    try {
      const res = await calendar.events.insert(a.params);
      const ev = res.data;
      const meetLink = (ev.conferenceData && ev.conferenceData.entryPoints || []).find((e) => e.entryPointType === 'video');
      return { htmlLink: ev.htmlLink, meetLink: meetLink ? meetLink.uri : '', eventId: ev.id, iCalUID: ev.iCalUID || ev.id, mode: a.label };
    } catch (e) {
      lastErr = e;
      console.error(`[calendar] attempt "${a.label}" failed:`, e && (e.response && e.response.data ? JSON.stringify(e.response.data) : e.message));
    }
  }
  throw lastErr || new Error('Calendar event could not be created.');
}

// Extract the human-readable reason from a Google API error, so the UI can show
// what actually went wrong (e.g. "Calendar API not enabled", "insufficient scope").
function calendarErrorMessage(ex) {
  const g = ex && ex.response && ex.response.data && ex.response.data.error;
  if (g && typeof g === 'object' && g.message) {
    if (/has not been used|is disabled|not enabled/i.test(g.message)) return 'The Google Calendar API isn’t enabled for this Google project. Enable "Google Calendar API" in Google Cloud Console, then try again.';
    if (/insufficient|scope|permission|Request had insufficient authentication/i.test(g.message)) return 'The mailbox is linked but without Calendar permission. Re-link the mailbox and, on the Google consent screen, ensure the calendar checkbox is ticked.';
    return `Google Calendar error: ${g.message}`;
  }
  if (typeof g === 'string') return `Google Calendar error: ${g}`;
  if (ex && /invalid_grant/i.test(ex.message || '')) return 'The mailbox link has expired. Please re-link the recruitment mailbox.';
  return ex && ex.message ? `Could not create the calendar event: ${ex.message}` : 'Could not create the calendar event.';
}

// Update an existing calendar event's time (and optionally attendees). Used
// when an interview is rescheduled. Keeps the same event + Meet link.
async function updateCalendarEvent(settings, refreshToken, eventId, { start, end, timeZone = 'Asia/Kolkata', summary, description, attendees } = {}) {
  const client = oauthClient(settings);
  client.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: client });
  const patch = {};
  if (start) patch.start = { dateTime: start, timeZone };
  if (end) patch.end = { dateTime: end, timeZone };
  if (summary !== undefined) patch.summary = summary;
  if (description !== undefined) patch.description = description;
  if (Array.isArray(attendees)) patch.attendees = attendees.filter(Boolean).map((email) => ({ email }));
  const res = await calendar.events.patch({ calendarId: 'primary', eventId, sendUpdates: 'none', requestBody: patch });
  const ev = res.data;
  const meetLink = (ev.conferenceData && ev.conferenceData.entryPoints || []).find((e) => e.entryPointType === 'video');
  return { htmlLink: ev.htmlLink, meetLink: meetLink ? meetLink.uri : '', eventId: ev.id, iCalUID: ev.iCalUID || ev.id };
}

// Delete a calendar event (used when an interview is cancelled).
async function deleteCalendarEvent(settings, refreshToken, eventId) {
  const client = oauthClient(settings);
  client.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: client });
  await calendar.events.delete({ calendarId: 'primary', eventId, sendUpdates: 'none' });
  return { ok: true };
}

module.exports = {
  SCOPES, isConfigured, redirectUri, hasValidBaseUrl, authUrl, exchangeCode,
  searchMessages, sendMessage, getThread, getAttachment, markRead, parseAddress, buildRaw,
  listFolder, listLabels, createLabel, updateLabel, deleteLabel, modifyMessageLabels, trashMessage, setStar,
  createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, calendarErrorMessage, buildIcsInvite, oauthClient, gmailFor,
};
