const fs = require('fs');
const path = require('path');
const { getPool } = require('./db');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const TMDB_CACHE_FILE = path.join(DATA_DIR, 'tmdb-cache.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const SHORTLISTS_FILE = path.join(DATA_DIR, 'shortlists.json');
const ACCOUNT_SETUPS_FILE = path.join(DATA_DIR, 'account-setups.json');
// A fresh array each time: callers fill slots in place, so a shared one would leak between people.
function emptyProfiles() {
  return [null, null];
}
// Older shortlists drop off past this, so one account can't grow without limit.
const MAX_SAVED_SHORTLISTS = 50;
const UNIQUE_VIOLATION = '23505';

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

// Local runs have no session, so they keep using the single profiles file.
function profilesFile(sessionId) {
  return sessionId ? path.join(SESSIONS_DIR, `${sessionId}.json`) : PROFILES_FILE;
}

// A signed-in person's setup belongs to their account, so it follows them across devices.
// Postgres when DATABASE_URL is set, otherwise one JSON file keyed by user id.
async function loadAccountSetup(userId) {
  const db = getPool();
  if (db) {
    const { rows } = await db.query('SELECT profiles, quiz FROM account_setups WHERE user_id = $1', [userId]);
    return rows[0] ?? null;
  }
  return readJson(ACCOUNT_SETUPS_FILE, {})[userId] ?? null;
}

// Changes only the fields given, so saving profiles never touches quiz answers and the other way round.
async function saveAccountSetup(userId, changes) {
  const db = getPool();
  if (db) {
    const current = (await loadAccountSetup(userId)) ?? { profiles: emptyProfiles(), quiz: null };
    const next = { ...current, ...changes };
    await db.query(
      `INSERT INTO account_setups (user_id, profiles, quiz, updated_at) VALUES ($1, $2, $3, now())
        ON CONFLICT (user_id) DO UPDATE SET profiles = $2, quiz = $3, updated_at = now()`,
      [userId, JSON.stringify(next.profiles), next.quiz === null ? null : JSON.stringify(next.quiz)],
    );
    return;
  }
  const setups = readJson(ACCOUNT_SETUPS_FILE, {});
  setups[userId] = { profiles: emptyProfiles(), quiz: null, ...setups[userId], ...changes };
  writeJson(ACCOUNT_SETUPS_FILE, setups);
}

// The owner is { userId } when signed in, or { sessionId } (undefined locally) when not.
// Always two slots: one filled is solo mode, two filled is blend mode.
async function loadProfiles(owner) {
  if (owner.userId) return (await loadAccountSetup(owner.userId))?.profiles ?? emptyProfiles();
  return readJson(profilesFile(owner.sessionId), emptyProfiles());
}

async function saveProfiles(profiles, owner) {
  if (owner.userId) {
    await saveAccountSetup(owner.userId, { profiles });
    return;
  }
  writeJson(profilesFile(owner.sessionId), profiles);
}

function deleteExpiredSessions(lifetimeMs, now = Date.now()) {
  if (!fs.existsSync(SESSIONS_DIR)) return;

  for (const name of fs.readdirSync(SESSIONS_DIR)) {
    const file = path.join(SESSIONS_DIR, name);
    if (now - fs.statSync(file).mtimeMs > lifetimeMs) fs.rmSync(file, { force: true });
  }
}

function loadTmdbCache() {
  return readJson(TMDB_CACHE_FILE, {});
}

function saveTmdbCache(cache) {
  writeJson(TMDB_CACHE_FILE, cache);
}

// Accounts: Postgres when DATABASE_URL is set, otherwise one JSON file.
// Every function is async so the two can be swapped without callers noticing.
function readAccounts() {
  return readJson(ACCOUNTS_FILE, { users: [], sessions: [] });
}

function emailTaken() {
  const error = new Error('An account with that email already exists. Sign in instead.');
  error.code = 'EMAIL_TAKEN';
  return error;
}

async function createUser({ id, email, passwordHash }) {
  const db = getPool();
  if (db) {
    try {
      await db.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [id, email, passwordHash]);
    } catch (error) {
      throw error.code === UNIQUE_VIOLATION ? emailTaken() : error;
    }
    return;
  }
  const accounts = readAccounts();
  if (accounts.users.some((user) => user.email === email)) throw emailTaken();
  accounts.users.push({ id, email, passwordHash, createdAt: new Date().toISOString() });
  writeJson(ACCOUNTS_FILE, accounts);
}

async function findUserByEmail(email) {
  const db = getPool();
  if (db) {
    const { rows } = await db.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
    return rows[0] ? { id: rows[0].id, email: rows[0].email, passwordHash: rows[0].password_hash } : null;
  }
  return readAccounts().users.find((user) => user.email === email) ?? null;
}

async function findUserById(id) {
  const db = getPool();
  if (db) {
    const { rows } = await db.query('SELECT id, email FROM users WHERE id = $1', [id]);
    return rows[0] ?? null;
  }
  const user = readAccounts().users.find((candidate) => candidate.id === id);
  return user ? { id: user.id, email: user.email } : null;
}

async function createAccountSession({ tokenHash, userId, expiresAt }) {
  const db = getPool();
  if (db) {
    await db.query(
      'INSERT INTO account_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, userId, expiresAt],
    );
    return;
  }
  const accounts = readAccounts();
  accounts.sessions.push({ tokenHash, userId, expiresAt: expiresAt.toISOString() });
  writeJson(ACCOUNTS_FILE, accounts);
}

// An expired session reads as no session.
async function findAccountSession(tokenHash, now = new Date()) {
  const db = getPool();
  if (db) {
    const { rows } = await db.query(
      'SELECT user_id FROM account_sessions WHERE token_hash = $1 AND expires_at > $2',
      [tokenHash, now],
    );
    return rows[0] ? { userId: rows[0].user_id } : null;
  }
  const session = readAccounts().sessions.find(
    (candidate) => candidate.tokenHash === tokenHash && new Date(candidate.expiresAt) > now,
  );
  return session ? { userId: session.userId } : null;
}

async function deleteAccountSession(tokenHash) {
  const db = getPool();
  if (db) {
    await db.query('DELETE FROM account_sessions WHERE token_hash = $1', [tokenHash]);
    return;
  }
  const accounts = readAccounts();
  accounts.sessions = accounts.sessions.filter((session) => session.tokenHash !== tokenHash);
  writeJson(ACCOUNTS_FILE, accounts);
}

async function deleteExpiredAccountSessions(now = new Date()) {
  const db = getPool();
  if (db) {
    await db.query('DELETE FROM account_sessions WHERE expires_at <= $1', [now]);
    return;
  }
  const accounts = readAccounts();
  accounts.sessions = accounts.sessions.filter((session) => new Date(session.expiresAt) > now);
  writeJson(ACCOUNTS_FILE, accounts);
}

// Saved shortlists. Every lookup is by owner as well as id, so nobody can read another account's lists.
function readShortlists() {
  return readJson(SHORTLISTS_FILE, []);
}

async function saveShortlist({ id, userId, details }) {
  const db = getPool();
  if (db) {
    await db.query('INSERT INTO shortlists (id, user_id, details) VALUES ($1, $2, $3)', [id, userId, details]);
    await db.query(
      `DELETE FROM shortlists WHERE user_id = $1 AND id NOT IN (
        SELECT id FROM shortlists WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
      )`,
      [userId, MAX_SAVED_SHORTLISTS],
    );
    return;
  }
  const saved = readShortlists();
  saved.push({ id, userId, createdAt: new Date().toISOString(), details });
  const mine = saved.filter((shortlist) => shortlist.userId === userId);
  const dropped = new Set(mine.slice(0, Math.max(0, mine.length - MAX_SAVED_SHORTLISTS)));
  writeJson(SHORTLISTS_FILE, saved.filter((shortlist) => !dropped.has(shortlist)));
}

function shortlistRow(row) {
  return { id: row.id, createdAt: new Date(row.created_at).toISOString(), details: row.details };
}

// Newest first.
async function listShortlists(userId) {
  const db = getPool();
  if (db) {
    const { rows } = await db.query(
      'SELECT id, created_at, details FROM shortlists WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return rows.map(shortlistRow);
  }
  return readShortlists()
    .filter((shortlist) => shortlist.userId === userId)
    .reverse()
    .map(({ id, createdAt, details }) => ({ id, createdAt, details }));
}

async function getShortlist(userId, id) {
  const db = getPool();
  if (db) {
    const { rows } = await db.query(
      'SELECT id, created_at, details FROM shortlists WHERE user_id = $1 AND id = $2',
      [userId, id],
    );
    return rows[0] ? shortlistRow(rows[0]) : null;
  }
  const found = readShortlists().find((shortlist) => shortlist.userId === userId && shortlist.id === id);
  return found ? { id: found.id, createdAt: found.createdAt, details: found.details } : null;
}

// True when the shortlist was found and renamed.
async function renameShortlist(userId, id, name) {
  const db = getPool();
  if (db) {
    const { rowCount } = await db.query(
      // A blank name is stored as JSON null; a bare SQL NULL would wipe the whole record.
      `UPDATE shortlists SET details = jsonb_set(details, '{name}', COALESCE(to_jsonb($3::text), 'null'::jsonb))
        WHERE user_id = $1 AND id = $2`,
      [userId, id, name],
    );
    return rowCount > 0;
  }
  const saved = readShortlists();
  const found = saved.find((shortlist) => shortlist.userId === userId && shortlist.id === id);
  if (!found) return false;
  found.details.name = name;
  writeJson(SHORTLISTS_FILE, saved);
  return true;
}

// True when something was deleted.
async function deleteShortlist(userId, id) {
  const db = getPool();
  if (db) {
    const { rowCount } = await db.query('DELETE FROM shortlists WHERE user_id = $1 AND id = $2', [userId, id]);
    return rowCount > 0;
  }
  const saved = readShortlists();
  const kept = saved.filter((shortlist) => !(shortlist.userId === userId && shortlist.id === id));
  writeJson(SHORTLISTS_FILE, kept);
  return kept.length < saved.length;
}

module.exports = {
  saveShortlist,
  listShortlists,
  getShortlist,
  renameShortlist,
  deleteShortlist,
  MAX_SAVED_SHORTLISTS,
  createUser,
  findUserByEmail,
  findUserById,
  createAccountSession,
  findAccountSession,
  deleteAccountSession,
  deleteExpiredAccountSessions,
  loadProfiles,
  saveProfiles,
  loadAccountSetup,
  saveAccountSetup,
  deleteExpiredSessions,
  loadTmdbCache,
  saveTmdbCache,
};
