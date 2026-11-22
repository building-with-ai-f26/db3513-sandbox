# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** The Shortlist, a web app that picks five to eight movies for tonight, for one person or a blend of two. Picks come from Letterboxd history limited to the streaming services you pay for, or, with no uploads or subscription, from a few quick questions, with where to watch each film.
- **Primary user & core workflow:** See the living PRD in `docs/index.html`. In short: say who's watching (Letterboxd or a few questions), choose tonight's mood, get a shortlist with a "why this pick" line for each film.
- **Tech stack:** Node.js 26 / Express 5 server (`server/`) / plain HTML, CSS and JavaScript front end (`public/`) / JSON files in `data/` for profiles and the TMDB cache / Postgres (`pg`) for accounts, saved shortlists and signed-in setups when `DATABASE_URL` is set, otherwise JSON files in `data/` / TMDB API for films and where to watch / Anthropic API (`@anthropic-ai/sdk`, model `claude-opus-5-5`) for picks / PostHog for analytics / Render for hosting (`render.yaml`).

## 2. Commands
- **Set up keys:** `cp .env.example .env`, then fill in `TMDB_API_TOKEN`, `ANTHROPIC_API_KEY`, `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST`. `DATABASE_URL` is optional locally (accounts fall back to a JSON file) and required on Render. `OPENROUTER_API_KEY` is not used by the app.
- **Install dependencies:** `npm install`
- **Run locally:** `npm start` (or `npm run dev` to restart on file changes), then open http://localhost:3000
- **Run deterministic tests:** `npm test` (uses a fake TMDB and a fake Claude, so it costs nothing)
- **Run model evals:** Not set up yet; planned for Build 4. Each real shortlist is a paid Claude call.

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.

## 4. Deployment (Render)
The live site runs on Render's free plan from `render.yaml`, with Postgres on Neon. Render rebuilds and redeploys every push to `main`, so a merged PR goes live within a few minutes.

**Before the first deploy (once)**
1. **Anthropic:** add credits and set a monthly spend limit in the Anthropic console (Plans & Billing). Without credit, every shortlist fails with "Claude couldn't build a shortlist."
2. **Neon:** create a Postgres database and copy its connection string, ending it with `?sslmode=verify-full`. The app creates its tables on startup.
3. **Render:** New → Blueprint, pick this repo, and let `render.yaml` create the `the-shortlist` web service. When asked, enter the secrets marked `sync: false`: `TMDB_API_TOKEN`, `ANTHROPIC_API_KEY` and `DATABASE_URL`.
4. **PostHog:** `render.yaml` doesn't list the PostHog settings, so add `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` under the service's Environment tab. Without them, analytics are silently off in production.
5. **Check the fixed settings** in the Environment tab: `NODE_ENV=production` and `PUBLIC_DEPLOY=true`. These give each browser its own profiles, `Secure` cookies and Render's forwarded IP for rate limits.

Never put a secret's value in `render.yaml` or any committed file: secrets go in Render's Environment tab only.

**Every deploy**
1. Merge the PR into `main` after `npm test` passes locally.
2. Watch the deploy in Render's Events and Logs. A good start logs `The Shortlist is running on port …`. Render marks the deploy live once `/api/health` answers.
3. Open `https://<service>.onrender.com/api/health` and confirm every value under `keys` is `true`. That shows the secrets are set without revealing them.
4. **Smoke test the live site:**
   - build one quiz shortlist (one paid Claude call)
   - sign in, save that shortlist, and reopen it from My shortlists
   - confirm one PostHog event arrives
5. If a check fails, roll back (below) before debugging.

**Rollback (about 2 minutes)**
- In Render, open the service → Events, find the last good deploy, and choose **Rollback**. Render serves that build again without rebuilding.
- Then revert the bad merge on GitHub ("Revert" on the PR) so the next push to `main` doesn't redeploy the broken code.
- The database isn't rolled back. Schema changes only add tables (`CREATE TABLE IF NOT EXISTS`), so an older build still works against a newer database.

**What to know about the free plan**
- The service sleeps after about 15 minutes without visitors, so the first request after that takes up to a minute.
- The disk is wiped on every deploy and restart. That clears signed-out browser profiles in `data/sessions/`, the TMDB cache, and in-memory rate limits and sign-in lockouts. Accounts, saved shortlists and signed-in setups survive because they live in Postgres.
- The app-wide cap of 50 shortlists a day (`limitDailyShortlists` in `server/index.js`) is the main guard on Claude spend, alongside the Anthropic spend limit.
