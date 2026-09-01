// Bumped each release so the running build is visible in the UI (top nav) and
// can be cross-checked against /api/health. If the UI shows an older tag than
// this, the browser or deploy is serving stale assets.
export const APP_BUILD = 'v386';
