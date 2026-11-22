const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before the server loads. Dummy keys only pass the "keys are set" check;
// TMDB and Claude are swapped for fakes below, so nothing leaves this machine.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortlist-saved-'));
process.env.DATA_DIR = dataDir;
process.env.TMDB_API_TOKEN = 'test-token';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_MODEL = 'test-model';
delete process.env.DATABASE_URL;

const app = require('../server/index');
const { saveShortlist, listShortlists, findUserByEmail, MAX_SAVED_SHORTLISTS } = require('../server/store');

const COMEDY = 35;
const FILM_IDS = [1, 2, 3, 4, 5, 6];

function fakeTmdb(filmIds) {
  const summary = (id) => ({ id, title: `Film ${id}`, originalTitle: `Film ${id}`, year: '2010' });
  return {
    async discoverMovies({ page }) {
      return page === 1 ? filmIds.map(summary) : [];
    },
    async findMovie() {
      return null;
    },
    async getRecommendations() {
      return [];
    },
    async getDetails(id) {
      return {
        ...summary(id),
        status: 'Released',
        runtime: 100,
        posterPath: '/p.jpg',
        overview: 'Text',
        genres: ['Comedy'],
        providersByRegion: {},
        watchOptionsByRegion: { US: { subscription: [], free: ['Tubi'], rent: [], buy: [] } },
      };
    },
    saveCache() {},
  };
}

// Answers with every candidate, best last, so the ranking is visible in the saved order.
function fakeClaude() {
  return {
    beta: {
      messages: {
        async create({ output_config: { format } }) {
          const slots = format.schema.required.filter((name) => name !== 'plan');
          const ids = [...FILM_IDS].reverse();
          const answer = Object.fromEntries(slots.map((slot, index) => [slot, { id: ids[index], why: `A reason for film ${ids[index]}.` }]));
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ plan: '', ...answer }) }] };
        },
      },
    },
  };
}

let server;
let baseUrl;

test.before(async () => {
  app.locals.createTmdb = () => fakeTmdb(FILM_IDS);
  app.locals.createClaude = fakeClaude;
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function request(route, { method = 'GET', body, cookie } = {}) {
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

let accountCount = 0;
async function signUp() {
  accountCount += 1;
  const email = `viewer${accountCount}@example.com`;
  const response = await request('/api/account/signup', { method: 'POST', body: { email, password: 'popcorn123' } });
  return { email, cookie: response.headers.get('set-cookie').split(';')[0] };
}

function buildQuizShortlist(cookie) {
  return request('/api/quiz-shortlist', {
    method: 'POST',
    cookie,
    body: { people: [{ name: 'Sam', genres: [COMEDY] }], mood: 'light', region: 'US' },
  });
}

// What the browser sends when someone presses Save shortlist.
function saveBody(built) {
  return { mode: 'quiz', mood: 'light', viewers: ['Sam'], picks: built.picks, backups: built.backups };
}

async function buildAndSave(cookie) {
  const built = await (await buildQuizShortlist(cookie)).json();
  const response = await request('/api/shortlists', { method: 'POST', cookie, body: saveBody(built) });
  return { built, response, id: (await response.json()).id };
}

test('building a shortlist never saves it on its own', async () => {
  const { cookie } = await signUp();
  const built = await (await buildQuizShortlist(cookie)).json();

  assert.equal(built.picks.length, 6);
  assert.equal(built.savedId, undefined);
  assert.deepEqual((await (await request('/api/shortlists', { cookie })).json()).shortlists, []);
});

test('saving and listing need an account', async () => {
  const built = await (await buildQuizShortlist()).json();
  const save = await request('/api/shortlists', { method: 'POST', body: saveBody(built) });
  const list = await request('/api/shortlists');

  assert.equal(save.status, 401);
  assert.equal(list.status, 401);
  assert.match((await list.json()).error, /Sign in/);
});

test('a saved shortlist can be listed and opened', async () => {
  const { cookie } = await signUp();
  const { built, response, id } = await buildAndSave(cookie);

  assert.equal(response.status, 200);
  assert.match(id, /^[0-9a-f-]{36}$/);
  const { shortlists } = await (await request('/api/shortlists', { cookie })).json();
  assert.equal(shortlists.length, 1);
  assert.equal(shortlists[0].id, id);
  assert.equal(shortlists[0].mood, 'Light and easy');
  assert.deepEqual(shortlists[0].viewers, ['Sam']);
  assert.deepEqual(shortlists[0].titles, built.picks.map((pick) => pick.title));

  const saved = await (await request(`/api/shortlists/${id}`, { cookie })).json();
  assert.deepEqual(saved.picks.map((pick) => [pick.id, pick.title, pick.why]), built.picks.map((pick) => [pick.id, pick.title, pick.why]));
  assert.equal(saved.backups.length, built.backups.length);
  assert.equal(saved.mode, 'quiz');
  assert.equal(saved.moodName, 'Light and easy');
});

test("one account can't open or delete another account's shortlist", async () => {
  const owner = await signUp();
  const other = await signUp();
  const { id: savedId } = await buildAndSave(owner.cookie);

  assert.equal((await request(`/api/shortlists/${savedId}`, { cookie: other.cookie })).status, 404);
  assert.equal((await request(`/api/shortlists/${savedId}`, { method: 'DELETE', cookie: other.cookie })).status, 404);
  assert.deepEqual((await (await request('/api/shortlists', { cookie: other.cookie })).json()).shortlists, []);
  assert.equal((await request(`/api/shortlists/${savedId}`, { cookie: owner.cookie })).status, 200);
});

test('deleting a saved shortlist removes it once', async () => {
  const { cookie } = await signUp();
  const { id: savedId } = await buildAndSave(cookie);

  const first = await request(`/api/shortlists/${savedId}`, { method: 'DELETE', cookie });
  const second = await request(`/api/shortlists/${savedId}`, { method: 'DELETE', cookie });

  assert.equal(first.status, 200);
  assert.equal(second.status, 404);
  assert.deepEqual((await (await request('/api/shortlists', { cookie })).json()).shortlists, []);
});

test('a saved pick keeps only the fields a card shows', async () => {
  const { cookie } = await signUp();
  const built = await (await buildQuizShortlist(cookie)).json();
  const body = saveBody(built);
  body.picks[0] = { ...body.picks[0], sources: [{ person: 'Sam' }], extra: 'x'.repeat(50) };
  const { id } = await (await request('/api/shortlists', { method: 'POST', cookie, body })).json();

  const saved = await (await request(`/api/shortlists/${id}`, { cookie })).json();
  assert.equal(saved.picks[0].extra, undefined);
  assert.equal(saved.picks[0].sources, undefined);
  assert.deepEqual(saved.picks[0].watchOptions, { free: ['Tubi'], subscription: [], rent: [], buy: [] });
});

test('a malformed save is refused', async () => {
  const { cookie } = await signUp();
  const built = await (await buildQuizShortlist(cookie)).json();
  const bad = [
    { ...saveBody(built), picks: [] },
    { ...saveBody(built), picks: Array(9).fill(built.picks[0]) },
    { ...saveBody(built), mode: 'netflix' },
    { ...saveBody(built), mood: 'sad' },
    { ...saveBody(built), viewers: [] },
    { ...saveBody(built), picks: [{ ...built.picks[0], title: 42 }] },
    { ...saveBody(built), picks: [{ ...built.picks[0], posterPath: 'https://example.com/x.jpg' }] },
  ];

  for (const body of bad) {
    const response = await request('/api/shortlists', { method: 'POST', cookie, body });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /can't be saved/);
  }
  assert.deepEqual((await (await request('/api/shortlists', { cookie })).json()).shortlists, []);
});

test(`an account keeps its newest ${MAX_SAVED_SHORTLISTS} shortlists`, async () => {
  const { email } = await signUp();
  const user = await findUserByEmail(email);
  for (let index = 1; index <= MAX_SAVED_SHORTLISTS + 1; index += 1) {
    await saveShortlist({ id: `list-${index}`, userId: user.id, details: { picks: [] } });
  }

  const saved = await listShortlists(user.id);
  assert.equal(saved.length, MAX_SAVED_SHORTLISTS);
  assert.equal(saved[0].id, `list-${MAX_SAVED_SHORTLISTS + 1}`);
  assert.ok(saved.every(({ id }) => id !== 'list-1'));
});

test('a shortlist can be saved with a name, trimmed, or without one', async () => {
  const { cookie } = await signUp();
  const built = await (await buildQuizShortlist(cookie)).json();
  await request('/api/shortlists', { method: 'POST', cookie, body: { ...saveBody(built), name: '  Friday with Alex  ' } });
  await request('/api/shortlists', { method: 'POST', cookie, body: { ...saveBody(built), name: '   ' } });

  const { shortlists } = await (await request('/api/shortlists', { cookie })).json();
  assert.deepEqual(shortlists.map((saved) => saved.name), [null, 'Friday with Alex']);
});

test('a name over 60 characters is refused', async () => {
  const { cookie } = await signUp();
  const built = await (await buildQuizShortlist(cookie)).json();
  const response = await request('/api/shortlists', { method: 'POST', cookie, body: { ...saveBody(built), name: 'x'.repeat(61) } });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /up to 60 characters/);
});

test('a saved shortlist can be renamed, or have its name cleared, by its owner only', async () => {
  const owner = await signUp();
  const other = await signUp();
  const { id } = await buildAndSave(owner.cookie);
  const rename = (cookie, name) => request(`/api/shortlists/${id}`, { method: 'PATCH', cookie, body: { name } });

  const renamed = await rename(owner.cookie, ' Date night ');
  assert.equal(renamed.status, 200);
  assert.deepEqual(await renamed.json(), { name: 'Date night' });
  assert.equal((await (await request(`/api/shortlists/${id}`, { cookie: owner.cookie })).json()).name, 'Date night');

  assert.equal((await rename(other.cookie, 'Mine now')).status, 404);
  assert.equal((await rename(owner.cookie, 'x'.repeat(61))).status, 400);
  assert.equal((await rename(owner.cookie, 42)).status, 400);

  assert.equal((await rename(owner.cookie, '')).status, 200);
  const saved = await (await request(`/api/shortlists/${id}`, { cookie: owner.cookie })).json();
  assert.equal(saved.name, null);
  assert.equal(saved.picks.length, 6);
});
