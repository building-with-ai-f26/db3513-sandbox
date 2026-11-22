const path = require('path');
const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { buildProfile, mergeDiary, summarizeProfile } = require('./letterboxd');
const { normalizeUsername, fetchDiary } = require('./letterboxd-rss');
const { parseNetflixHistory } = require('./netflix');
const { loadProfiles, saveProfiles, deleteExpiredSessions, deleteExpiredAccountSessions } = require('./store');
const { createAccountRouter } = require('./accounts');
const { ensureSchema, closePool } = require('./db');
const { withSession, SESSION_LIFETIME_MS } = require('./sessions');
const { createTmdbClient } = require('./tmdb');
const { buildCandidates, SERVICES, REGIONS } = require('./candidates');
const { buildShortlist, MOODS, QUIZ_PICKS, QUIZ_EFFORT } = require('./shortlist');
const { readAnswers, describeViewer, buildQuizCandidates, GENRES, ERAS } = require('./quiz');
const { createPostHogLogger } = require('./posthog-logs');

const PORT = process.env.PORT || 3000;
const MAX_NAME_LENGTH = 40;
const IS_PUBLIC = process.env.PUBLIC_DEPLOY === 'true';
const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const POSTHOG_KEY = process.env.POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST = process.env.POSTHOG_HOST;

for (const key of ['POSTHOG_PROJECT_TOKEN', 'POSTHOG_HOST']) {
  if (!process.env[key] && process.env.NODE_ENV !== 'production') {
    console.warn(`${key} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${key} is configured`);
  }
}

const { logger: posthogLogger, shutdown: shutdownPostHogLogs } = createPostHogLogger();

function emitPostHogLog(record) {
  try {
    posthogLogger?.emit(record);
  } catch (error) {
    console.warn('PostHog log emission failed.');
  }
}

const app = express();

// Uploads are held in memory just long enough to read them.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
});

// Everything in public/ is sent to the browser, so secrets must never go there.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Provides browser-safe PostHog settings without exposing any server credentials.
app.get('/api/posthog-config', (req, res) => {
  res.json({
    projectToken: POSTHOG_KEY,
    host: POSTHOG_HOST,
    development: process.env.NODE_ENV !== 'production',
  });
});

// Reports only whether each key is set, never the key itself.
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    keys: {
      tmdb: Boolean(process.env.TMDB_API_TOKEN),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      model: Boolean(process.env.ANTHROPIC_MODEL),
    },
  });
});

if (IS_PUBLIC) app.use(['/api/profiles', '/api/shortlist'], withSession);

// One counter for the whole app, which caps the load no matter who is sending.
function limitRequests(maxRequests, windowMs) {
  let windowStart = 0;
  let count = 0;

  return (req, res, next) => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    if (count > maxRequests) {
      res.status(429).json({ error: 'The app is busy right now. Try again later.' });
      return;
    }
    next();
  };
}

const limitUploads = limitRequests(60, ONE_MINUTE_MS);
const limitSearches = limitRequests(20, ONE_MINUTE_MS);
// Every shortlist is a paid Claude call, so this caps what the public site can spend.
const limitDailyShortlists = limitRequests(50, ONE_DAY_MS);
// Slows down anyone guessing passwords.
const limitAccountAttempts = limitRequests(30, ONE_MINUTE_MS);

app.use('/api/account', createAccountRouter({ secureCookies: IS_PUBLIC, limitAttempts: limitAccountAttempts }));

function missingKeysError() {
  if (!process.env.TMDB_API_TOKEN) return 'TMDB_API_TOKEN is not set in .env yet.';
  if (!process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_MODEL) {
    return 'ANTHROPIC_API_KEY and ANTHROPIC_MODEL must be set in .env.';
  }
  return null;
}

function summarizeAll(profiles) {
  return profiles.map((profile) => (profile ? summarizeProfile(profile) : null));
}

function parseSlot(req, res) {
  const slot = Number(req.params.slot);
  if (slot === 0 || slot === 1) return slot;
  res.status(404).json({ error: 'Unknown person.' });
  return null;
}

app.get('/api/profiles', (req, res) => {
  res.json({ profiles: summarizeAll(loadProfiles(req.sessionId)) });
});

app.post('/api/profiles/:slot', limitUploads, upload.array('files'), async (req, res) => {
  const slot = parseSlot(req, res);
  if (slot === null) return;

  const name = (req.body.name || '').trim();
  if (!name || name.length > MAX_NAME_LENGTH) {
    res.status(400).json({ error: `Enter a name of 1 to ${MAX_NAME_LENGTH} characters.` });
    return;
  }
  const hasFiles = Boolean(req.files?.length);
  const usernameInput = (req.body.username || '').trim();
  if (!hasFiles && !usernameInput) {
    res.status(400).json({ error: 'Add your Letterboxd export, your Letterboxd username, or both.' });
    return;
  }

  // Without an export, the profile starts empty and comes only from the diary feed.
  let profile = { name, ratings: [], watched: [], watchlist: [], topRated: [] };
  if (hasFiles) {
    try {
      profile = buildProfile(name, req.files);
    } catch (error) {
      res.status(400).json({ error: `Couldn't read that export. ${error.message}` });
      return;
    }
  }

  // The username can also be added later from the profile card.
  if (usernameInput) {
    try {
      const username = normalizeUsername(usernameInput);
      profile = {
        ...mergeDiary(profile, await fetchDiary(username)),
        letterboxdUsername: username,
        diarySyncedAt: new Date().toISOString(),
      };
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }
  }

  // With no export there's no watchlist, so picks rely on rated films from the diary.
  if (!hasFiles && profile.ratings.length === 0) {
    res.status(400).json({
      error: 'No rated films found. Rate a few films in your Letterboxd diary, or add your export.',
    });
    return;
  }

  const profiles = loadProfiles(req.sessionId);
  profiles[slot] = profile;
  saveProfiles(profiles, req.sessionId);
  res.json({ profiles: summarizeAll(profiles) });
});

app.post('/api/profiles/:slot/netflix', limitUploads, upload.single('file'), (req, res) => {
  const slot = parseSlot(req, res);
  if (slot === null) return;

  const profiles = loadProfiles(req.sessionId);
  if (!profiles[slot]) {
    res.status(404).json({ error: 'Add this person first.' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'Choose your NetflixViewingHistory.csv file first.' });
    return;
  }

  try {
    profiles[slot].netflixTitles = parseNetflixHistory(req.file.buffer.toString('utf8'));
  } catch (error) {
    res.status(400).json({ error: `Couldn't read that file. ${error.message}` });
    return;
  }

  saveProfiles(profiles, req.sessionId);
  res.json({ profiles: summarizeAll(profiles) });
});

// Links a Letterboxd username so recent diary entries are added without a new export.
app.post('/api/profiles/:slot/letterboxd', limitUploads, express.json(), async (req, res) => {
  const slot = parseSlot(req, res);
  if (slot === null) return;

  const profiles = loadProfiles(req.sessionId);
  if (!profiles[slot]) {
    res.status(404).json({ error: 'Add this person first.' });
    return;
  }

  let username;
  let diary;
  try {
    username = normalizeUsername(req.body?.username);
    diary = await fetchDiary(username);
  } catch (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  profiles[slot] = {
    ...mergeDiary(profiles[slot], diary),
    letterboxdUsername: username,
    diarySyncedAt: new Date().toISOString(),
  };
  saveProfiles(profiles, req.sessionId);
  res.json({ profiles: summarizeAll(profiles) });
});

// A feed that can't be reached leaves the profile as it was, so the shortlist still runs.
async function refreshDiaries(profiles) {
  return Promise.all(profiles.map(async (profile) => {
    if (!profile?.letterboxdUsername) return profile;
    try {
      const diary = await fetchDiary(profile.letterboxdUsername);
      return { ...mergeDiary(profile, diary), diarySyncedAt: new Date().toISOString() };
    } catch (error) {
      return profile;
    }
  }));
}

app.delete('/api/profiles/:slot', (req, res) => {
  const slot = parseSlot(req, res);
  if (slot === null) return;

  const profiles = loadProfiles(req.sessionId);
  profiles[slot] = null;
  saveProfiles(profiles, req.sessionId);
  res.json({ profiles: summarizeAll(profiles) });
});

app.get('/api/options', (req, res) => {
  res.json({
    services: SERVICES.map(({ id, name }) => ({ id, name })),
    regions: REGIONS,
    moods: MOODS,
    genres: GENRES,
    eras: ERAS,
  });
});

app.post('/api/shortlist', limitSearches, limitDailyShortlists, express.json(), async (req, res) => {
  const { services: serviceIds, region, mood } = req.body ?? {};
  let profiles = loadProfiles(req.sessionId);

  if (!profiles.some(Boolean)) {
    res.status(400).json({ error: 'Add a person first.' });
    return;
  }
  if (!Array.isArray(serviceIds) || !SERVICES.some(({ id }) => serviceIds.includes(id))) {
    res.status(400).json({ error: 'Pick at least one streaming service.' });
    return;
  }
  if (!REGIONS.includes(region)) {
    res.status(400).json({ error: 'Pick a region from the list.' });
    return;
  }
  if (!MOODS.some(({ id }) => id === mood)) {
    res.status(400).json({ error: "Pick tonight's mood." });
    return;
  }
  if (!process.env.TMDB_API_TOKEN) {
    res.status(503).json({ error: 'TMDB_API_TOKEN is not set in .env yet.' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_MODEL) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY and ANTHROPIC_MODEL must be set in .env.' });
    return;
  }

  profiles = await refreshDiaries(profiles);
  saveProfiles(profiles, req.sessionId);

  const tmdb = createTmdbClient(process.env.TMDB_API_TOKEN);
  try {
    const { candidates, stats } = await buildCandidates({ profiles, serviceIds, region, tmdb });
    const { picks, backups } = await buildShortlist({
      candidates,
      people: profiles.filter(Boolean),
      mood,
      model: process.env.ANTHROPIC_MODEL,
      claude: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    });
    emitPostHogLog({
      severityText: 'INFO',
      body: 'shortlist generation completed',
      attributes: {
        event: 'shortlist_generation_completed',
        workflow: 'profile',
        candidate_count: candidates.length,
        pick_count: picks.length,
      },
    });
    res.json({ picks, backups, candidateCount: candidates.length, stats });
  } catch (error) {
    emitPostHogLog({
      severityText: 'ERROR',
      body: 'shortlist generation failed',
      attributes: {
        event: 'shortlist_generation_failed',
        workflow: 'profile',
        error_type: error.constructor?.name || 'Error',
      },
    });
    res.status(502).json({ error: error.message });
  } finally {
    tmdb.saveCache();
  }
});

// No uploads and nothing saved: the answers arrive with the request and are gone after it.
app.post('/api/quiz-shortlist', limitSearches, limitDailyShortlists, express.json(), async (req, res) => {
  let answers;
  try {
    answers = readAnswers(req.body);
  } catch (error) {
    res.status(400).json({ error: error.message });
    return;
  }
  const keysError = missingKeysError();
  if (keysError) {
    res.status(503).json({ error: keysError });
    return;
  }

  const tmdb = createTmdbClient(process.env.TMDB_API_TOKEN);
  try {
    const { candidates, stats } = await buildQuizCandidates({ ...answers, tmdb });
    const { picks, backups } = await buildShortlist({
      candidates,
      people: answers.people.map(describeViewer),
      mood: answers.mood,
      maxPicks: QUIZ_PICKS,
      effort: QUIZ_EFFORT,
      model: process.env.ANTHROPIC_MODEL,
      claude: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    });
    emitPostHogLog({
      severityText: 'INFO',
      body: 'shortlist generation completed',
      attributes: {
        event: 'shortlist_generation_completed',
        workflow: 'quiz',
        candidate_count: candidates.length,
        pick_count: picks.length,
      },
    });
    res.json({ picks, backups, candidateCount: candidates.length, stats });
  } catch (error) {
    emitPostHogLog({
      severityText: 'ERROR',
      body: 'shortlist generation failed',
      attributes: {
        event: 'shortlist_generation_failed',
        workflow: 'quiz',
        error_type: error.constructor?.name || 'Error',
      },
    });
    res.status(502).json({ error: error.message });
  } finally {
    tmdb.saveCache();
  }
});

// Turns upload problems, such as an oversized file, into a readable message.
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: `Upload failed: ${error.message}` });
    return;
  }
  next(error);
});

// 127.0.0.1 means only this laptop can reach the app. The public host needs 0.0.0.0.
async function start() {
  // Creates the account tables on first run; a no-op without DATABASE_URL.
  await ensureSchema();
  const server = app.listen(PORT, IS_PUBLIC ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`The Shortlist is running on port ${PORT}`);
  });

  let isShuttingDown = false;
  async function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    server.close(async () => {
      try {
        await shutdownPostHogLogs();
      } catch (error) {
        console.warn('PostHog log exporter shutdown failed.');
      }
      await closePool();
      process.exit(0);
    });
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  if (IS_PUBLIC) {
    deleteExpiredSessions(SESSION_LIFETIME_MS);
    setInterval(() => deleteExpiredSessions(SESSION_LIFETIME_MS), ONE_HOUR_MS);
  }
  setInterval(() => deleteExpiredAccountSessions().catch(() => {}), ONE_HOUR_MS);
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`The Shortlist could not start: ${error.message}`);
    process.exit(1);
  });
}

module.exports = app;
