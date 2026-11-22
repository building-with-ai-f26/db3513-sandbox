const { loadTmdbCache, saveTmdbCache } = require('./store');

const BASE_URL = 'https://api.themoviedb.org/3';
const CACHE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const TOP_BILLED_CAST = 15;
const MAX_PEOPLE_RESULTS = 5;

// Ignores case and punctuation, so "WALL·E" and "WALL-E" count as the same title.
function comparableTitle(title) {
  const lowered = title.normalize('NFC').toLowerCase();
  return lowered.replace(/[^\p{L}\p{N}]/gu, '') || lowered;
}

function yearOf(releaseDate) {
  return (releaseDate || '').slice(0, 4);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function trimRecommendation(movie) {
  return {
    id: movie.id,
    title: movie.title,
    originalTitle: movie.original_title,
    year: yearOf(movie.release_date),
  };
}

// Only subscription streaming counts, so rent and buy options are dropped here.
function trimProviders(watchProviders) {
  return Object.fromEntries(
    Object.entries(watchProviders?.results ?? {}).map(([region, options]) => [
      region,
      (options.flatrate ?? []).map((provider) => provider.provider_id),
    ]),
  );
}

// A service listed as both free and with ads is shown once.
function providerNames(providers = []) {
  return [...new Set(providers.map((provider) => (provider.provider_name ?? '').trim()))].filter(Boolean);
}

// Every way to watch, by name, for people who don't pay for a streaming service.
function trimWatchOptions(watchProviders) {
  return Object.fromEntries(
    Object.entries(watchProviders?.results ?? {}).map(([region, options]) => [
      region,
      {
        subscription: providerNames(options.flatrate),
        free: providerNames([...(options.free ?? []), ...(options.ads ?? [])]),
        rent: providerNames(options.rent),
        buy: providerNames(options.buy),
      },
    ]),
  );
}

function createTmdbClient(token, cache = loadTmdbCache()) {
  async function request(endpoint, params = {}) {
    const url = new URL(`${BASE_URL}${endpoint}`);
    url.search = new URLSearchParams(params).toString();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response;
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
      } catch (error) {
        throw new Error("Couldn't reach TMDB. Check your internet connection.");
      }

      if (response.ok) return response.json();
      if (response.status === 401) {
        throw new Error('TMDB rejected the token. Check TMDB_API_TOKEN in .env.');
      }

      const isTemporary = response.status === 429 || response.status >= 500;
      if (!isTemporary || attempt === MAX_ATTEMPTS) {
        throw new Error(`TMDB request failed with status ${response.status}.`);
      }
      await wait(Number(response.headers.get('retry-after') ?? 1) * 1000);
    }
  }

  async function cached(key, load) {
    const entry = cache[key];
    if (entry && Date.now() - entry.savedAt < CACHE_LIFETIME_MS) return entry.value;

    const value = await load();
    cache[key] = { savedAt: Date.now(), value };
    return value;
  }

  // Returns a film only when both the title and the year match.
  function searchMovie(name, year) {
    return cached(`search:${name}|${year}`, async () => {
      if (!year) return null;

      const { results } = await request('/search/movie', {
        query: name,
        primary_release_year: year,
        include_adult: 'false',
      });
      const wanted = comparableTitle(name);
      const match = results.find(
        (movie) =>
          yearOf(movie.release_date) === year &&
          (comparableTitle(movie.title) === wanted ||
            comparableTitle(movie.original_title) === wanted),
      );
      return match ? trimRecommendation(match) : null;
    });
  }

  // Actors and directors matching a typed name, most popular first, for the refine search.
  function searchPeople(query) {
    return cached(`people:${query.toLowerCase()}`, async () => {
      const { results } = await request('/search/person', { query, include_adult: 'false' });
      return results
        .filter((person) => ['Acting', 'Directing'].includes(person.known_for_department))
        .slice(0, MAX_PEOPLE_RESULTS)
        .map((person) => ({
          id: person.id,
          name: person.name,
          department: person.known_for_department,
          knownFor: (person.known_for ?? []).map((work) => work.title ?? work.name).find(Boolean) ?? null,
        }));
    });
  }

  // Finds a typed title without a year, preferring an exact title match over the top result.
  function findMovie(name) {
    return cached(`find:${name}`, async () => {
      const { results } = await request('/search/movie', { query: name, include_adult: 'false' });
      const wanted = comparableTitle(name);
      const match = results.find(
        (movie) =>
          comparableTitle(movie.title) === wanted || comparableTitle(movie.original_title) === wanted,
      );
      const found = match ?? results[0];
      return found ? trimRecommendation(found) : null;
    });
  }

  // Well-reviewed films in any of the given genres, skipping the avoided ones.
  // Keyword ids find films by subgenre tag and person ids by cast or crew; any one of each is enough.
  // Provider ids with a region keep only films streaming on those services there.
  function discoverMovies({
    genreIds = [],
    keywordIds = [],
    personIds = [],
    providerIds = [],
    region,
    avoidGenreIds = [],
    fromYear,
    toYear,
    page = 1,
  }) {
    const params = {
      with_genres: genreIds.join('|'),
      without_genres: avoidGenreIds.join(','),
      sort_by: 'vote_average.desc',
      'vote_count.gte': '300',
      include_adult: 'false',
      page: String(page),
    };
    if (fromYear) params['primary_release_date.gte'] = `${fromYear}-01-01`;
    if (toYear) params['primary_release_date.lte'] = `${toYear}-12-31`;
    if (keywordIds.length > 0) params.with_keywords = keywordIds.join('|');
    if (personIds.length > 0) params.with_people = personIds.join('|');
    if (providerIds.length > 0 && region) {
      params.with_watch_providers = providerIds.join('|');
      params.watch_region = region;
    }

    return cached(`discover:${new URLSearchParams(params)}`, async () => {
      const { results } = await request('/discover/movie', params);
      return results.map(trimRecommendation);
    });
  }

  function getRecommendations(id) {
    return cached(`recommendations:${id}`, async () => {
      const { results } = await request(`/movie/${id}/recommendations`);
      return results.map(trimRecommendation);
    });
  }

  function getDetails(id) {
    return cached(`details:${id}`, async () => {
      const movie = await request(`/movie/${id}`, { append_to_response: 'watch/providers,keywords,credits' });
      return {
        ...trimRecommendation(movie),
        status: movie.status,
        runtime: movie.runtime,
        posterPath: movie.poster_path,
        overview: movie.overview,
        genres: movie.genres.map((genre) => genre.name),
        keywordIds: (movie.keywords?.keywords ?? []).map((keyword) => keyword.id),
        // Top-billed cast only, so a cameo doesn't count and the cache stays small.
        castIds: (movie.credits?.cast ?? []).slice(0, TOP_BILLED_CAST).map((person) => person.id),
        directorIds: (movie.credits?.crew ?? []).filter((person) => person.job === 'Director').map((person) => person.id),
        providersByRegion: trimProviders(movie['watch/providers']),
        watchOptionsByRegion: trimWatchOptions(movie['watch/providers']),
      };
    });
  }

  return {
    searchMovie,
    findMovie,
    discoverMovies,
    searchPeople,
    getRecommendations,
    getDetails,
    saveCache: () => saveTmdbCache(cache),
  };
}

module.exports = { createTmdbClient };
