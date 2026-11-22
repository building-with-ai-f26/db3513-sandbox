const { mapWithLimit, REGIONS } = require('./candidates');
const { MOODS } = require('./shortlist');

const MAX_NAME_LENGTH = 40;
const MAX_PEOPLE = 2;
const MAX_FAVORITES = 3;
const MAX_FAVORITE_LENGTH = 100;
const DISCOVER_PAGES_PER_PERSON = 2;
const MAX_CANDIDATES_CHECKED = 60;
const MAX_TMDB_REQUESTS_AT_ONCE = 8;
const RECENT_YEARS = 5;

// ids are TMDB's genre numbers, and names match the genres TMDB returns for a film.
const GENRES = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 14, name: 'Fantasy' },
  { id: 36, name: 'History' },
  { id: 27, name: 'Horror' },
  { id: 10402, name: 'Music' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Science Fiction' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'War' },
  { id: 37, name: 'Western' },
];

const ERAS = [
  { id: 'any', name: 'Any era' },
  { id: 'classic', name: 'Classics (before 1980)' },
  { id: 'modern', name: '2000 onward' },
  { id: 'recent', name: `The last ${RECENT_YEARS} years` },
];

function eraYears(eraId, now = new Date()) {
  if (eraId === 'classic') return { toYear: 1979 };
  if (eraId === 'modern') return { fromYear: 2000 };
  if (eraId === 'recent') return { fromYear: now.getFullYear() - RECENT_YEARS };
  return {};
}

function readGenreIds(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((id) => GENRES.some((genre) => genre.id === id))) {
    throw new Error(`Pick ${label} from the list.`);
  }
  return [...new Set(value)];
}

function genreNames(ids) {
  return ids.map((id) => GENRES.find((genre) => genre.id === id).name);
}

function readPerson(answers) {
  const name = typeof answers?.name === 'string' ? answers.name.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new Error(`Enter a name of 1 to ${MAX_NAME_LENGTH} characters.`);
  }

  const genreIds = readGenreIds(answers.genres, 'genres');
  if (genreIds.length === 0) throw new Error(`${name}: pick at least one genre you're into.`);
  const avoidGenreIds = readGenreIds(answers.avoid, 'genres to skip');
  if (avoidGenreIds.some((id) => genreIds.includes(id))) {
    throw new Error(`${name}: a genre can't be both one you're into and one to skip.`);
  }

  const favorites = answers.favorites ?? [];
  if (
    !Array.isArray(favorites) ||
    favorites.length > MAX_FAVORITES ||
    !favorites.every((title) => typeof title === 'string' && title.length <= MAX_FAVORITE_LENGTH)
  ) {
    throw new Error(`${name}: list up to ${MAX_FAVORITES} films, each under ${MAX_FAVORITE_LENGTH} characters.`);
  }

  const era = answers.era ?? 'any';
  if (!ERAS.some(({ id }) => id === era)) throw new Error(`${name}: pick an era from the list.`);

  return {
    name,
    genreIds,
    avoidGenreIds,
    era,
    favorites: favorites.map((title) => title.trim()).filter(Boolean),
  };
}

// Checks everything a visitor sent, since none of it comes from a saved profile.
function readAnswers(body) {
  const { people, mood, region } = body ?? {};
  if (!Array.isArray(people) || people.length === 0 || people.length > MAX_PEOPLE) {
    throw new Error('Answer the questions for one or two people.');
  }
  if (!REGIONS.includes(region)) throw new Error('Pick a region from the list.');
  if (!MOODS.some(({ id }) => id === mood)) throw new Error("Pick tonight's mood.");

  return { people: people.map(readPerson), mood, region };
}

// Answers saved to an account can be half-filled (a blank name, no genres yet),
// so this checks only types and sizes, not that they are ready to build a shortlist.
function readStoredQuiz(value) {
  const isGenreList = (ids) => Array.isArray(ids) && ids.every((id) => GENRES.some((genre) => genre.id === id));
  const valid =
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_PEOPLE &&
    value.every(
      (person) =>
        person &&
        typeof person.name === 'string' &&
        person.name.length <= MAX_NAME_LENGTH &&
        isGenreList(person.genres) &&
        isGenreList(person.avoid) &&
        Array.isArray(person.favorites) &&
        person.favorites.length <= MAX_FAVORITES &&
        person.favorites.every((title) => typeof title === 'string' && title.length <= MAX_FAVORITE_LENGTH) &&
        ERAS.some(({ id }) => id === person.era),
    );
  if (!valid) throw new Error("Those quiz answers couldn't be saved.");
  return value.map(({ name, genres, avoid, favorites, era }) => ({ name, genres, avoid, favorites, era }));
}

// What Claude sees about each viewer in place of their rating history.
function describeViewer(person) {
  return {
    name: person.name,
    interests: {
      into: genreNames(person.genreIds),
      skip: genreNames(person.avoidGenreIds),
      lovedLately: person.favorites,
      era: ERAS.find(({ id }) => id === person.era).name,
    },
  };
}

function bySourceCount(a, b) {
  return b.sources.length - a.sources.length;
}

// Films from more than one person go first, then each person's films take turns,
// so the first person's films can't use up every check.
function chooseFilmsToCheck(films, people) {
  const sorted = [...films].sort(bySourceCount);
  const shared = sorted.filter((film) => new Set(film.sources.map(({ person }) => person)).size > 1);
  const queues = people.map(({ name }) =>
    sorted.filter((film) => !shared.includes(film) && film.sources[0].person === name),
  );

  const chosen = [...shared];
  while (chosen.length < MAX_CANDIDATES_CHECKED && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      if (queue.length > 0 && chosen.length < MAX_CANDIDATES_CHECKED) chosen.push(queue.shift());
    }
  }
  return chosen.slice(0, MAX_CANDIDATES_CHECKED);
}

function hasWayToWatch(options) {
  return Object.values(options).some((names) => names.length > 0);
}

async function buildQuizCandidates({ people, region, tmdb }) {
  const avoidGenreIds = [...new Set(people.flatMap((person) => person.avoidGenreIds))];
  const avoidNames = new Set(genreNames(avoidGenreIds));
  const pool = new Map();
  const favoriteIds = new Set();
  let unmatched = 0;

  function addToPool(film, source) {
    if (!pool.has(film.id)) pool.set(film.id, { ...film, sources: [] });
    const { sources } = pool.get(film.id);
    if (!sources.some((existing) => existing.person === source.person && existing.type === source.type)) {
      sources.push(source);
    }
  }

  for (const person of people) {
    const pages = Array.from({ length: DISCOVER_PAGES_PER_PERSON }, (_, index) => index + 1);
    const discovered = await mapWithLimit(pages, MAX_TMDB_REQUESTS_AT_ONCE, (page) =>
      tmdb.discoverMovies({ genreIds: person.genreIds, avoidGenreIds, ...eraYears(person.era), page }),
    );
    for (const film of discovered.flat()) addToPool(film, { type: 'interest', person: person.name });

    const found = await mapWithLimit(person.favorites, MAX_TMDB_REQUESTS_AT_ONCE, (title) =>
      tmdb.findMovie(title),
    );
    unmatched += found.filter((match) => !match).length;
    const matches = found.filter(Boolean);
    matches.forEach((match) => favoriteIds.add(match.id));

    const recommendationLists = await mapWithLimit(matches, MAX_TMDB_REQUESTS_AT_ONCE, (match) =>
      tmdb.getRecommendations(match.id),
    );
    matches.forEach((match, index) => {
      for (const film of recommendationLists[index]) {
        addToPool(film, { type: 'recommended', person: person.name, because: match.title });
      }
    });
  }

  // Films someone named as a favorite have already been seen.
  const toCheck = chooseFilmsToCheck(
    [...pool.values()].filter((film) => !favoriteIds.has(film.id)),
    people,
  );
  const allDetails = await mapWithLimit(toCheck, MAX_TMDB_REQUESTS_AT_ONCE, (film) =>
    tmdb.getDetails(film.id),
  );

  const candidates = [];
  let notAvailable = 0;

  allDetails.forEach((details, index) => {
    if (details.status !== 'Released') return;
    // Recommendations aren't filtered by genre, so an avoided genre is caught here.
    if (details.genres.some((genre) => avoidNames.has(genre))) return;

    // Details cached before watch options were saved have none, so those films stay in.
    const { providersByRegion, watchOptionsByRegion, status, ...film } = details;
    const watchOptions = watchOptionsByRegion ? watchOptionsByRegion[region] : null;
    if (watchOptionsByRegion && !(watchOptions && hasWayToWatch(watchOptions))) {
      notAvailable += 1;
      return;
    }

    candidates.push({ ...film, watchOptions, sources: toCheck[index].sources });
  });

  return {
    candidates,
    stats: { checked: toCheck.length, notAvailable, unmatched },
  };
}

module.exports = {
  readAnswers,
  readStoredQuiz,
  describeViewer,
  buildQuizCandidates,
  eraYears,
  GENRES,
  ERAS,
  MAX_CANDIDATES_CHECKED,
};
