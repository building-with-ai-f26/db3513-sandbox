// Subgenres narrow tonight's shortlist below TMDB's 18 broad genres.
// A film matches when it has one of the subgenre's main genres and one of its TMDB keyword tags.
// Keyword ids were looked up with TMDB's /search/keyword; edit this list to add or change subgenres.
const SUBGENRES = [
  { id: 'romantic-comedy', name: 'Romantic comedy', group: 'Comedy', genres: ['Comedy'], keywords: [9799], description: 'Comedies built around two people falling in love.' },
  { id: 'dark-comedy', name: 'Dark comedy', group: 'Comedy', genres: ['Comedy'], keywords: [10123], description: 'Comedy that finds laughs in grim or taboo subjects.' },
  { id: 'satire', name: 'Satire & parody', group: 'Comedy', genres: ['Comedy'], keywords: [8201, 9755, 11800], description: 'Comedy that mocks politics, media, or other films.' },
  { id: 'heist', name: 'Heist', group: 'Crime & mystery', genres: ['Crime', 'Thriller', 'Action', 'Comedy'], keywords: [10051], description: 'A crew plans and pulls off a robbery.' },
  { id: 'whodunit', name: 'Detective & whodunit', group: 'Crime & mystery', genres: ['Crime', 'Mystery'], keywords: [703, 12570, 155790], description: 'A mystery solved by a detective or an amateur sleuth.' },
  { id: 'gangster', name: 'Gangster', group: 'Crime & mystery', genres: ['Crime', 'Drama'], keywords: [3149, 10391], description: 'Organised crime, mobs, and the people inside them.' },
  { id: 'noir', name: 'Noir', group: 'Crime & mystery', genres: ['Crime', 'Thriller', 'Drama', 'Mystery'], keywords: [207268, 9807], description: 'Shadowy, morally grey crime stories in the noir tradition.' },
  { id: 'psychological-thriller', name: 'Psychological', group: 'Thriller', genres: ['Thriller', 'Drama', 'Mystery', 'Horror'], keywords: [12565], description: 'Tension built from unreliable minds and mind games.' },
  { id: 'conspiracy', name: 'Conspiracy', group: 'Thriller', genres: ['Thriller', 'Drama', 'Mystery'], keywords: [10410], description: 'Someone uncovers a hidden plot by people in power.' },
  { id: 'survival', name: 'Survival', group: 'Thriller', genres: ['Thriller', 'Adventure', 'Action', 'Drama', 'Horror'], keywords: [10349], description: 'Characters fight to stay alive against nature or circumstance.' },
  { id: 'serial-killer', name: 'Serial killer', group: 'Thriller', genres: ['Thriller', 'Crime', 'Horror', 'Mystery'], keywords: [10714], description: 'The hunt for, or the mind of, a serial killer.' },
  { id: 'slasher', name: 'Slasher', group: 'Horror', genres: ['Horror'], keywords: [12339], description: 'A killer picks off a group one by one.' },
  { id: 'supernatural', name: 'Supernatural', group: 'Horror', genres: ['Horror', 'Thriller', 'Fantasy'], keywords: [6152, 162846, 3358], description: 'Ghosts, possessions, and haunted places.' },
  { id: 'folk-horror', name: 'Folk horror', group: 'Horror', genres: ['Horror'], keywords: [209568], description: 'Rural rituals, cults, and old beliefs turned sinister.' },
  { id: 'found-footage', name: 'Found footage', group: 'Horror', genres: ['Horror', 'Thriller', 'Science Fiction'], keywords: [163053], description: 'Told through footage the characters filmed themselves.' },
  { id: 'time-travel', name: 'Time travel', group: 'Sci-fi', genres: ['Science Fiction', 'Comedy', 'Adventure', 'Drama'], keywords: [4379], description: 'Characters move through time and deal with the consequences.' },
  { id: 'space', name: 'Space', group: 'Sci-fi', genres: ['Science Fiction', 'Adventure'], keywords: [9882, 252634], description: 'Stories set among stars, ships, and other planets.' },
  { id: 'dystopia', name: 'Dystopia', group: 'Sci-fi', genres: ['Science Fiction', 'Drama', 'Action', 'Thriller'], keywords: [4565, 4458, 12190], description: 'Bleak futures, collapsed societies, and controlling states.' },
  { id: 'aliens', name: 'Aliens', group: 'Sci-fi', genres: ['Science Fiction', 'Horror', 'Comedy', 'Adventure'], keywords: [9951], description: 'Encounters with life from somewhere else.' },
  { id: 'coming-of-age', name: 'Coming of age', group: 'Drama', genres: ['Drama', 'Comedy'], keywords: [10683, 6270], description: 'Young people working out who they are.' },
  { id: 'biography', name: 'True story & biopic', group: 'Drama', genres: ['Drama', 'History', 'Documentary', 'Music'], keywords: [5565, 360939], description: 'The life of a real person, told on screen.' },
  { id: 'courtroom', name: 'Courtroom', group: 'Drama', genres: ['Drama', 'Crime', 'Thriller'], keywords: [33519, 214780], description: 'Cases argued and decided in court.' },
  { id: 'period', name: 'Period drama', group: 'Drama', genres: ['Drama', 'History', 'Romance'], keywords: [15060, 192772], description: 'Stories set in the past, with history as the backdrop.' },
  { id: 'martial-arts', name: 'Martial arts', group: 'Action', genres: ['Action', 'Adventure'], keywords: [779, 780], description: 'Fights choreographed around kung fu and other martial arts.' },
  { id: 'spy', name: 'Spy', group: 'Action', genres: ['Action', 'Thriller', 'Adventure', 'Comedy'], keywords: [470, 4289, 5265], description: 'Agents, double-crosses, and missions in secret.' },
  { id: 'musical', name: 'Musical', group: 'More', genres: ['Music', 'Family', 'Comedy', 'Drama', 'Romance', 'Animation'], keywords: [4344], description: 'Characters sing to tell the story.' },
  { id: 'road-trip', name: 'Road trip', group: 'More', genres: ['Comedy', 'Drama', 'Adventure'], keywords: [7312], description: 'A journey by car where the trip changes the travellers.' },
  { id: 'sports', name: 'Sports', group: 'More', genres: ['Drama', 'Comedy', 'Documentary', 'Family'], keywords: [6075], description: 'Athletes, teams, and the game that matters.' },
  { id: 'christmas', name: 'Christmas', group: 'More', genres: ['Comedy', 'Family', 'Drama', 'Romance', 'Animation', 'Fantasy'], keywords: [207317], description: 'Set at, or about, Christmas.' },
];

const MAX_SUBGENRES = 3;
// Below this many tagged matches, the shortlist falls back to the main genres and Claude judges the rest.
const MIN_TAGGED_MATCHES = 5;

function readSubgenres(value) {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.length > MAX_SUBGENRES ||
    !value.every((id) => SUBGENRES.some((subgenre) => subgenre.id === id))
  ) {
    throw new Error(`Pick up to ${MAX_SUBGENRES} genres from the list.`);
  }
  return [...new Set(value)].map((id) => SUBGENRES.find((subgenre) => subgenre.id === id));
}

function hasMainGenre(film, subgenre) {
  return film.genres.some((genre) => subgenre.genres.includes(genre));
}

// Details cached before keywords were fetched have no keywordIds, so they can't count as tagged.
function isTagged(film, subgenre) {
  return hasMainGenre(film, subgenre) && (film.keywordIds ?? []).some((id) => subgenre.keywords.includes(id));
}

// Keeps films tagged with any chosen subgenre. With too few, keeps films in their main genres
// instead and says so, so Claude can judge the subgenre from each description.
function filterBySubgenres(candidates, subgenres) {
  if (subgenres.length === 0) return { candidates, relaxed: false };
  const tagged = candidates.filter((film) => subgenres.some((subgenre) => isTagged(film, subgenre)));
  if (tagged.length >= MIN_TAGGED_MATCHES) return { candidates: tagged, relaxed: false };
  return {
    candidates: candidates.filter((film) => subgenres.some((subgenre) => hasMainGenre(film, subgenre))),
    relaxed: true,
  };
}

// The subgenre list without matching details, for the browser.
function listSubgenres() {
  return SUBGENRES.map(({ id, name, group }) => ({ id, name, group }));
}

module.exports = { SUBGENRES, MAX_SUBGENRES, readSubgenres, filterBySubgenres, listSubgenres };
