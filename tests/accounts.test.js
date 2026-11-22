const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before the server loads. No DATABASE_URL, so accounts use a JSON file here.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortlist-accounts-'));
process.env.DATA_DIR = dataDir;
delete process.env.DATABASE_URL;

const app = require('../server/index');
const { hashPassword, verifyPassword } = require('../server/accounts');
const { createAccountSession, findUserByEmail } = require('../server/store');

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function post(route, body, cookie) {
  return fetch(`${baseUrl}/api/account${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function whoAmI(cookie) {
  const response = await fetch(`${baseUrl}/api/account`, { headers: cookie ? { Cookie: cookie } : {} });
  return (await response.json()).user;
}

function cookieFrom(response) {
  return response.headers.get('set-cookie').split(';')[0];
}

let emailCount = 0;
function newEmail() {
  emailCount += 1;
  return `person${emailCount}@example.com`;
}

test('a password checks out against its own hash and nothing else', async () => {
  const stored = await hashPassword('correct horse');

  assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('correct horse', stored), true);
  assert.equal(await verifyPassword('wrong horse', stored), false);
  assert.notEqual(await hashPassword('correct horse'), stored);
});

test('nobody is signed in without a cookie', async () => {
  assert.equal(await whoAmI(), null);
});

test('signing up signs you in, with the email lowercased', async () => {
  const response = await post('/signup', { email: '  Sam@Example.COM ', password: 'popcorn123' });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).user, { email: 'sam@example.com' });
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /shortlist_account=[0-9a-f]{64}/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.deepEqual(await whoAmI(cookieFrom(response)), { email: 'sam@example.com' });
});

test('the password is stored only as a hash', async () => {
  await post('/signup', { email: 'hash@example.com', password: 'popcorn123' });

  const saved = fs.readFileSync(path.join(dataDir, 'accounts.json'), 'utf8');
  assert.doesNotMatch(saved, /popcorn123/);
  assert.match((await findUserByEmail('hash@example.com')).passwordHash, /^scrypt\$/);
});

test('an email can only have one account, whatever its case', async () => {
  const email = newEmail();
  await post('/signup', { email, password: 'popcorn123' });
  const response = await post('/signup', { email: email.toUpperCase(), password: 'different1' });

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already exists/);
});

test('signup rejects a bad email or a short password', async () => {
  const badEmail = await post('/signup', { email: 'not-an-email', password: 'popcorn123' });
  const shortPassword = await post('/signup', { email: newEmail(), password: 'short' });

  assert.equal(badEmail.status, 400);
  assert.match((await badEmail.json()).error, /valid email/);
  assert.equal(shortPassword.status, 400);
  assert.match((await shortPassword.json()).error, /8 to 200 characters/);
});

test('logging in works with the right password', async () => {
  const email = newEmail();
  await post('/signup', { email, password: 'popcorn123' });
  const response = await post('/login', { email, password: 'popcorn123' });

  assert.equal(response.status, 200);
  assert.deepEqual(await whoAmI(cookieFrom(response)), { email });
});

test('a wrong password and an unknown email get the same answer', async () => {
  const email = newEmail();
  await post('/signup', { email, password: 'popcorn123' });
  const wrongPassword = await post('/login', { email, password: 'popcorn999' });
  const unknownEmail = await post('/login', { email: 'nobody@example.com', password: 'popcorn123' });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.deepEqual(await wrongPassword.json(), await unknownEmail.json());
  assert.equal(wrongPassword.headers.get('set-cookie'), null);
});

test('logging out ends the session, even for a copied cookie', async () => {
  const response = await post('/signup', { email: newEmail(), password: 'popcorn123' });
  const cookie = cookieFrom(response);
  const logout = await post('/logout', {}, cookie);

  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /shortlist_account=;/);
  assert.equal(await whoAmI(cookie), null);
});

test('an expired session reads as signed out', async () => {
  const email = newEmail();
  await post('/signup', { email, password: 'popcorn123' });
  const user = await findUserByEmail(email);
  const token = crypto.randomBytes(32).toString('hex');
  await createAccountSession({
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    userId: user.id,
    expiresAt: new Date(Date.now() - 1000),
  });

  assert.equal(await whoAmI(`shortlist_account=${token}`), null);
});

test('a malformed cookie is ignored', async () => {
  assert.equal(await whoAmI('shortlist_account=../../etc/passwd'), null);
});
