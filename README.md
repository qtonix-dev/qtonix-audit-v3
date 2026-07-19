# Qtonix — Free Complete Site Analysis Report Generator

A sales tool. An agent enters four fields, and ninety seconds later they have a branded PDF that shows a prospect exactly how invisible they are — in Google *and* in AI assistants — and what it's costing them.

---

## This round — your five issues

| Reported | Cause | Fixed |
|---|---|---|
| Sandbox said 16 pages, showed 3 | I hardcoded the label and only built 3 sections | **All 12 sections render** — cover, contents, and sections 01–10 |
| No PDF download | Never built it | **Download PDF** on the report and on every list row. Opens a print view → *Save as PDF* |
| No logo / favicon upload | Never built it | Both, with live preview, size limits, and remove. Server endpoints added to match |
| Test button did nothing | It only wrote a log line | **Real validation** — catches wrong-service pastes (`sk-ant-` vs `AIza`), stray spaces, short keys |
| No add-user option | Never built it | Add + edit users: role, phone, designation, password reset, duplicate-email check |
| No date/time, no PDF, no CRM in list | Not built | Full date+time, per-row PDF, **7-stage pipeline**, request tags, remark notes |

### On the PDF download

The browser cannot silently write a file — it needs a user gesture. So **Download PDF** opens a clean print view and calls `window.print()`; you choose *Save as PDF*. That's a browser constraint, not a shortcut.

**On your server this is fully automatic** — WeasyPrint renders it server-side and `/api/reports/:id/download` streams the finished file. The sandbox has no server, hence the print dialog.

### The CRM you asked for

Seven stages: New lead → Contacted → Interested → Proposal sent → Negotiating → Won / Lost. Colour-coded, changeable straight from the list.

Request tags: *Wants pricing · Wants a call · Needs approval · Comparing agencies · Budget constrained · Wants case studies · Ready to start · Follow up later*. Plus a free-text remark per prospect.

Added to MySQL as `stage` (ENUM, indexed), `tags` (JSON), `remark` (TEXT), `followUpAt` (DATETIME), with a `PATCH /api/reports/:id` endpoint.

**One deliberate constraint:** that endpoint touches *only* the CRM fields. An agent can edit their notes; they cannot rewrite the report's findings. There's a test asserting exactly that — an agent PATCHing `{scores:{overall:100}}` is silently ignored. A sales tool where the salesperson can edit the audit score is not a sales tool.

---

## Earlier round's changes

| You asked | Done |
|---|---|
| Numbers wrapping onto 2 lines (p5 `20–30%`) | Fixed — root cause was WeasyPrint breaking after en-dashes. `white-space:nowrap` on all stat/KPI values. Scanned all 16 pages: **zero dangling fragments**. |
| Missing pricing page | Added, matched to your reference — 3 tiers, blue-bordered RECOMMENDED card, strikethrough price, ✓/★ lists, note box, risk-reversal band. |
| Pricing editable in admin | Full editor: prices, currency symbol, features, star features, reorder, add/delete packages, set which is recommended, guarantee text. |
| Test page with no login | **`client/src/Sandbox.jsx`** — the whole app running in your browser. |
| React + MySQL | Migrated Mongoose → **Sequelize + MySQL**. Frontend was already React. |

### One thing worth knowing about the wrap fix

My first attempt inserted Unicode word-joiners (`U+2060`) into the numbers. It crashed the PDF renderer — `fontTools` couldn't map that codepoint into the font's OS/2 Unicode ranges. The same crash appeared again from the 🛡 emoji I'd put in the risk band.

Both are now fixed the right way: wrapping is handled purely in CSS (a layout concern belongs in CSS), and the shield is an inline SVG. **Emoji and exotic Unicode will break this PDF pipeline** — worth knowing before someone pastes one into a pricing blurb.

---

## The sandbox — test everything, no server

**`client/src/Sandbox.jsx`** — a single React file. Drop it in any React+Tailwind project, or paste it into a Claude artifact. No backend, no MySQL, no keys, no credits.

Sign in with **admin@qtonix.com / password123** (or `nancy@qtonix.com` for the agent view).

What's **real** in it — literally the production code:
- the scoring engine, all six dials
- the opportunity maths (volume × CTR-delta × CPC)
- the roadmap impact ÷ effort sort
- the pricing editor, writing the exact JSON shape MySQL stores
- form validation, the 7-day cache rule, the daily cap, role permissions

What's **simulated**: the SE Ranking / Claude / PageSpeed calls (a deterministic fixture per domain — same domain, same numbers), and the PDF is shown as an on-screen preview.

**Try this:** run `zuenascrubs.com` → run it again (cache fires) → Admin → Pricing → change the symbol to `₹` and add a package → reopen the report → the pricing page follows. Then Admin → Branding → change orange to green and watch the whole document change.

---

## Design: exact match to your reference

You were right that my first attempt didn't match. I had rebuilt the report from scratch and borrowed the colours, rather than matching the design. This version is measured from your reference PDF, not eyeballed:

| Element | Reference | This build |
|---|---|---|
| Engine | WeasyPrint 69.0 | **WeasyPrint 69.0** |
| Page | US Letter, 0.87in margins | **identical** |
| Cover gradient | `#0A0E28` → `#0435AC` | **identical** |
| Navy | `#0A0E27` | identical |
| Headline blue | `#005AFF` | identical |
| **Accent** | **`#B4FF24` lime** | **`#FF6A00` orange** ← your change |
| Stat red | `#E5484D` | identical |
| Quote tint | `#EEF3FF` | identical |

Structure matched section by section: cover → contents → The Situation → The Visibility Gap → Problem & Transformation → Health Scorecard → Competitor & Backlink → AI Search Visibility → The Strategy → The Fix, Measured → Let's Begin.

**Two things I found by inspecting the file rather than looking at it:**

1. Your reference was produced by **WeasyPrint**, not Chromium. That matters — Chromium silently ignores CSS `@page` named-page rules, which is what drives the running footers (`MAVIX MARKETING · Law Tutor · SEO Proposal · 3`) and per-page margins. I switched the renderer to WeasyPrint. The PDF also dropped from 3.6MB to 82KB.
2. The lime accent is **cover-only**. Interior section markers (`◆ 01 —— THE SITUATION`) are blue. I had those orange in v1. Now corrected — orange appears on the cover, pills, CTA and quick-win boxes; blue does the interior structural work, exactly as the reference does.

---

## Demo page — no login

```bash
# in .env
DEMO_MODE=true
DEMO_PASSCODE=pick-something        # optional but recommended before sharing
DEMO_DAILY_CAP=15
```

```bash
npm run demo      # or: DEMO_MODE=true npm start
```

Open **`http://your-server:4000/demo`**. Enter a real website, pick services, hit Generate. Full pipeline runs — crawl, SE Ranking, Claude, PDF — with live progress and a download at the end.

**This spends real money on every run**, so it is deliberately hard to abuse:

| Guard | Behaviour |
|---|---|
| `DEMO_MODE` | Off by default. Both the page and the API 404 when false. |
| `DEMO_PASSCODE` | Optional shared secret. Set it before sending the link to anyone. |
| Daily cap | 15 per rolling 24h, global. Configurable. |
| Per-IP | 3 per hour. |
| Domain cache | Re-running a domain from the last 7 days returns the cached report, free. |
| Tagging | Every demo report is `data.demo:true` and can never expose a real client's report. |
| `noindex` | The page asks search engines to stay away. |

**Turn `DEMO_MODE=false` once you've finished checking it.** It's a testing tool, not a public lead magnet — as a public tool it would be a credit-drain vector.

---

## What changed from the original plan

You said "collect data from free tools like SEMrush, Ahrefs." I pushed back on that in the first pass because neither has a usable free API and scraping them would break the tool without warning.

**You having SE Ranking changes everything.** It covers rankings, backlinks, competitors, keyword gaps, site audit, *and* live Google AI Overview citation data — through one legitimate, licensed API. DataForSEO is no longer needed. This is now a cleaner build than originally scoped.

---

## Setup

**Stack:** React (frontend) · Node/Express (API) · **MySQL 5.7+** (Sequelize) · WeasyPrint (PDF)

```bash
# 1. MySQL
mysql -u root -p -e "CREATE DATABASE qtonix_audit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. App
./setup.sh                    # deps, fonts, WeasyPrint, .env with generated secrets
# set DB_USER / DB_PASS / ADMIN_PASSWORD in .env
npm run seed                  # creates tables + your admin account
npm start                     # API on :4000
```

`SCHEMA.sql` documents the tables for your DBA. You don't need to run it — Sequelize creates them on `npm run seed`.

No MySQL to hand? Set `DB_DIALECT=sqlite` and it runs with zero setup. Same schema, same code.

Then sign in → **Admin → Settings** → paste your API keys → hit **Test** on each.

Nothing runs until the keys are in. They're stored AES-256-GCM encrypted in Mongo, never in a file, never sent back to the browser in plaintext.

### Required keys

| Key | Needed? | What it buys you |
|---|---|---|
| **SE Ranking** | Yes | Rankings, backlinks, DA, competitors, keyword gaps, AI Overview data |
| **Claude** | Yes | The AI visibility test, cover tagline, executive summary |
| **PageSpeed** | Recommended | Free, 25k/day. Real-visitor Core Web Vitals |
| **Google Places** | Only for Local SEO | GBP reviews, ratings |

---

## Architecture

```
React (agent portal + admin)
        │ REST + JWT
Express API ──► job queue ──► pipeline (60–180s)
                               ├─ own crawler      (free)
                               ├─ PageSpeed        (free)
                               ├─ SE Ranking       (credits)
                               ├─ Claude           (~$0.05)
                               ├─ scoring engine
                               └─ Handlebars → Chromium → PDF
                                            │
                                        MongoDB
```

**The queue matters.** An audit takes 60–180 seconds. Running that in the HTTP request cycle would time out and hold a connection open. Jobs run in-process by default; set `REDIS_URL` and run `npm run worker` to move them to a separate process when volume justifies it.

---

## What's in the report

Nine pages, matching your reference layout with orange replacing green.

1. **Cover** — dynamic tagline written from the actual findings, health score ring, client + agent block
2. **Executive summary** — three findings, each with a number and a cost
3. **Health scorecard** — six dials, critical issue table, three free quick wins
4. **Competitors** — traffic bars, comparison table, keyword gap
5. **AI visibility** — *the differentiator, see below*
6. **Technical health** — real-visitor Core Web Vitals, problem/after columns
7. **Authority** — backlink donut, toxic split, striking-distance keywords with dollar values
8. **Roadmap** — 30/60/90, sorted by impact ÷ effort
9. **KPIs + CTA** — outcome targets, agent signature

### The AI visibility section is your unfair advantage

Two independent signals, deliberately kept separate:

- **SE Ranking** gives real Google AI Overview citation data — which keywords trigger an AI Overview that *doesn't* cite the prospect.
- **Claude** gets asked 8 genuine buyer questions in the prospect's category, with their brand name never mentioned. We record whether they get named, and who gets named instead.

The output line — *"Across 8 buying questions, AI recommended FIGS 7 times and named you zero times"* — is novel, verifiable, and alarming to an owner. Nobody in your market is putting that in a free audit yet.

**On honesty:** the report says it probed Claude specifically. It does not claim to speak for ChatGPT or Perplexity from a single Claude call — that would be fabricated data, and a prospect who checks would catch it. The multi-engine claim comes from SE Ranking's real cross-engine tracking, which is separate and labelled as such.

---

## Sales psychology, built in

These aren't decoration — each is a deliberate conversion lever:

- **Loss framing.** "You're losing $41K/year" outperforms "you could gain $41K." Same number, roughly double the response.
- **Everything priced.** Traffic value = volume × CTR-by-position × CPC, using real CPC from SE Ranking.
- **The competitor page.** Named rivals, side by side. Losing on a table you didn't ask to be in is what triggers the call.
- **Strategic truncation.** Top 8 issues shown, *"…and 47 more"* counted. The truncation is the upsell.
- **Three free quick wins.** Counterintuitive, but giving away easy value is the strongest credibility signal in the document — it proves the rest of the list is real.
- **Decay clock.** "Valid 14 days. Rankings shift weekly."
- **HTML version.** `/api/reports/:id/view` — so agents can Loom over it. Roughly doubles close rates on audits.

---

## Cost control

Three mechanisms, because "free" plus no limits equals a runaway credit bill:

1. **Daily cap per agent** (default 20) — admin-configurable
2. **7-day domain cache** — re-running a domain returns the existing report; agent can override with "Run fresh"
3. **Credit tracking per report** — visible on the admin dashboard

Rough burn: **~600–1,300 SE Ranking credits + ~$0.05 Claude per report.** The `getBacklinkMetrics` endpoint (10 credits) is used for competitors instead of `getBacklinkSummary` (100) — that alone saves 360 credits per report.

Client-side rate limiting self-caps at 4 req/sec against SE Ranking's hard limit of 5. Breaching it triggers escalating 10-minute lockouts.

---

## Notes for your dev

**Database.** MySQL via Sequelize. `services`, `scores`, `data`, `pricing` and `apiKeys` are JSON columns — MySQL 5.7+ handles these natively. `data` is 100–300KB per report and is **never** selected in list queries (`attributes: { exclude: ['data'] }`); if you add a query, keep that rule.

**Fonts.** Plus Jakarta Sans is installed to `~/.fonts` from the tokotype GitHub repo, not the Google Fonts CDN — the CDN is unreachable from headless Chromium. `setup.sh` handles it.

**PDF rendering: WeasyPrint, not Chromium.** This is not a preference. The design depends on CSS `@page interior { @bottom-left / @bottom-center / @bottom-right }` for running footers and page numbers. Chromium ignores named pages entirely and would drop every footer. WeasyPrint 69 is what produced your reference and what produces this.

**No conic-gradient.** All rings and the donut are SVG `stroke-dasharray`. conic-gradient renders as a flat grey circle in several PDF engines — silently, no error. SVG works everywhere.

**Every data source can fail independently.** A dead PageSpeed call must not cost you the report while the agent is on the phone. Everything is wrapped in `safe()`.

**Logo.** I couldn't fetch your logo — the sandbox blocks external image hosts. Ships with a text mark (`Qtonix.` with orange dot) and an admin upload that replaces it everywhere. Upload a light/transparent PNG for the navy cover.

---

## Verification done

- **46/46 integration tests pass** against a real database (30 core + 16 CRM/favicon) — the full HTTP surface: auth, role permissions, pricing CRUD, key masking, validation, demo gating
- 29/29 unit tests pass (encryption round-trip + tamper-detection, scoring thresholds, CTR curve, opportunity maths, SVG ring geometry, URL normalisation)
- Crawler verified against live HTML — correctly parsed titles, meta, H1s, alt-text gaps, links, robots.txt
- Cover and interior rendered at 100dpi and compared pixel-by-pixel against the reference
- Colour audit across all 15 pages: **zero lime pixels remain**, orange throughout
- Demo page verified: serves correctly, and both gates return 404 when `DEMO_MODE=false`
- Pricing page rendered and compared against the reference
- Wrap fix verified by scanning extracted text across all 16 pages
- All 13 server modules load; all route groups mount
- Both React components compile

**Not yet tested against live API keys** — I don't have your SE Ranking or Claude keys. The endpoints, auth header (`Authorization: Token`), parameters, and response shapes are all built from SE Ranking's current documentation, and the **Test** button in Admin → Settings will confirm each key on first run.

---

## Two decisions still yours

**Legal line.** Don't reproduce SE Ranking branding in the report. Say "backlink data via industry-standard index." The last-page disclaimer is already in.

**Local SEO.** The scoring is built and wired, but the Google Places fetch is stubbed pending your Places key — the section is skipped cleanly if Local SEO isn't selected.

---

Adam G · Project Manager · Qtonix Software Pvt. Ltd. · +91-8249016547
