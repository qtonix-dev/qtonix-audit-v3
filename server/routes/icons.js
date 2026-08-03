const express = require('express');
const router = express.Router();

// Brand-coloured social icons served from our own domain so email signatures
// always render them (no dependency on third-party icon CDNs that some clients
// block). Public, cacheable, no auth.
const ICONS = {
  linkedin: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#0A66C2"/><path fill="#fff" d="M6.94 8.5H4.6V17h2.34V8.5Zm-1.17-1a1.36 1.36 0 1 0 0-2.72 1.36 1.36 0 0 0 0 2.72ZM17 12.9c0-2.2-1.17-3.22-2.73-3.22-1.26 0-1.82.69-2.14 1.18V8.5H9.8c.03.66 0 8.5 0 8.5h2.33v-4.5c0-.24.02-.48.09-.65.18-.47.61-.96 1.33-.96.94 0 1.31.71 1.31 1.76V17H17v-4.1Z"/></svg>`,
  facebook: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#1877F2"/><path fill="#fff" d="M15.1 12.5l.4-2.6h-2.5V8.2c0-.7.35-1.4 1.46-1.4h1.14V4.6s-1.03-.18-2.02-.18c-2.06 0-3.4 1.25-3.4 3.5v2H7.9v2.6h2.28V19h2.8v-6.5h2.12Z"/></svg>`,
  instagram: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><defs><radialGradient id="ig" cx="30%" cy="107%" r="150%"><stop offset="0" stop-color="#fdf497"/><stop offset=".05" stop-color="#fdf497"/><stop offset=".45" stop-color="#fd5949"/><stop offset=".6" stop-color="#d6249f"/><stop offset=".9" stop-color="#285AEB"/></radialGradient></defs><rect width="24" height="24" rx="6" fill="url(#ig)"/><path fill="none" stroke="#fff" stroke-width="1.6" d="M8 5.2h8A2.8 2.8 0 0 1 18.8 8v8a2.8 2.8 0 0 1-2.8 2.8H8A2.8 2.8 0 0 1 5.2 16V8A2.8 2.8 0 0 1 8 5.2Z"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="16.2" cy="7.8" r="1" fill="#fff"/></svg>`,
  calendly: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#006BFF"/><path fill="#fff" d="M12 6.2c-3.2 0-5.8 2.6-5.8 5.8s2.6 5.8 5.8 5.8c2.2 0 4.1-1.2 5-3l-1.9-.9c-.55 1.1-1.7 1.8-3.1 1.8-1.98 0-3.6-1.62-3.6-3.7S10.02 8.3 12 8.3c1.4 0 2.55.7 3.1 1.8l1.9-.9c-.9-1.8-2.8-3-5-3Z"/></svg>`,
};

router.get('/:name.svg', (req, res) => {
  const svg = ICONS[String(req.params.name || '').toLowerCase()];
  if (!svg) return res.status(404).end();
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'public, max-age=604800');
  res.end(svg);
});

module.exports = router;
