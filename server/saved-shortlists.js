const { readFilmPeople } = require('./film-people');

// A saved shortlist comes back from the browser, so only the fields a pick card shows are kept,
// each checked for type and size. Anything else is dropped.
const MAX_PICKS = 8;
const MAX_BACKUPS = 3;
const MAX_VIEWERS = 2;
const MAX_NAME_LENGTH = 40;
const MAX_SHORTLIST_NAME_LENGTH = 60;
const MAX_SHORT_TEXT = 300;
const MAX_LONG_TEXT = 2000;
const MAX_LIST_ITEMS = 20;
const MODES = ['letterboxd', 'quiz'];
const WATCH_OPTION_KEYS = ['free', 'subscription', 'rent', 'buy'];

function isText(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength;
}

function textList(value) {
  return Array.isArray(value) && value.length <= MAX_LIST_ITEMS && value.every((item) => isText(item, MAX_SHORT_TEXT));
}

function readWatchOptions(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('bad watch options');
  return Object.fromEntries(
    WATCH_OPTION_KEYS.map((key) => {
      const names = value[key] ?? [];
      if (!textList(names)) throw new Error('bad watch options');
      return [key, names];
    }),
  );
}

function readPick(pick) {
  if (!pick || typeof pick !== 'object') throw new Error('bad pick');
  const { id, title, year, why, overview, posterPath, label, runtime, genres, services } = pick;
  const valid =
    Number.isInteger(id) &&
    isText(title, MAX_SHORT_TEXT) && title.length > 0 &&
    isText(why, MAX_LONG_TEXT) &&
    (year === undefined || year === null || isText(year, 10)) &&
    (overview === undefined || overview === null || isText(overview, MAX_LONG_TEXT)) &&
    (posterPath === undefined || posterPath === null || (isText(posterPath, MAX_SHORT_TEXT) && posterPath.startsWith('/'))) &&
    (label === undefined || label === null || isText(label, MAX_SHORT_TEXT)) &&
    (runtime === undefined || runtime === null || (Number.isInteger(runtime) && runtime >= 0 && runtime < 1000)) &&
    (genres === undefined || textList(genres)) &&
    (services === undefined || textList(services));
  if (!valid) throw new Error('bad pick');

  const kept = { id, title, why, year: year ?? null, overview: overview ?? '', posterPath: posterPath ?? null };
  kept.label = label ?? null;
  kept.runtime = runtime ?? null;
  kept.genres = genres ?? [];
  if (services !== undefined) kept.services = services;
  else kept.watchOptions = readWatchOptions(pick.watchOptions);
  return kept;
}

// A blank name is fine: the list is then shown by its date.
function readShortlistName(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`Use a name of up to ${MAX_SHORTLIST_NAME_LENGTH} characters.`);
  const name = value.trim();
  if (name.length > MAX_SHORTLIST_NAME_LENGTH) throw new Error(`Use a name of up to ${MAX_SHORTLIST_NAME_LENGTH} characters.`);
  return name || null;
}

// Throws one plain message for any problem; the details only matter to someone editing requests by hand.
function readSavedShortlist(body, moodIds, subgenreIds = []) {
  const { mode, mood, viewers, picks, backups = [], subgenres = [] } = body ?? {};
  const name = readShortlistName(body?.name);
  try {
    if (!MODES.includes(mode) || !moodIds.includes(mood)) throw new Error('bad mode or mood');
    if (
      !Array.isArray(viewers) ||
      viewers.length === 0 ||
      viewers.length > MAX_VIEWERS ||
      !viewers.every((name) => isText(name, MAX_NAME_LENGTH))
    ) {
      throw new Error('bad viewers');
    }
    if (!Array.isArray(picks) || picks.length === 0 || picks.length > MAX_PICKS) throw new Error('bad picks');
    if (!Array.isArray(backups) || backups.length > MAX_BACKUPS) throw new Error('bad backups');
    if (!Array.isArray(subgenres) || subgenres.length > 3 || !subgenres.every((id) => subgenreIds.includes(id))) {
      throw new Error('bad subgenres');
    }
    const withPeople = readFilmPeople(body.withPeople);
    return { name, mode, mood, viewers, subgenres, withPeople, picks: picks.map(readPick), backups: backups.map(readPick) };
  } catch (error) {
    throw new Error("This shortlist can't be saved. Build it again and try saving once more.");
  }
}

module.exports = { readSavedShortlist, readShortlistName };
