const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before the server loads. Dummy keys only pass the "keys are set" check;
// TMDB and Claude are fakes, so nothing leaves this machine.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortlist-subgenres-'));
process.env.DATA_DIR = dataDir;
process.env.TMDB_API_TOKEN = 'test-token';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_MODEL = 'test-model';
delete process.env.DATABASE_URL;

const app = require('../server/index');
const { SUBGENRES, readSubgenres, filterBySubgenres } = require('../server/subgenres');
const { buildShortlist } = require('../server/shortlist');
const { buildQuizCandidates, GENRES } = require('../server/quiz');

const HEIST = SUBGENRES.find((subgenre) => subgenre.id === 'heist');
const SLASHER = SUBGENRES.find((subgenre) => subgenre.id === 'slasher');
const HEIST_TAG = HEIST.keywords[0];
const COMEDY = 35;

function film(id, genres, keywordIds) {
  return { id, title: `Film ${id}`, year: '2010', genres, keywordIds, runtime: 100, overview: 'Text', sources: [] };
}

test('every subgenre names real TMDB genres and at least one keyword', () => {
  const genreNames = GENRES.map((genre) => genre.name);
  assert.equal(new Set(SUBGENRES.map((subgenre) => subgenre.id)).size, SUBGENRES.length);
  for (const subgenre of SUBGENRES) {
    assert.ok(subgenre.genres.length > 0 && subgenre.genres.every((name) => genreNames.includes(name)), subgenre.id);
    assert.ok(subgenre.keywords.length > 0 && subgenre.keywords.every(Number.isInteger), subgenre.id);
    assert.ok(subgenre.group && subgenre.description, subgenre.id);
  }
});

test('up to three known subgenres are accepted, once each', () => {
  assert.deepEqual(readSubgenres(undefined), []);
  assert.deepEqual(readSubgenres(['heist', 'heist', 'slasher']).map(({ id }) => id), ['heist', 'slasher']);
  assert.throws(() => readSubgenres(['heist', 'slasher', 'spy', 'space']), /up to 3/);
  assert.throws(() => readSubgenres(['not-a-genre']), /from the list/);
  assert.throws(() => readSubgenres('heist'), /from the list/);
});

test('a film needs both a main genre and a keyword tag to match', () => {
  const tagged = [1, 2, 3, 4, 5].map((id) => film(id, ['Crime'], [HEIST_TAG]));
  const wrongGenre = film(6, ['Documentary'], [HEIST_TAG]);
  const untagged = film(7, ['Crime'], []);
  const oldCache = film(8, ['Crime'], undefined);

  const { candidates, relaxed } = filterBySubgenres([...tagged, wrongGenre, untagged, oldCache], [HEIST]);

  assert.equal(relaxed, false);
  assert.deepEqual(candidates.map(({ id }) => id), [1, 2, 3, 4, 5]);
});

test('with too few tagged films, the main genres are kept and the result says so', () => {
  const films = [film(1, ['Crime'], [HEIST_TAG]), film(2, ['Crime'], []), film(3, ['Thriller'], undefined), film(4, ['Romance'], [])];

  const { candidates, relaxed } = filterBySubgenres(films, [HEIST]);

  assert.equal(relaxed, true);
  assert.deepEqual(candidates.map(({ id }) => id), [1, 2, 3]);
});

test('several subgenres match a film tagged with any of them', () => {
  const films = [
    ...[1, 2, 3].map((id) => film(id, ['Crime'], [HEIST_TAG])),
    ...[4, 5].map((id) => film(id, ['Horror'], [SLASHER.keywords[0]])),
    film(6, ['Horror'], [HEIST_TAG]),
  ];
  assert.deepEqual(filterBySubgenres(films, [HEIST, SLASHER]).candidates.map(({ id }) => id), [1, 2, 3, 4, 5]);
});

test('no subgenres leaves the candidates alone', () => {
  const films = [film(1, ['Crime'], [])];
  assert.deepEqual(filterBySubgenres(films, []), { candidates: films, relaxed: false });
});

function recordingClaude() {
  const claude = {
    requests: [],
    beta: {
      messages: {
        async create(request) {
          claude.requests.push(request);
          const slots = request.output_config.format.schema.required.filter((name) => name !== 'plan');
          const answer = Object.fromEntries(slots.map((slot, index) => [slot, { id: index + 1, why: `A reason for film ${index + 1}.` }]));
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] };
        },
      },
    },
  };
  return claude;
}

test('Claude is told the subgenres, with what each means, only when some are chosen', async () => {
  const candidates = [1, 2, 3, 4, 5, 6].map((id) => film(id, ['Crime'], [HEIST_TAG]));
  const people = [{ name: 'Sam', topRated: [] }];
  const withGenres = recordingClaude();
  const without = recordingClaude();

  await buildShortlist({ candidates, people, mood: 'light', model: 'm', claude: withGenres, subgenres: [HEIST] });
  await buildShortlist({ candidates, people, mood: 'light', model: 'm', claude: without });

  const { content } = withGenres.requests[0].messages[0];
  const sent = JSON.parse(content.slice(content.indexOf('{')));
  assert.deepEqual(sent.subgenres, [{ name: HEIST.name, description: HEIST.description }]);
  assert.match(withGenres.requests[0].system, /asked for the subgenres/);
  assert.doesNotMatch(without.requests[0].system, /subgenres/);
  assert.equal(JSON.parse(without.requests[0].messages[0].content.split('\n\n')[1]).subgenres, undefined);
});

// A TMDB that knows which films carry which keyword, and records what it was asked.
function fakeTmdb({ byGenre = {}, byKeyword = {}, keywordsOf = {} } = {}) {
  const calls = { discover: [] };
  const summary = (id) => ({ id, title: `Film ${id}`, originalTitle: `Film ${id}`, year: '2010' });
  return {
    calls,
    async discoverMovies(params) {
      calls.discover.push(params);
      if (params.page !== 1) return [];
      if (params.keywordIds?.length) return params.keywordIds.flatMap((id) => byKeyword[id] ?? []).map(summary);
      return params.genreIds.flatMap((id) => byGenre[id] ?? []).map(summary);
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
        genres: keywordsOf[id] ? ['Crime'] : ['Comedy'],
        keywordIds: keywordsOf[id] ?? [],
        providersByRegion: {},
        watchOptionsByRegion: { US: { subscription: [], free: ['Tubi'], rent: [], buy: [] } },
      };
    },
    saveCache() {},
  };
}

test('the quiz pool also pulls in films tagged with the chosen subgenres, for every viewer', async () => {
  const tmdb = fakeTmdb({ byGenre: { [COMEDY]: [1, 2] }, byKeyword: { [HEIST_TAG]: [10, 11] }, keywordsOf: { 10: [HEIST_TAG], 11: [HEIST_TAG] } });
  const people = [
    { name: 'Sam', genreIds: [COMEDY], avoidGenreIds: [], era: 'any', favorites: [] },
    { name: 'Alex', genreIds: [COMEDY], avoidGenreIds: [], era: 'any', favorites: [] },
  ];

  const { candidates } = await buildQuizCandidates({ people, region: 'US', tmdb, subgenres: [HEIST] });

  assert.ok(tmdb.calls.discover.some((call) => call.keywordIds?.includes(HEIST_TAG)));
  const heistFilm = candidates.find((candidate) => candidate.id === 10);
  assert.deepEqual(heistFilm.sources.map(({ person }) => person), ['Sam', 'Alex']);
});

let server;
let baseUrl;

test.before(async () => {
  const tagged = [10, 11, 12, 13, 14, 15];
  app.locals.createTmdb = () => fakeTmdb({
    byGenre: { [COMEDY]: [1, 2, 3, 4, 5, 6] },
    byKeyword: { [HEIST_TAG]: tagged },
    keywordsOf: Object.fromEntries(tagged.map((id) => [id, [HEIST_TAG]])),
  });
  app.locals.createClaude = () => {
    const claude = recordingClaude();
    app.locals.lastClaude = claude;
    // Answers with the first candidates it was given, so picks are always valid.
    claude.beta.messages.create = async (request) => {
      claude.requests.push(request);
      const { content } = request.messages[0];
      const ids = JSON.parse(content.slice(content.indexOf('{'))).candidates.map(({ id }) => id);
      const slots = request.output_config.format.schema.required.filter((name) => name !== 'plan');
      const answer = Object.fromEntries(slots.map((slot, index) => [slot, { id: ids[index], why: `A reason for film ${ids[index]}.` }]));
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ plan: '', ...answer }) }] };
    };
    return claude;
  };
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function quizShortlist(subgenres) {
  return fetch(`${baseUrl}/api/quiz-shortlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ people: [{ name: 'Sam', genres: [COMEDY] }], mood: 'light', region: 'US', subgenres }),
  });
}

test('a refined shortlist only offers tagged films and reports the subgenres', async () => {
  const response = await quizShortlist(['heist']);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.subgenres, ['heist']);
  assert.equal(body.subgenresRelaxed, false);
  assert.ok(body.picks.length > 0 && body.picks.every((pick) => pick.id >= 10));
  const { content } = app.locals.lastClaude.requests[0].messages[0];
  assert.match(content, /"subgenres":\[\{"name":"Heist"/);
});

test('an unknown or excessive subgenre list is refused before any paid call', async () => {
  app.locals.lastClaude = null;
  assert.equal((await quizShortlist(['not-a-genre'])).status, 400);
  assert.equal((await quizShortlist(['heist', 'spy', 'space', 'slasher'])).status, 400);
  assert.equal(app.locals.lastClaude, null);
});

test('the browser gets the subgenre list without the matching details', async () => {
  const { subgenres } = await (await fetch(`${baseUrl}/api/options`)).json();
  assert.equal(subgenres.length, SUBGENRES.length);
  assert.deepEqual(Object.keys(subgenres[0]).sort(), ['group', 'id', 'name']);
});
