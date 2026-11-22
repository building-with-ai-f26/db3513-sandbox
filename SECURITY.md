# Security review

Reviewed on 2026-11-21, against `main` at `c56d10e` (after the account, saved-shortlist and refine-filter PRs), with the fixes below on the `security-review` branch.

## What kind of app this is

**A sign-in app.** People can create an account with email and password and keep data on the server:

- Saved shortlists, with names.
- Their Letterboxd profiles, which hold their full ratings, watched and watchlist history, plus Netflix viewing history if uploaded.
- Their quiz answers.

It also uses AI: user-supplied text (names, favorite films, Letterboxd titles) goes to Anthropic's Claude API to rank films. It calls TMDB and Letterboxd from the server.

| Part | Where it lives |
|---|---|
| Accounts, sign-in sessions, saved shortlists, account setups | Postgres (Neon) when `DATABASE_URL` is set; JSON files in `data/` otherwise |
| Signed-out profiles | JSON files in `data/sessions/`, one per browser, deleted after 7 days |
| Signed-out quiz answers | The browser's localStorage only |
| Secrets (`TMDB_API_TOKEN`, `ANTHROPIC_API_KEY`, `DATABASE_URL`) | `.env` locally, Render environment settings in production |
| Analytics | PostHog (public project token only) |

## What was checked

| Area | What was looked at |
|---|---|
| Secrets | Every commit in git history scanned for API keys, JWTs and database URLs; which files git tracks; `.gitignore`; `render.yaml`; what `/api/posthog-config` and `/api/health` reveal |
| Dependencies | `npm audit --omit=dev` |
| Passwords and sign-in | Hashing, comparison, timing, token creation and storage, cookie flags, logout, expiry, guessing limits |
| Access control | Every route that reads or changes saved shortlists, profiles and setups: does it check the owner? |
| Injection | SQL (all queries), file paths built from session ids, HTML injection (every place text reaches the page), the Letterboxd username in the feed URL |
| Cross-site attacks | Cookie `SameSite`, how state-changing routes accept bodies, framing (clickjacking) |
| Uploads | Size limits, ZIP handling, CSV parsing, form fields |
| Server-side requests | Whether user input can make the server fetch arbitrary URLs |
| AI | Prompt injection through user text, and what the model's answer can do |
| Abuse and cost | Rate limits on sign-in, uploads, searches and paid Claude calls |
| Error messages and headers | What errors reveal, and which security headers are sent |

## What was found

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | **ZIP bomb.** The Letterboxd upload trusted the uncompressed size written in the ZIP's own header. That value can be forged, so a ~5 MB upload could unpack to gigabytes in memory and crash the server. | High | **Fixed** |
| 2 | **Rate limits were shared by everyone.** One counter for the whole app meant one person sending 30 sign-in attempts a minute blocked sign-in for every user, and one person could use up the 50-per-day budget of paid shortlists for everyone. Password guessing against one account was not limited per account. | Medium | **Fixed** |
| 3 | **No security headers.** Any site could load the app in a frame and trick a signed-in person into clicking something (clickjacking, e.g. "Delete" on a saved shortlist). There was no `nosniff`, and Express announced itself with `X-Powered-By`. | Medium | **Fixed** |
| 4 | **Cross-site requests relied only on `SameSite` cookies.** Safe in current browsers, but a single layer. | Low | **Fixed** (second layer added) |
| 5 | **Upload forms had no limit on the number of text fields** (multer limited files only). | Low | **Fixed** |
| 6 | No way to delete an account or the history stored with it. | Medium (privacy) | Remaining |
| 7 | No password reset and no email verification. | Medium | Remaining |
| 8 | Sign-up says when an email is already registered (account enumeration). | Low | Remaining (accepted) |
| 9 | scrypt uses Node's default cost (N = 16384), below current OWASP guidance (N = 2^17). | Low | Remaining |
| 10 | No full Content-Security-Policy (only `frame-ancestors`). | Low | Remaining |
| 11 | PostHog session replay masking depends on settings in the PostHog dashboard. | Low | Remaining (check settings) |
| 12 | The database connection string uses `sslmode=require`; `pg` warns this will weaken in a future version. | Low | Remaining (config change) |

### Checked and found sound

- **Secrets:** no secrets anywhere in git history. Only `.env.example` (placeholders) is tracked. `.env` and `data/` are ignored, and Render secrets use `sync: false`. `/api/posthog-config` returns only PostHog's public project token, and `/api/health` reports whether keys are set, never their values.
- **Dependencies:** `npm audit` found 0 vulnerabilities.
- **Passwords:**
  - salted scrypt with a random 16-byte salt per password
  - compared with `crypto.timingSafeEqual`
  - an unknown email is checked against a dummy hash, so it takes as long as a wrong password
  - sign-in and sign-up give one message for a wrong email or password
- **Sign-in sessions:**
  - a random 32-byte token in an `httpOnly`, `SameSite=Lax` cookie, `Secure` on the public site
  - only a SHA-256 hash of it is stored, so a leaked database can't be used to sign in
  - tokens expire after 30 days, logout deletes them server-side, and expired ones are swept hourly
- **Access control:** every saved-shortlist and setup query filters by the signed-in user's id, so another account's list returns 404. Tests cover open, rename and delete by another account.
- **SQL injection:** all queries use parameters (`$1`, `$2`…), and none build SQL from user input.
- **File paths:** session ids must match `^[0-9a-f]{64}$` before becoming a file name, and a forged id is replaced. This was already tested.
- **HTML injection:** the front end has no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `eval`. All user, TMDB and AI text is set with `textContent`.
- **Server-side requests:** the only user-influenced fetch is the Letterboxd feed. The host is fixed to `letterboxd.com`, the username must match `^[A-Za-z0-9_]{1,40}$`, and the fetch has a 10-second timeout and a 2 MB cap.
- **AI and prompt injection:** the system prompt tells Claude to treat names and titles as data, never instructions. Its answer must use a fixed JSON schema and can only pick ids from the candidate list. The "why" text is shown with `textContent`, and saved shortlists are re-checked field by field. The worst a crafted name can do is make a reason read oddly.
- **Saved data from the browser:** `POST /api/shortlists` keeps only the fields a card shows, checks types and sizes, and requires poster paths to be TMDB-style paths. Bodies are capped at 100 KB.
- **Errors:** Claude API errors are logged server-side and shown to visitors only as a generic message. Express hides stack traces when `NODE_ENV=production`, which Render sets.

## What was fixed

All fixes are on the `security-review` branch, each with a test.

1. **ZIP bomb** (`server/letterboxd.js`). Entries are now unpacked with `zlib.inflateRawSync(…, { maxOutputLength: 20 MB })`, so the 20 MB limit applies to the real output, not the size the ZIP claims. Unknown compression methods are refused.
   - Test: a 21 MB file in a ZIP whose headers are rewritten to claim 100 bytes. It's refused with "ratings.csv is too large." I confirmed the test fails on the old code.
2. **Per-visitor and per-account limits** (`server/rate-limits.js` (new), `server/index.js`, `server/accounts.js`).
   - Each visitor (by IP) now has their own limit on top of the app-wide caps:

     | Action | Per visitor | App-wide |
     |---|---|---|
     | Sign-in and sign-up | 60 per minute | 300 per minute |
     | Profile uploads | 20 per minute | 60 per minute |
     | Shortlists | 20 per day | 50 per day (still the spend cap) |
     | Person search | 120 per minute | 600 per minute |

   - `trust proxy` is set on the public site so Render's forwarded IP is used.
   - **10 wrong passwords for one email lock its sign-in for 15 minutes**, whatever IP the guesses come from. A successful sign-in clears the count.
   - Both maps sweep expired entries once they pass 10,000, so they can't fill memory.
   - Tests: the per-visitor limiter counts each IP separately; the lockout applies even with the right password; a success resets the count.
3. **Security headers** (`server/index.js`) on every response:
   - `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` (no framing)
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `X-Powered-By` removed

   Test: the headers on the page and on an API route.
4. **Same-site check on changes** (`server/index.js`). A `POST`, `PUT`, `PATCH` or `DELETE` to `/api` whose `Origin` header names another site (or `null`) is refused with 403. Requests from the app itself, and tools that send no `Origin`, are unaffected.
   - Tests: foreign and `null` origins are refused; same-site and no-origin requests pass; reads are never blocked.
5. **Upload field limits** (`server/index.js`). multer now allows at most 5 text fields of 1 KB each.
   - Test: an upload with 8 fields is refused.

Checks run: `npm test` (180 passing, 9 new), plus the headers and same-site rule checked against the running server.

## Remaining issues and recommendations

1. **Account deletion (privacy).** Add "Delete my account". The database already cascades a user's deletion to their sessions, saved shortlists and setup. Until then, deletion means removing the user row by hand in Neon.
2. **Password reset and email verification.** Both need an email service. Until then, a forgotten password can't be recovered, and someone could register an email address they don't own, which blocks the real owner from signing up with it.
3. **Account enumeration at sign-up.** Sign-up says "already exists". Sign-in doesn't leak this, and sign-up is rate-limited per visitor. This is accepted for now; the full fix needs email verification.
4. **Stronger scrypt cost.** Raise N to 2^15–2^17. That needs the stored hash format to record its parameters, so existing hashes keep working, and attention to memory on Render's 512 MB free instance.
5. **Full Content-Security-Policy.** Limit scripts, images and connections to this site, TMDB images and the PostHog host. The inline PostHog loader needs a hash or nonce first.
6. **PostHog.** If session replay is on, confirm in PostHog's project settings that inputs are masked, so typed emails aren't recorded. (Password fields are masked by default.)
7. **Database connection.** End `DATABASE_URL` with `sslmode=verify-full`, both locally and on Render.
8. **Before launch (Build 5):**
   - set a monthly spend limit in the Anthropic console
   - set `DATABASE_URL` on Render
   - keep `PUBLIC_DEPLOY=true` on Render, so per-browser sessions and `Secure` cookies are on
9. **Shared counters in memory.** Rate limits and lockouts live in the server's memory. A restart clears them, and they wouldn't be shared if the app ever ran on more than one instance. Moving them to Postgres would fix both if that's ever needed.
