# DEPLOY — Qtonix Site Analysis (get a live temporary URL)

This app is **two pieces**:

1. **Backend** — Node + Express + MySQL + WeasyPrint. A long-running server. It
   does the crawling, the SE Ranking / Claude / Google Places calls, and renders
   the PDF. **This cannot go on Vercel** (Vercel kills long jobs and has no place
   to install WeasyPrint/fonts). It goes on **Railway**.
2. **Frontend** — the React portal + admin. A static site after `npm run build`.
   This CAN go on Vercel, or be served by the backend itself.

You have two ways to deploy. **Option A is the fastest way to a temporary URL.**

---

## Why your developer's Vercel deploy failed (fixed now)

The original bundle shipped raw `.jsx` with **no build tooling** — no
`index.html`, no bundler, `react` not even in dependencies. Vercel looks for a
buildable frontend, finds none, and errors. It's also the wrong host for a
server that runs 60–180-second jobs and shells out to WeasyPrint.

This package now includes a real Vite frontend (`client/`), a Railway backend
config (`nixpacks.toml`, `railway.json`), and a Vercel config
(`client/vercel.json`). Both build cleanly — verified.

---

## OPTION A — One host (Railway only). Fastest temporary URL.

The backend serves the built frontend too, so you get ONE public URL for
everything. Best for a quick live demo.

### 1. Push to GitHub
```bash
git init && git add . && git commit -m "Qtonix audit tool"
# create an empty GitHub repo, then:
git remote add origin https://github.com/<you>/qtonix-audit.git
git push -u origin main
```

### 2. Build the frontend once, commit the output
Railway will run the backend; the backend serves `client/dist`. So build it:
```bash
cd client && npm install && npm run build && cd ..
git add -f client/dist && git commit -m "build frontend" && git push
```
(Leave `VITE_API_BASE` empty for Option A — same origin, no base needed.)

### 3. On Railway (railway.app)
1. **New Project → Deploy from GitHub repo** → pick your repo.
2. **Add a MySQL database**: New → Database → MySQL. Railway creates it and
   exposes `MYSQLHOST`, `MYSQLPORT`, `MYSQLDATABASE`, `MYSQLUSER`, `MYSQLPASSWORD`.
3. On the **API service → Variables**, set:
   ```
   DB_DIALECT=mysql
   DB_HOST=${{MySQL.MYSQLHOST}}
   DB_PORT=${{MySQL.MYSQLPORT}}
   DB_NAME=${{MySQL.MYSQLDATABASE}}
   DB_USER=${{MySQL.MYSQLUSER}}
   DB_PASS=${{MySQL.MYSQLPASSWORD}}
   JWT_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   ENCRYPTION_KEY=<run the same command again for a different value>
   ADMIN_EMAIL=admin@qtonix.com
   ADMIN_PASSWORD=<pick a strong password>
   ADMIN_NAME=Adam G
   ```
   (No `CLIENT_ORIGIN` needed in single-host mode.)
4. Railway builds using `nixpacks.toml` — this installs **WeasyPrint + the fonts**
   automatically. The start command runs `npm run seed` (creates tables + your
   admin) then `npm start`.
5. **Settings → Networking → Generate Domain.** You get a temporary URL like
   `https://qtonix-audit-production.up.railway.app`. **That's your live link.**

### 4. First run
Open the URL → sign in with `admin@qtonix.com` / your `ADMIN_PASSWORD` →
**Admin → Settings** → paste your **SE Ranking** and **Claude** keys (and
**Google Places** key for the new Local SEO section) → hit **Test** on each →
run an analysis.

---

## OPTION B — Split: frontend on Vercel, backend on Railway

Cleaner long-term. Two URLs.

### Backend (Railway)
Same as Option A steps 1–5, **but skip building/committing `client/dist`** (Vercel
serves the frontend instead). Also add one variable:
```
CLIENT_ORIGIN=https://<your-vercel-app>.vercel.app
```
Copy the Railway domain — you'll need it below.

### Frontend (Vercel)
1. On vercel.com → **Add New → Project** → import the same GitHub repo.
2. **Root Directory: `client`** (important — the frontend lives there).
3. Framework preset: **Vite** (auto-detected via `client/vercel.json`).
4. **Environment Variables**: add
   `VITE_API_BASE = https://<your-railway-domain>` (the backend URL, no trailing slash).
5. Deploy. Vercel gives you `https://<app>.vercel.app` — your frontend URL.

Because the frontend now reads `VITE_API_BASE`, every API call and the logo/PDF
links point at the Railway backend. CORS is already handled by `CLIENT_ORIGIN`.

---

## Local run (optional, to test before deploying)

```bash
# Backend
./setup.sh                 # installs deps, WeasyPrint, fonts, generates .env
# set DB_* or use DB_DIALECT=sqlite for zero setup; set ADMIN_PASSWORD
npm run seed
npm start                  # API on :4000

# Frontend (second terminal)
cd client
npm install
npm run dev                # Vite on :5173, proxies /api to :4000
```
No MySQL handy? Set `DB_DIALECT=sqlite` in `.env` — same schema, zero setup.

---

## Required API keys (entered in Admin → Settings, stored encrypted)

| Key | Needed? | Powers |
|---|---|---|
| SE Ranking | Yes | Rankings, backlinks, DA, competitors, keyword gaps, AI Overview data |
| Claude | Yes | AI visibility test, cover tagline, exec summary, **review sentiment summary** |
| PageSpeed | Recommended | Real Core Web Vitals (free, 25k/day) |
| **Google Places** | For Local SEO | **NAP, review count, rating, review summary, profile activity** |

> **Google Places key setup:** in Google Cloud Console, enable **"Places API (New)"**
> on the project, create an API key, and (optionally) restrict it to that API.
> The same key can also serve PageSpeed if you enable both APIs on it.

---

## What's new in this build

1. **Countries** — the analysis dropdown went from 10 to 36 markets (both the
   live portal and the sandbox).
2. **Google Maps / Local SEO section** — when "Local SEO" is selected and a
   Google Places key is set, the report now pulls and displays:
   - **NAP** (name, address, phone) with a website-match check
   - **review count and average rating**
   - a **Claude-written summary** of review sentiment (from the real reviews)
   - **profile activity** (how recently reviews arrive — a maintenance signal)
   - opening-hours and business-status completeness
   These feed the existing Local SEO score. If the profile isn't found, the
   section renders a clean "you're missing from the map" page instead.

> Honesty note carried in the code and report copy: Google's public Places API
> does **not** expose Google Business Profile *posts*, so the report does not
> claim a post count. It reports review **recency** as an activity proxy and
> labels it as such. Don't let anyone relabel that as "posts" in the copy.
