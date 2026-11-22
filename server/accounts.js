const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const store = require('./store');

const scrypt = promisify(crypto.scrypt);

const COOKIE_NAME = 'shortlist_account';
const ACCOUNT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const KEY_LENGTH = 64;
const VALID_TOKEN = /^[0-9a-f]{64}$/;
// Loose on purpose: the only real check is that the person can sign in with it later.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_MISMATCH = "That email and password don't match.";
// After this many wrong passwords for one email, sign-in for it pauses, whatever IP the guesses come from.
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_TRACKED_EMAILS = 10000;
const LOCKED_OUT = 'Too many wrong passwords for this account. Try again in 15 minutes.';

// Stored as scrypt$salt$hash, so the salt travels with the hash.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Checked against when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function readCredentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!LOOKS_LIKE_EMAIL.test(email) || email.length > MAX_EMAIL_LENGTH) {
    throw new Error('Enter a valid email address.');
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Use a password of ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`);
  }
  return { email, password };
}

// Only a hash of the token is stored, so a leaked database can't be used to sign in.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readToken(cookieHeader = '') {
  for (const pair of cookieHeader.split(';')) {
    const [name, value] = pair.trim().split('=');
    if (name === COOKIE_NAME && VALID_TOKEN.test(value)) return value;
  }
  return null;
}

// Sets req.user when the browser carries a live sign-in, and leaves it null otherwise.
async function readAccount(req, res, next) {
  req.user = null;
  const token = readToken(req.headers.cookie);
  if (token) {
    const session = await store.findAccountSession(hashToken(token));
    if (session) req.user = await store.findUserById(session.userId);
  }
  next();
}

function createAccountRouter({ secureCookies, limitAttempts }) {
  const router = express.Router();
  // email -> { count, firstAt }. Kept in memory: a restart clears it, which only shortens a lockout.
  const failedLogins = new Map();

  function isLockedOut(email, now = Date.now()) {
    const entry = failedLogins.get(email);
    if (entry && now - entry.firstAt >= LOCKOUT_MS) failedLogins.delete(email);
    return (failedLogins.get(email)?.count ?? 0) >= MAX_FAILED_LOGINS;
  }

  function recordFailedLogin(email, now = Date.now()) {
    const entry = failedLogins.get(email) ?? { count: 0, firstAt: now };
    entry.count += 1;
    failedLogins.set(email, entry);
    // Guesses spread over many emails could grow the map, so expired entries are swept once it's large.
    if (failedLogins.size > MAX_TRACKED_EMAILS) {
      for (const [key, { firstAt }] of failedLogins) {
        if (now - firstAt >= LOCKOUT_MS) failedLogins.delete(key);
      }
    }
  }
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' };

  async function startSession(res, user) {
    const token = crypto.randomBytes(32).toString('hex');
    await store.createAccountSession({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + ACCOUNT_LIFETIME_MS),
    });
    res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ACCOUNT_LIFETIME_MS });
    res.json({ user: { email: user.email } });
  }

  router.get('/', readAccount, (req, res) => {
    res.json({ user: req.user ? { email: req.user.email } : null });
  });

  router.post('/signup', limitAttempts, express.json(), async (req, res) => {
    let credentials;
    try {
      credentials = readCredentials(req.body);
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    const user = { id: crypto.randomUUID(), email: credentials.email };
    try {
      await store.createUser({ ...user, passwordHash: await hashPassword(credentials.password) });
    } catch (error) {
      if (error.code !== 'EMAIL_TAKEN') throw error;
      res.status(409).json({ error: error.message });
      return;
    }
    await startSession(res, user);
  });

  // One message for a wrong email or a wrong password, so neither gives away which accounts exist.
  router.post('/login', limitAttempts, express.json(), async (req, res) => {
    let credentials;
    try {
      credentials = readCredentials(req.body);
    } catch (error) {
      res.status(401).json({ error: LOGIN_MISMATCH });
      return;
    }
    if (isLockedOut(credentials.email)) {
      res.status(429).json({ error: LOCKED_OUT });
      return;
    }
    const user = await store.findUserByEmail(credentials.email);
    const matches = await verifyPassword(credentials.password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !matches) {
      recordFailedLogin(credentials.email);
      res.status(401).json({ error: LOGIN_MISMATCH });
      return;
    }
    failedLogins.delete(credentials.email);
    await startSession(res, user);
  });

  router.post('/logout', async (req, res) => {
    const token = readToken(req.headers.cookie);
    if (token) await store.deleteAccountSession(hashToken(token));
    res.clearCookie(COOKIE_NAME, cookieOptions);
    res.json({ user: null });
  });

  return router;
}

module.exports = {
  MAX_FAILED_LOGINS,
  createAccountRouter,
  readAccount,
  hashPassword,
  verifyPassword,
  ACCOUNT_LIFETIME_MS,
};
