const test = require('node:test');
const assert = require('node:assert/strict');
const {
  readAnswers,
  describeViewer,
  buildQuizCandidates,
  eraYears,
  MAX_CANDIDATES_CHECKED,
} = require('../server/quiz');

// Made-up films and a pretend TMDB, so these tests never touch the network.
const COMEDY = 35;
const DRAMA = 18;
const HORROR = 27;
const WATCH_ON_TUBI = { US: { subscription: [], free: ['Tubi'], rent: [], buy: [] } };

function fakeTmdb(movies, { discover = {}, recommendations = {} } = {}) {
  const calls = { discover: [], details: [] };
  const summary = ({ id, title, year }) => ({ id, title, originalTitle: title, year });
  const byId = (id) => movies.find((movie) => movie.id === id);

  return {
    calls,
    async discoverMovies(params) {
      calls.discover.push(params);
      const key = params.genreIds.join('|');
      return params.page === 1 ? (discover[key] ?? []).map((id) => summary(byId(id))) : [];
    },
    async findMovie(name) {
      const movie = movies.find((m) => m.title === name);
      return movie ? summary(movie) : null;
    },
    async getRecommendations(id) {
      return (recommendations[id] ?? []).map((movieId) => summary(byId(movieId)));
    },
    async getDetails(id) {
      calls.details.push(id);
      const movie = byId(id);
      const details = {
        ...summary(movie),
        status: movie.status ?? 'Released',
        runtime: 100,
        posterPath: '/p.jpg',
        overview: '',
        genres: movie.genres ?? [],
        providersByRegion: {},
      };
      if (movie.watch !== null) details.watchOptionsByRegion = movie.watch ?? WATCH_ON_TUBI;
      return details;
    },
  };
}

function movie(id, overrides = {}) {
  return { id, title: `Film ${id}`, year: '2010', ...overrides };
}

function answers(overrides = {}) {
  return {
    people: [{ name: 'Sam', genres: [COMEDY] }],
    mood: 'light',
    region: 'US',
    ...overrides,
  };
}

function run(tmdb, people, region = 'US') {
  return buildQuizCandidates({ people: readAnswers(answers({ people })).people, region, tmdb });
}

test('reads one person with defaults for the optional answers', () => {
  const { people, mood, region } = readAnswers(answers());

  assert.deepEqual(people, [{ name: 'Sam', genreIds: [COMEDY], avoidGenreIds: [], era: 'any', favorites: [] }]);
  assert.equal(mood, 'light');
  assert.equal(region, 'US');
});

test('rejects answers that are missing or out of range', () => {
  const cases = [
    [{ people: [] }, /one or two people/],
    [{ people: [{ name: 'A', genres: [COMEDY] }, { name: 'B', genres: [COMEDY] }, { name: 'C', genres: [COMEDY] }] }, /one or two/],
    [{ people: [{ name: ' ', genres: [COMEDY] }] }, /name/],
    [{ people: [{ name: 'Sam', genres: [] }] }, /at least one genre/],
    [{ people: [{ name: 'Sam', genres: [12345] }] }, /from the list/],
    [{ people: [{ name: 'Sam', genres: [COMEDY], avoid: [COMEDY] }] }, /both/],
    [{ people: [{ name: 'Sam', genres: [COMEDY], favorites: ['a', 'b', 'c', 'd'] }] }, /up to 3/],
    [{ people: [{ name: 'Sam', genres: [COMEDY], era: 'future' }] }, /era/],
    [{ region: 'XX' }, /region/],
    [{ mood: 'sleepy' }, /mood/],
  ];
  for (const [overrides, message] of cases) {
    assert.throws(() => readAnswers(answers(overrides)), message);
  }
  assert.throws(() => readAnswers(undefined), /one or two people/);
});

test('turns eras into year ranges', () => {
  const now = new Date('2026-11-16');

  assert.deepEqual(eraYears('any', now), {});
  assert.deepEqual(eraYears('classic', now), { toYear: 1979 });
  assert.deepEqual(eraYears('modern', now), { fromYear: 2000 });
  assert.deepEqual(eraYears('recent', now), { fromYear: 2021 });
});

test('describes a viewer by their interests, using genre names', () => {
  const [person] = readAnswers(answers({
    people: [{ name: 'Sam', genres: [COMEDY], avoid: [HORROR], favorites: ['Alpha'], era: 'modern' }],
  })).people;

  assert.deepEqual(describeViewer(person), {
    name: 'Sam',
    interests: { into: ['Comedy'], skip: ['Horror'], lovedLately: ['Alpha'], era: '2000 onward' },
  });
});

test('finds films from each person genres and skips everyone avoided genres', async () => {
  const tmdb = fakeTmdb([movie(1), movie(2)], { discover: { [COMEDY]: [1], [DRAMA]: [2] } });
  const { candidates } = await run(tmdb, [
    { name: 'Sam', genres: [COMEDY], avoid: [HORROR] },
    { name: 'Alex', genres: [DRAMA], era: 'classic' },
  ]);

  assert.deepEqual(candidates.map(({ id }) => id), [1, 2]);
  assert.deepEqual(candidates[0].sources, [{ type: 'interest', person: 'Sam' }]);
  assert.deepEqual(tmdb.calls.discover[0].avoidGenreIds, [HORROR]);
  assert.equal(tmdb.calls.discover.find((call) => call.genreIds[0] === DRAMA).toYear, 1979);
});

test('a film both people would find comes first and lists both', async () => {
  const tmdb = fakeTmdb([movie(1), movie(2), movie(3)], {
    discover: { [COMEDY]: [1, 2], [DRAMA]: [2, 3] },
  });
  const { candidates } = await run(tmdb, [
    { name: 'Sam', genres: [COMEDY] },
    { name: 'Alex', genres: [DRAMA] },
  ]);

  assert.equal(candidates[0].id, 2);
  assert.deepEqual(candidates[0].sources.map(({ person }) => person), ['Sam', 'Alex']);
});

test('adds recommendations for a favorite and leaves out the favorite itself', async () => {
  const tmdb = fakeTmdb([movie(1, { title: 'Alpha' }), movie(2)], {
    discover: { [COMEDY]: [1] },
    recommendations: { 1: [2] },
  });
  const { candidates, stats } = await run(tmdb, [
    { name: 'Sam', genres: [COMEDY], favorites: ['Alpha', 'Not A Real Film'] },
  ]);

  assert.deepEqual(candidates.map(({ id }) => id), [2]);
  assert.deepEqual(candidates[0].sources, [{ type: 'recommended', person: 'Sam', because: 'Alpha' }]);
  assert.equal(stats.unmatched, 1);
});

test('drops a recommended film in an avoided genre', async () => {
  const tmdb = fakeTmdb([movie(1, { title: 'Alpha' }), movie(2, { genres: ['Horror'] }), movie(3)], {
    recommendations: { 1: [2, 3] },
  });
  const { candidates } = await run(tmdb, [
    { name: 'Sam', genres: [COMEDY], avoid: [HORROR], favorites: ['Alpha'] },
  ]);

  assert.deepEqual(candidates.map(({ id }) => id), [3]);
});

test('keeps films with any way to watch, and says where', async () => {
  const rentOnly = { US: { subscription: [], free: [], rent: ['Apple TV'], buy: [] } };
  const nowhere = { US: { subscription: [], free: [], rent: [], buy: [] } };
  const elsewhere = { GB: { subscription: ['Netflix'], free: [], rent: [], buy: [] } };
  const tmdb = fakeTmdb(
    [movie(1, { watch: rentOnly }), movie(2, { watch: nowhere }), movie(3, { watch: elsewhere })],
    { discover: { [COMEDY]: [1, 2, 3] } },
  );
  const { candidates, stats } = await run(tmdb, [{ name: 'Sam', genres: [COMEDY] }]);

  assert.deepEqual(candidates.map(({ id }) => id), [1]);
  assert.deepEqual(candidates[0].watchOptions, rentOnly.US);
  assert.equal(stats.notAvailable, 2);
  assert.equal(candidates[0].providersByRegion, undefined);
});

test('keeps a film cached before watch options were saved', async () => {
  const tmdb = fakeTmdb([movie(1, { watch: null })], { discover: { [COMEDY]: [1] } });
  const { candidates } = await run(tmdb, [{ name: 'Sam', genres: [COMEDY] }]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].watchOptions, null);
});

test('skips films that are not released yet', async () => {
  const tmdb = fakeTmdb([movie(1, { status: 'Post Production' }), movie(2)], {
    discover: { [COMEDY]: [1, 2] },
  });
  const { candidates } = await run(tmdb, [{ name: 'Sam', genres: [COMEDY] }]);

  assert.deepEqual(candidates.map(({ id }) => id), [2]);
});

test('checks at most the capped number of films', async () => {
  const movies = Array.from({ length: MAX_CANDIDATES_CHECKED + 20 }, (_, index) => movie(index + 1));
  const tmdb = fakeTmdb(movies, { discover: { [COMEDY]: movies.map(({ id }) => id) } });
  const { stats } = await run(tmdb, [{ name: 'Sam', genres: [COMEDY] }]);

  assert.equal(tmdb.calls.details.length, MAX_CANDIDATES_CHECKED);
  assert.equal(stats.checked, MAX_CANDIDATES_CHECKED);
});

test('two people share the checks evenly, after films they both match', async () => {
  const movies = Array.from({ length: 2 * MAX_CANDIDATES_CHECKED + 1 }, (_, index) => movie(index + 1));
  const samIds = movies.slice(0, MAX_CANDIDATES_CHECKED).map(({ id }) => id);
  const alexIds = movies.slice(MAX_CANDIDATES_CHECKED).map(({ id }) => id);
  const bothId = alexIds.at(-1);
  const tmdb = fakeTmdb(movies, { discover: { [COMEDY]: [...samIds, bothId], [DRAMA]: alexIds } });

  await run(tmdb, [{ name: 'Sam', genres: [COMEDY] }, { name: 'Alex', genres: [DRAMA] }]);

  const checked = tmdb.calls.details;
  assert.equal(checked[0], bothId);
  // One shared film, then 59 turns: 30 for Sam, who goes first, and 29 for Alex.
  assert.equal(checked.filter((id) => samIds.includes(id)).length, 30);
  assert.equal(checked.filter((id) => alexIds.includes(id) && id !== bothId).length, 29);
});
