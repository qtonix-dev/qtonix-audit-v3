/**
 * ImageKit integration for HR file/image storage. Uses direct browser uploads:
 * the server hands out short-lived auth params (signature/token/expire) signed
 * with the private key, and the browser uploads straight to ImageKit. Only the
 * returned file URL/id is stored in our database.
 */
const crypto = require('crypto');

function getConfig(settings) {
  // The public key and URL endpoint are not secrets and the endpoint contains
  // ':' (https://…), which the key-encryption layer mistakes for ciphertext.
  // So read those two raw from apiKeys and only decrypt the private key.
  const raw = (settings && settings.apiKeys) || {};
  const rawOrDecrypt = (name) => {
    const v = raw[name];
    if (!v) return '';
    // If it looks encrypted (iv:tag:data hex triplet) decrypt it; else use raw.
    if (typeof v === 'string' && /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(v)) {
      const d = settings.getKey(name);
      return d || v;
    }
    return v;
  };
  return {
    publicKey: rawOrDecrypt('imagekitPublic'),
    privateKey: settings.getKey('imagekitPrivate') || (raw.imagekitPrivate && !/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(raw.imagekitPrivate) ? raw.imagekitPrivate : ''),
    urlEndpoint: rawOrDecrypt('imagekitEndpoint'),
  };
}

function isConfigured(settings) {
  const c = getConfig(settings);
  return !!(c.publicKey && c.privateKey && c.urlEndpoint);
}

/**
 * Auth params for a browser-side upload. ImageKit expects an HMAC-SHA1 of
 * (token + expire) keyed by the private key. Token is any unique string; expire
 * is a UNIX timestamp (<= 1 hour out).
 */
function getAuthParams(settings) {
  const { privateKey } = getConfig(settings);
  if (!privateKey) throw new Error('ImageKit is not configured.');
  const token = crypto.randomBytes(16).toString('hex');
  const expire = Math.floor(Date.now() / 1000) + 30 * 60; // 30 minutes
  const signature = crypto.createHmac('sha1', privateKey).update(token + expire).digest('hex');
  return { token, expire, signature, publicKey: getConfig(settings).publicKey, urlEndpoint: getConfig(settings).urlEndpoint };
}

/**
 * Verify the credentials by calling ImageKit's list-files API with the private
 * key (Basic auth). Returns { ok, message }.
 */
async function testConnection(settings) {
  const { privateKey, publicKey, urlEndpoint } = getConfig(settings);
  if (!privateKey || !publicKey || !urlEndpoint) {
    return { ok: false, message: 'Enter the public key, private key and URL endpoint.' };
  }
  try {
    const auth = 'Basic ' + Buffer.from(privateKey + ':').toString('base64');
    const res = await fetch('https://api.imagekit.io/v1/files?limit=1', { headers: { Authorization: auth } });
    if (res.status === 200) return { ok: true, message: 'Connected to ImageKit successfully.' };
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Invalid private key — ImageKit rejected the credentials.' };
    return { ok: false, message: `ImageKit responded with status ${res.status}.` };
  } catch (e) {
    return { ok: false, message: `Could not reach ImageKit: ${e.message}` };
  }
}

// The folder for an employee's files: /qtonix-hr/employees/{id}-{name}/...
function employeeFolder(hrUser, sub) {
  const safe = String(hrUser.name || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const idPart = hrUser.employeeId ? String(hrUser.employeeId).replace(/[^A-Za-z0-9]+/g, '') : `id${hrUser.id}`;
  return `/qtonix-hr/employees/${idPart}-${safe}/${sub}`;
}

module.exports = { getConfig, isConfigured, getAuthParams, testConnection, employeeFolder };
