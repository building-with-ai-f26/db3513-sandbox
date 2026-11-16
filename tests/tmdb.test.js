const test = require('node:test');
const assert = require('node:assert/strict');
const { createTmdbClient } = require('../server/tmdb');

// Replaces the network with canned replies, and records every request made.
function stubFetch(t, replies) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), options });
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: reply.headers ?? {},
    });
  });
  return requests;
}

function movie(title, releaseDate, originalTitle = title) {
  return { id: 1, title, original_title: originalTitle, release_date: releaseDate };
}

test('matches a film by both title and year', async (t) => {
  stubFetch(t, [{ body: { results: [movie('Alpha', '2001-05-01')] } }]);

  const match = await createTmdbClient('token', {}).searchMovie('Alpha', '2001');

  assert.equal(match.title, 'Alpha');
});

test('does not match when the year differs', async (t) => {
  stubFetch(t, [{ body: { results: [movie('Alpha', '2020-05-01')] } }]);

  assert.equal(await createTmdbClient('token', {}).searchMovie('Alpha', '2001'), null);
});

test('does not match a different title from the same year', async (t) => {
  stubFetch(t, [{ body: { results: [movie('Alpha Returns', '2001-05-01')] } }]);

  assert.equal(await createTmdbClient('token', {}).searchMovie('Alpha', '2001'), null);
});

test('ignores punctuation and case when comparing titles', async (t) => {
  stubFetch(t, [{ body: { results: [movie('WALL·E', '2008-06-22')] } }]);

  assert.ok(await createTmdbClient('token', {}).searchMovie('Wall-E', '2008'));
});

test('sends the token in a header and never in the URL', async (t) => {
  const requests = stubFetch(t, [{ body: { results: [] } }]);

  await createTmdbClient('secret-token', {}).searchMovie('Alpha', '2001');

  assert.ok(!requests[0].url.includes('secret-token'));
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret-token');
});

test('a rejected token gives a clear error without repeating the token', async (t) => {
  stubFetch(t, [{ status: 401 }]);

  await assert.rejects(
    createTmdbClient('secret-token', {}).searchMovie('Alpha', '2001'),
    (error) => /TMDB_API_TOKEN/.test(error.message) && !error.message.includes('secret-token'),
  );
});

test('retries after being rate limited', async (t) => {
  const requests = stubFetch(t, [
    { status: 429, headers: { 'retry-after': '0' } },
    { body: { results: [movie('Alpha', '2001-05-01')] } },
  ]);

  assert.ok(await createTmdbClient('token', {}).searchMovie('Alpha', '2001'));
  assert.equal(requests.length, 2);
});

test('a repeat lookup is answered from the cache', async (t) => {
  const requests = stubFetch(t, [{ body: { results: [] } }]);
  const client = createTmdbClient('token', {});

  await client.getRecommendations(1);
  await client.getRecommendations(1);

  assert.equal(requests.length, 1);
});

test('a cache entry older than a day is fetched again', async (t) => {
  const requests = stubFetch(t, [{ body: { results: [] } }]);
  const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const client = createTmdbClient('token', { 'recommendations:1': { savedAt: twoDaysAgo, value: [] } });

  await client.getRecommendations(1);

  assert.equal(requests.length, 1);
});

test('keeps only subscription streaming, not rent or buy', async (t) => {
  stubFetch(t, [{
    body: {
      ...movie('Alpha', '2001-05-01'),
      status: 'Released',
      runtime: 100,
      genres: [{ name: 'Drama' }],
      'watch/providers': {
        results: { US: { flatrate: [{ provider_id: 8 }], rent: [{ provider_id: 2 }] } },
      },
    },
  }]);

  const details = await createTmdbClient('token', {}).getDetails(1);

  assert.deepEqual(details.providersByRegion, { US: [8] });
});

test('lists every way to watch by name, with free and ad-supported together', async (t) => {
  stubFetch(t, [{
    body: {
      ...movie('Alpha', '2001-05-01'),
      status: 'Released',
      runtime: 100,
      genres: [{ name: 'Drama' }],
      'watch/providers': {
        results: {
          US: {
            flatrate: [{ provider_id: 8, provider_name: 'Netflix' }],
            free: [{ provider_id: 1, provider_name: 'Kanopy' }],
            ads: [{ provider_id: 73, provider_name: 'Tubi' }],
            rent: [{ provider_id: 2, provider_name: 'Apple TV' }],
          },
        },
      },
    },
  }]);

  const details = await createTmdbClient('token', {}).getDetails(1);

  assert.deepEqual(details.watchOptionsByRegion, {
    US: { subscription: ['Netflix'], free: ['Kanopy', 'Tubi'], rent: ['Apple TV'], buy: [] },
  });
  assert.deepEqual(details.providersByRegion, { US: [8] });
});

test('finds a typed title without a year, preferring an exact match', async (t) => {
  const requests = stubFetch(t, [{
    body: { results: [movie('Alpha Returns', '2005-01-01'), { ...movie('Alpha', '2001-05-01'), id: 2 }] },
  }]);

  const match = await createTmdbClient('token', {}).findMovie('alpha');

  assert.equal(match.id, 2);
  assert.ok(!new URL(requests[0].url).searchParams.has('primary_release_year'));
});

test('falls back to the top result when no title matches exactly', async (t) => {
  stubFetch(t, [{ body: { results: [movie('Alpha Returns', '2005-01-01')] } }]);

  assert.equal((await createTmdbClient('token', {}).findMovie('Alpha 2')).title, 'Alpha Returns');
});

test('finds nothing when the search is empty', async (t) => {
  stubFetch(t, [{ body: { results: [] } }]);

  assert.equal(await createTmdbClient('token', {}).findMovie('Nothing'), null);
});

test('discovers films in any chosen genre, without avoided ones, within the years', async (t) => {
  const requests = stubFetch(t, [{ body: { results: [movie('Alpha', '2001-05-01')] } }]);

  const films = await createTmdbClient('token', {}).discoverMovies({
    genreIds: [35, 18],
    avoidGenreIds: [27],
    fromYear: 2000,
    page: 2,
  });

  const params = new URL(requests[0].url).searchParams;
  assert.equal(params.get('with_genres'), '35|18');
  assert.equal(params.get('without_genres'), '27');
  assert.equal(params.get('primary_release_date.gte'), '2000-01-01');
  assert.ok(!params.has('primary_release_date.lte'));
  assert.equal(params.get('page'), '2');
  assert.equal(films[0].title, 'Alpha');
});

test('lists a service once when it is both free and ad-supported', async (t) => {
  stubFetch(t, [{
    body: {
      ...movie('Alpha', '2001-05-01'),
      status: 'Released',
      genres: [],
      'watch/providers': {
        results: {
          US: {
            free: [{ provider_id: 83, provider_name: 'The CW' }],
            ads: [{ provider_id: 83, provider_name: 'The CW ' }, { provider_id: 73, provider_name: 'Tubi' }],
          },
        },
      },
    },
  }]);

  const details = await createTmdbClient('token', {}).getDetails(1);

  assert.deepEqual(details.watchOptionsByRegion.US.free, ['The CW', 'Tubi']);
});
