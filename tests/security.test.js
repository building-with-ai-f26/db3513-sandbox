const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before the server loads. No DATABASE_URL, so accounts use a JSON file here.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortlist-security-'));
process.env.DATA_DIR = dataDir;
delete process.env.DATABASE_URL;

const app = require('../server/index');
const { limitPerVisitor } = require('../server/rate-limits');
const { MAX_FAILED_LOGINS } = require('../server/accounts');

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

function postJson(route, body, headers = {}) {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('every response refuses framing and type sniffing, and hides the framework', async () => {
  for (const route of ['/', '/api/health']) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'");
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(response.headers.get('x-powered-by'), null);
  }
});

test('a change sent from another site is refused before it reaches the route', async () => {
  const body = { email: 'nobody@example.com', password: 'popcorn123' };
  const foreign = await postJson('/api/account/login', body, { Origin: 'https://evil.example' });
  const nullOrigin = await postJson('/api/account/login', body, { Origin: 'null' });

  assert.equal(foreign.status, 403);
  assert.match((await foreign.json()).error, /another site/);
  assert.equal(nullOrigin.status, 403);
});

test('requests from this site, or with no Origin at all, go through', async () => {
  const body = { email: 'nobody@example.com', password: 'popcorn123' };
  const sameSite = await postJson('/api/account/login', body, { Origin: baseUrl });
  const noOrigin = await postJson('/api/account/login', body);

  assert.equal(sameSite.status, 401);
  assert.equal(noOrigin.status, 401);
});

test('reading is never blocked by the Origin check', async () => {
  const response = await fetch(`${baseUrl}/api/account`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(response.status, 200);
});

function fakeResponse() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('each visitor has their own limit, so one person cannot use up everyone else\'s', () => {
  const limit = limitPerVisitor(2, 60 * 1000);
  const hit = (ip) => {
    const res = fakeResponse();
    let passed = false;
    limit({ ip }, res, () => {
      passed = true;
    });
    return passed ? 'ok' : res.statusCode;
  };

  assert.deepEqual([hit('1.1.1.1'), hit('1.1.1.1'), hit('1.1.1.1')], ['ok', 'ok', 429]);
  assert.equal(hit('2.2.2.2'), 'ok');
});

test('repeated wrong passwords lock sign-in for that account, even with the right password', async () => {
  const email = 'locked@example.com';
  await postJson('/api/account/signup', { email, password: 'popcorn123' });

  for (let attempt = 1; attempt <= MAX_FAILED_LOGINS; attempt += 1) {
    assert.equal((await postJson('/api/account/login', { email, password: `wrong-guess-${attempt}` })).status, 401);
  }
  const locked = await postJson('/api/account/login', { email, password: 'popcorn123' });

  assert.equal(locked.status, 429);
  assert.match((await locked.json()).error, /Try again in 15 minutes/);
});

test('a successful sign-in clears earlier misses', async () => {
  const email = 'recovers@example.com';
  await postJson('/api/account/signup', { email, password: 'popcorn123' });
  for (let attempt = 1; attempt < MAX_FAILED_LOGINS; attempt += 1) {
    await postJson('/api/account/login', { email, password: `wrong-guess-${attempt}` });
  }

  assert.equal((await postJson('/api/account/login', { email, password: 'popcorn123' })).status, 200);
  assert.equal((await postJson('/api/account/login', { email, password: 'wrong-again' })).status, 401);
  assert.equal((await postJson('/api/account/login', { email, password: 'popcorn123' })).status, 200);
});

test('an upload with too many form fields is refused', async () => {
  const form = new FormData();
  for (let index = 0; index < 8; index += 1) form.append(`field${index}`, 'x');
  const response = await fetch(`${baseUrl}/api/profiles/0`, { method: 'POST', body: form });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Upload failed/);
});
