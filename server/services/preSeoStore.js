/**
 * Image storage for Pre-SEO report screenshots. Uploads to ImageKit when it is
 * configured (so files survive Railway's ephemeral disk), otherwise falls back
 * to local ./storage/uploads. Returns a servable URL in both cases:
 *   - ImageKit: an absolute https URL (WeasyPrint can load it directly)
 *   - local:    a /uploads/<file> path (served statically; PDF uses file://)
 */
const fs = require('fs/promises');
const path = require('path');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../storage/uploads');

// Store a PNG/JPEG buffer. Returns { url, fileId, remote }.
async function storeBuffer(buf, fileName) {
  try {
    const ik = require('./imagekit');
    const { Settings } = require('../models');
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    if (ik.isConfigured(settings)) {
      const r = await ik.uploadFile({ base64: buf.toString('base64'), fileName, folder: '/qtonix/preseo' });
      return { url: r.url, fileId: r.fileId || null, remote: true };
    }
  } catch (e) { console.error('[preSeoStore] ImageKit upload failed, using local:', e.message); }
  // Local fallback
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const safe = fileName.replace(/[^\w.\-]/g, '_');
  const name = `${Date.now()}-${safe}`;
  await fs.writeFile(path.join(UPLOAD_DIR, name), buf);
  return { url: `/uploads/${name}`, fileId: null, remote: false };
}

// Move an already-saved local /uploads file to ImageKit (used by the multer
// upload route after multer writes to disk). Returns { url, fileId, remote }.
async function promoteLocal(localUrl, fileName) {
  if (!localUrl || !localUrl.startsWith('/uploads/')) return { url: localUrl, fileId: null, remote: false };
  try {
    const ik = require('./imagekit');
    const { Settings } = require('../models');
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    if (ik.isConfigured(settings)) {
      const buf = await fs.readFile(path.join(UPLOAD_DIR, path.basename(localUrl)));
      const r = await ik.uploadFile({ base64: buf.toString('base64'), fileName: fileName || path.basename(localUrl), folder: '/qtonix/preseo' });
      fs.unlink(path.join(UPLOAD_DIR, path.basename(localUrl))).catch(() => {});
      return { url: r.url, fileId: r.fileId || null, remote: true };
    }
  } catch (e) { console.error('[preSeoStore] promoteLocal failed:', e.message); }
  return { url: localUrl, fileId: null, remote: false };
}

// Convert a stored URL into something WeasyPrint can load for the PDF:
// remote https stays as-is; a local /uploads path becomes an absolute file://.
function toRenderUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/uploads/')) return 'file://' + path.join(UPLOAD_DIR, path.basename(url));
  return url;
}

module.exports = { storeBuffer, promoteLocal, toRenderUrl, UPLOAD_DIR };
