// API base URL.
// - Dev: empty string → Vite proxies /api and /uploads to the Node server.
// - Prod (Vercel): set VITE_API_BASE to your Railway backend URL at build time.
export const API_BASE = import.meta.env.VITE_API_BASE || '';
