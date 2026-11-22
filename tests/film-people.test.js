const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before the server loads. TMDB and Claude are fakes, so nothing leaves this machine.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortlist-people-'));
process.env.DATA_DIR = dataDir;
process.env.TMDB_API_TOKEN = 'test-token';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_MODEL = 'test-model';
delete process.env.DATABASE_URL;

const app = require('../server/index');
const { readFilmPeople, filterByFilmPeople } = require('../server/film-people');
const { buildCandidates } = require('../server/candidates');

const PUGH = { id: 1373737, name: 'Florence Pugh' };
const GERWIG = { id: 45400, name: 'Greta Gerwig' };
const COMEDY = 35;

function film(id, { castIds, directorIds, genres = ['Comedy'], keywordIds = [] } = {}) {
  return { id, title: `Film ${id}`, year: '2010', genres, keywordIds, castIds, directorIds, runtime: 100, overview: 'Text', sources: [] };
}

test('up to two actors or directors are accepted, once each, with trimmed names', () => {
  assert.deepEqual(readFilmPeople(undefined), []);
  assert.deepEqual(readFilmPeople([{ ...PUGH, name: ' Florence Pugh ' }, PUGH]), [PUGH]);
  assert.throws(() => readFilmPeople([PUGH, GERWIG, { id: 3, name: 'Third' }]), /up to 2/);
  assert.throws(() => readFilmPeople([{ id: 'x', name: 'Bad' }]), /up to 2/);
  assert.throws(() => readFilmPeople([{ id: 4, name: '' }]), /up to 2/);
});

test('a film features someone in its top-billed cast or as its director, and nothing else counts', () => {
  const films = [
    film(1, { castIds: [PUGH.id], directorIds: [] }),
    film(2, { castIds: [], directorIds: [GERWIG.id] }),
    film(3, { castIds: [7], directorIds: [8] }),
    film(4, {}),
  ];

  assert.deepEqual(filterByFilmPeople(films, [PUGH, GERWIG]).map(({ id }) => id), [1, 2]);
  assert.deepEqual(filterByFilmPeople(films, [{ id: 555, name: 'Nobody' }]), []);
  assert.equal(filterByFilmPeople(films, []), films);
});

// A TMDB that knows who is in which film, and records what it was asked.
function fakeTmdb({ byGenre = {}, byPerson = {}, creditsOf = {} } = {}) {
  const calls = { discover: [] };
  const summary = (id) => ({ id, title: `Film ${id}`, originalTitle: `Film ${id}`, year: '2010' });
  return {
    calls,
    async discoverMovies(params) {
      calls.discover.push(params);
      if (params.page > 1) return [];
      if (params.personIds?.length) return params.personIds.flatMap((id) => byPerson[id] ?? []).map(summary);
      if (params.keywordIds?.length) return [];
      return (params.genreIds ?? []).flatMap((id) => byGenre[id] ?? []).map(summary);
    },
    async searchMovie() {
      return null;
    },
    async findMovie() {
      return null;
    },
    async getRecommendations() {
      return [];
    },
    async searchPeople(query) {
      calls.peopleQuery = query;
      return [{ id: PUGH.id, name: PUGH.name, department: 'Acting', knownFor: 'Midsommar' }];
    },
    async getDetails(id) {
      return {
        ...summary(id),
        status: 'Released',
        runtime: 100,
        posterPath: '/p.jpg',
        overview: 'Text',
        genres: ['Comedy'],
        keywordIds: [],
        castIds: creditsOf[id] ?? [],
        directorIds: [],
        providersByRegion: { US: [8] },
        watchOptionsByRegion: { US: { subscription: ['Netflix'], free: [], rent: [], buy: [] } },
      };
    },
    saveCache() {},
  };
}

test("Letterboxd mode looks for the person's films on the chosen services in the region", async () => {
  const tmdb = fakeTmdb({ byPerson: { [PUGH.id]: [20, 21] }, creditsOf: { 20: [PUGH.id], 21: [PUGH.id] } });
  const profile = { name: 'Sam', ratings: [], watched: [], watchlist: [], topRated: [] };

  const { candidates } = await buildCandidates({ profiles: [profile, null], serviceIds: ['netflix'], region: 'US', tmdb, filmPeople: [PUGH] });

  const call = tmdb.calls.discover.find((params) => params.personIds);
  assert.deepEqual(call, { personIds: [PUGH.id], providerIds: [8], region: 'US' });
  assert.deepEqual(candidates.map(({ id }) => id).sort(), [20, 21]);
  assert.equal(candidates[0].sources[0].because, 'Florence Pugh');
});

let server;
let baseUrl;
let lastRequest = null;

test.before(async () => {
  const pughFilms = [10, 11, 12, 13, 14, 15];
  app.locals.createTmdb = () => fakeTmdb({
    byGenre: { [COMEDY]: [1, 2, 3, 4, 5, 6] },
    byPerson: { [PUGH.id]: pughFilms },
    creditsOf: Object.fromEntries(pughFilms.map((id) => [id, [PUGH.id]])),
  });
  // Answers with the first candidates it was given, so picks are always valid.
  app.locals.createClaude = () => ({
    beta: {
      messages: {
        async create(request) {
          lastRequest = request;
          const { content } = request.messages[0];
          const ids = JSON.parse(content.slice(content.indexOf('{'))).candidates.map(({ id }) => id);
          const slots = request.output_config.format.schema.required.filter((name) => name !== 'plan');
          const answer = Object.fromEntries(slots.map((slot, index) => [slot, { id: ids[index], why: `A reason for film ${ids[index]}.` }]));
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ plan: '', ...answer }) }] };
        },
      },
    },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function quizShortlist(withPeople, subgenres) {
  return fetch(`${baseUrl}/api/quiz-shortlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ people: [{ name: 'Sam', genres: [COMEDY] }], mood: 'light', region: 'US', withPeople, subgenres }),
  });
}

test('person search returns suggestions, and ignores queries that are too short', async () => {
  const found = await (await fetch(`${baseUrl}/api/people?query=Florence`)).json();
  const tooShort = await (await fetch(`${baseUrl}/api/people?query=F`)).json();

  assert.equal(found.people[0].name, 'Florence Pugh');
  assert.deepEqual(tooShort.people, []);
});

test('refining by a person keeps only their films and tells Claude who was asked for', async () => {
  lastRequest = null;
  const body = await (await quizShortlist([PUGH])).json();

  assert.ok(body.picks.length > 0 && body.picks.every((pick) => pick.id >= 10));
  assert.deepEqual(body.withPeople, [PUGH]);
  assert.match(lastRequest.messages[0].content, /"withPeople":\["Florence Pugh"\]/);
  assert.match(lastRequest.system, /Name who is in or behind the film/);
});

test('nobody matching gives an empty shortlist without a paid call', async () => {
  lastRequest = null;
  const body = await (await quizShortlist([{ id: 999, name: 'Nobody Known' }])).json();

  assert.deepEqual(body.picks, []);
  assert.equal(lastRequest, null);
});

test('people and subgenres combine: their films first, then the genre on top', async () => {
  const body = await (await quizShortlist([PUGH], ['heist'])).json();

  assert.ok(body.picks.every((pick) => pick.id >= 10));
  assert.deepEqual(body.subgenres, ['heist']);
  assert.equal(body.subgenresRelaxed, true);
});

test('a malformed people filter is refused before any paid call', async () => {
  lastRequest = null;
  const response = await quizShortlist([{ id: 'x', name: 'Bad' }]);

  assert.equal(response.status, 400);
  assert.equal(lastRequest, null);
});
