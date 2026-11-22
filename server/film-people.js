// Actors and directors the viewers asked for when refining tonight's shortlist.
// A film features someone when they're in its top-billed cast or directed it.
const MAX_FILM_PEOPLE = 2;
const MAX_NAME_LENGTH = 100;

function readFilmPeople(value) {
  if (value === undefined || value === null) return [];
  const valid =
    Array.isArray(value) &&
    value.length <= MAX_FILM_PEOPLE &&
    value.every(
      (person) =>
        person &&
        Number.isInteger(person.id) &&
        person.id > 0 &&
        typeof person.name === 'string' &&
        person.name.trim().length > 0 &&
        person.name.length <= MAX_NAME_LENGTH,
    );
  if (!valid) throw new Error(`Pick up to ${MAX_FILM_PEOPLE} actors or directors from the search.`);
  const unique = value.filter((person, index) => value.findIndex((other) => other.id === person.id) === index);
  return unique.map(({ id, name }) => ({ id, name: name.trim() }));
}

// Details cached before credits were fetched have no cast or director ids, so they can't match.
function featuresAny(film, wanted) {
  const ids = [...(film.castIds ?? []), ...(film.directorIds ?? [])];
  return wanted.some((person) => ids.includes(person.id));
}

// Strict on purpose: someone asking for an actor wants that actor, not the nearest substitute.
function filterByFilmPeople(candidates, wanted) {
  if (wanted.length === 0) return candidates;
  return candidates.filter((film) => featuresAny(film, wanted));
}

module.exports = { MAX_FILM_PEOPLE, readFilmPeople, filterByFilmPeople };
