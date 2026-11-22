const fs = require('fs');
const path = require('path');
const { getPool } = require('./db');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const TMDB_CACHE_FILE = path.join(DATA_DIR, 'tmdb-cache.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
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

// Always two slots: one filled is solo mode, two filled is blend mode.
function loadProfiles(sessionId) {
  return readJson(profilesFile(sessionId), [null, null]);
}

function saveProfiles(profiles, sessionId) {
  writeJson(profilesFile(sessionId), profiles);
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

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  createAccountSession,
  findAccountSession,
  deleteAccountSession,
  deleteExpiredAccountSessions,
  loadProfiles,
  saveProfiles,
  deleteExpiredSessions,
  loadTmdbCache,
  saveTmdbCache,
};
