const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before the server loads. Public mode gives each "browser" its own session,
// as on the live site. No DATABASE_URL, so accounts and setups use JSON files here.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortlist-setup-'));
process.env.DATA_DIR = dataDir;
process.env.PUBLIC_DEPLOY = 'true';
delete process.env.DATABASE_URL;

const app = require('../server/index');

const COMEDY = 35;
const DRAMA = 18;
const FILM_HEADER = 'Date,Name,Year,Letterboxd URI';

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

function send(route, cookies, options = {}) {
  return fetch(`${baseUrl}${route}`, { ...options, headers: { ...options.headers, Cookie: cookies.filter(Boolean).join('; ') } });
}

function sendJson(route, cookies, method, body) {
  return send(route, cookies, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// A browser is its session cookie; signing in adds an account cookie next to it.
async function newBrowser() {
  const response = await send('/api/profiles', []);
  return response.headers.get('set-cookie').split(';')[0];
}

let accountCount = 0;
async function signUp() {
  accountCount += 1;
  const response = await sendJson('/api/account/signup', [], 'POST', {
    email: `setup${accountCount}@example.com`,
    password: 'popcorn123',
  });
  return response.headers.get('set-cookie').split(';')[0];
}

function uploadForm(name) {
  const form = new FormData();
  form.append('name', name);
  form.append('files', new Blob([`${FILM_HEADER},Rating\n2026-01-01,Alpha,2001,https://boxd.it/a,5`]), 'ratings.csv');
  form.append('files', new Blob([`${FILM_HEADER}\n2026-01-01,Alpha,2001,https://boxd.it/a`]), 'watched.csv');
  form.append('files', new Blob([`${FILM_HEADER}\n2026-01-01,Beta,2002,https://boxd.it/b`]), 'watchlist.csv');
  return form;
}

function addProfile(cookies, name) {
  return send('/api/profiles/0', cookies, { method: 'POST', body: uploadForm(name) });
}

async function namesOf(cookies) {
  const { profiles } = await (await send('/api/profiles', cookies)).json();
  return profiles.map((profile) => profile?.name ?? null);
}

function quiz(name = 'Sam') {
  return [{ name, genres: [COMEDY], avoid: [DRAMA], favorites: ['Paddington 2', '', ''], era: 'any' }];
}

test('a signed-in upload belongs to the account, so another browser sees it', async () => {
  const account = await signUp();
  const laptop = await newBrowser();
  const phone = await newBrowser();

  assert.equal((await addProfile([laptop, account], 'Sam')).status, 200);

  assert.deepEqual(await namesOf([phone, account]), ['Sam', null]);
  assert.deepEqual(await namesOf([laptop]), [null, null]);
});

test('signed-in quiz answers follow the account, and need one', async () => {
  const account = await signUp();
  const saved = await sendJson('/api/setup/quiz', [await newBrowser(), account], 'PUT', { quiz: quiz() });

  assert.equal(saved.status, 200);
  const elsewhere = await (await send('/api/setup/quiz', [await newBrowser(), account])).json();
  assert.deepEqual(elsewhere.quiz, quiz());
  assert.equal((await send('/api/setup/quiz', [await newBrowser()])).status, 401);
});

test('half-filled quiz answers can be saved, but malformed ones cannot', async () => {
  const account = await signUp();
  const halfFilled = [{ name: '', genres: [], avoid: [], favorites: [], era: 'any' }];
  const bad = [
    [{ ...quiz()[0], genres: [99999] }],
    [...quiz(), ...quiz(), ...quiz()],
    [{ ...quiz()[0], era: 'future' }],
    [{ ...quiz()[0], favorites: ['a', 'b', 'c', 'd'] }],
    'not a list',
  ];

  assert.equal((await sendJson('/api/setup/quiz', [account], 'PUT', { quiz: halfFilled })).status, 200);
  for (const answers of bad) {
    assert.equal((await sendJson('/api/setup/quiz', [account], 'PUT', { quiz: answers })).status, 400);
  }
});

test("a new account takes this browser's setup on first sign-in, and the browser keeps its copy", async () => {
  const browser = await newBrowser();
  await addProfile([browser], 'Alex');
  const account = await signUp();

  const adopt = await (await sendJson('/api/setup/adopt', [browser, account], 'POST', { quiz: quiz('Alex') })).json();

  assert.equal(adopt.adopted, true);
  assert.deepEqual(await namesOf([await newBrowser(), account]), ['Alex', null]);
  assert.deepEqual((await (await send('/api/setup/quiz', [account])).json()).quiz, quiz('Alex'));
  assert.deepEqual(await namesOf([browser]), ['Alex', null]);
});

test("an account's existing setup is never overwritten by a browser's", async () => {
  const account = await signUp();
  await addProfile([await newBrowser(), account], 'Sam');
  const otherBrowser = await newBrowser();
  await addProfile([otherBrowser], 'Stranger');

  const adopt = await (await sendJson('/api/setup/adopt', [otherBrowser, account], 'POST', { quiz: quiz('Stranger') })).json();

  assert.equal(adopt.adopted, false);
  assert.deepEqual(await namesOf([otherBrowser, account]), ['Sam', null]);
  assert.equal((await (await send('/api/setup/quiz', [account])).json()).quiz, null);
});

test('an empty browser leaves a new account empty', async () => {
  const account = await signUp();
  const adopt = await (await sendJson('/api/setup/adopt', [await newBrowser(), account], 'POST', {})).json();

  assert.equal(adopt.adopted, false);
  assert.deepEqual(await namesOf([account]), [null, null]);
});

test('removing a person while signed in removes them from the account', async () => {
  const account = await signUp();
  await addProfile([await newBrowser(), account], 'Sam');

  await send('/api/profiles/0', [await newBrowser(), account], { method: 'DELETE' });

  assert.deepEqual(await namesOf([await newBrowser(), account]), [null, null]);
});
