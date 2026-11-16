# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** The Shortlist, a web app that picks five to eight movies for tonight, for one person or a blend of two. Picks come from Letterboxd history limited to the streaming services you pay for, or, with no uploads or subscription, from a few quick questions, with where to watch each film.
- **Primary user & core workflow:** See the living PRD in `docs/index.html`. In short: say who's watching (Letterboxd or a few questions), choose tonight's mood, get a shortlist with a "why this pick" line for each film.
- **Tech stack:** Node.js 26 / Express 5 server (`server/`) / plain HTML, CSS and JavaScript front end (`public/`) / JSON files in `data/` for profiles and the TMDB cache (no database) / TMDB API for films and where to watch / Anthropic API (`@anthropic-ai/sdk`, model `claude-opus-5-5`) for picks / PostHog for analytics / Render for hosting (`render.yaml`).

## 2. Commands
- **Set up keys:** `cp .env.example .env`, then fill in `TMDB_API_TOKEN`, `ANTHROPIC_API_KEY`, `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST`. `OPENROUTER_API_KEY` is not used by the app.
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
