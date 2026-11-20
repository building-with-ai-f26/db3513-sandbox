const SLOT_HEADINGS = ['You', 'Second person'];
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';
const CHOICES_STORAGE_KEY = 'shortlist-choices';
const MODE_STORAGE_KEY = 'shortlist-mode';
const QUIZ_STORAGE_KEY = 'shortlist-quiz';
const MAX_QUIZ_PEOPLE = 2;
const MAX_SERVICES_SHOWN = 2;
const UNDO_WINDOW_MS = 6000;
const LOADING_MESSAGE_MS = 3000;
const LOADING_MESSAGES = [
  'Checking what is on your services…',
  "Leaving out what you've already seen…",
  'Asking Claude for the best fits…',
  'Writing why each one suits you…',
];
const QUIZ_LOADING_MESSAGES = [
  'Finding films that match your answers…',
  'Checking where you can watch them…',
  'Asking Claude for the best fits…',
  'Writing why each one suits you…',
];
// Free comes first, since quiz mode is for people who may not pay for streaming.
const WATCH_OPTION_LABELS = [
  ['free', 'Free on'],
  ['subscription', 'Streaming on'],
  ['rent', 'Rent on'],
  ['buy', 'Buy on'],
];
const MOOD_NOTES = {
  light: 'Comfort, comedy, nothing heavy',
  intense: 'Big drama, edge of your seat',
  either: 'Let your taste decide',
};

const container = document.getElementById('container');
const people = document.getElementById('people');
const quizPeople = document.getElementById('quiz-people');
const quizHint = document.getElementById('quiz-hint');
const modeOptions = document.getElementById('mode-options');
const tonightHeading = document.getElementById('tonight-heading');
const servicesField = document.getElementById('services-field');
const toTonight = document.getElementById('to-tonight');
const finderForm = document.getElementById('finder-form');
const finderButton = document.getElementById('finder-button');
const finderHint = document.getElementById('finder-hint');
const servicesLegend = document.getElementById('services-legend');
const serviceOptions = document.getElementById('service-options');
const moodOptions = document.getElementById('mood-options');
const region = document.getElementById('region');
const loading = document.getElementById('loading');
const loadingStatus = document.getElementById('loading-status');
const failure = document.getElementById('failure');
const failureMessage = document.getElementById('failure-message');
const results = document.getElementById('results');
const resultsHeading = document.getElementById('results-heading');
const resultsContext = document.getElementById('results-context');
const resultsSummary = document.getElementById('results-summary');
const resultsList = document.getElementById('results-list');
const restorePicks = document.getElementById('restore-picks');
const toast = document.getElementById('toast');
const toastText = document.getElementById('toast-text');
const toastAction = document.getElementById('toast-action');

let profiles = [null, null];
let addingSecondPerson = false;
let pendingRemoval = null;
let lastChoices = null;
let hasShortlist = false;
let backupPicks = [];
let toastTimer = null;
let loadingTimer = null;
let mode = 'letterboxd';
let quizAnswers = [];
let genres = [];
let eras = [];

function cloneTemplate(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

function field(root, name) {
  return root.querySelector(`[data-field="${name}"]`);
}

function showError(section, message) {
  const error = field(section, 'error');
  error.textContent = message;
  error.hidden = false;
}

function captureEvent(event, properties) {
  window.posthog?.capture?.(event, properties);
}

async function api(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error("Couldn't reach the app. Check your connection and try again.");
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error('The app sent back something unexpected. Try again in a minute.');
  }
  if (!response.ok) throw new Error(body.error);
  return body;
}

function filledCount() {
  return profiles.filter(Boolean).length;
}

function hideToast() {
  clearTimeout(toastTimer);
  toast.hidden = true;
}

function showToast(text, action) {
  clearTimeout(toastTimer);
  toastText.textContent = text;
  toastAction.hidden = !action;
  toastAction.textContent = action?.label ?? '';
  toastAction.onclick = action?.run ?? null;
  toast.hidden = false;
  toastTimer = setTimeout(hideToast, UNDO_WINDOW_MS);
}

function readStored(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (error) {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Remembering answers is only a convenience, so the app works without it.
  }
}

// Steps
function canVisit(step) {
  if (step === 'tonight') return mode === 'quiz' ? isQuizReady() : filledCount() > 0;
  if (step === 'shortlist') return hasShortlist;
  return true;
}

function updateSteps(active) {
  for (const link of document.querySelectorAll('[data-step-link]')) {
    const step = link.dataset.stepLink;
    link.disabled = !canVisit(step);
    if (step === active) link.setAttribute('aria-current', 'step');
    else link.removeAttribute('aria-current');
  }
}

function currentStep() {
  return container.dataset.active;
}

function focusHeading(root) {
  root.querySelector('.step-heading').focus({ preventScroll: true });
}

function showStep(step) {
  container.dataset.active = step;
  for (const section of document.querySelectorAll('[data-step]')) {
    section.hidden = section.dataset.step !== step;
  }
  updateSteps(step);
  window.scrollTo(0, 0);
}

function goToStep(step) {
  showStep(step);
  if (step === 'shortlist') {
    focusHeading([loading, failure, results].find((panel) => !panel.hidden));
  } else {
    focusHeading(document.querySelector(`[data-step="${step}"]`));
  }
}

// People
async function finishRemoval() {
  if (!pendingRemoval) return;
  const { slot, timer } = pendingRemoval;
  clearTimeout(timer);
  pendingRemoval = null;
  hideToast();
  try {
    await api(`/api/profiles/${slot}`, { method: 'DELETE' });
    captureEvent('profile_removed', { profile_slot: slot + 1 });
  } catch (error) {
    showToast("Couldn't remove that person. Refresh the page and try again.");
  }
}

function undoRemoval() {
  const { slot, profile, timer } = pendingRemoval;
  clearTimeout(timer);
  pendingRemoval = null;
  profiles[slot] = profile;
  hideToast();
  renderPeople();
}

// The profile only leaves the server once the Undo window has passed.
async function startRemoval(slot) {
  await finishRemoval();
  const profile = profiles[slot];
  profiles[slot] = null;
  pendingRemoval = { slot, profile, timer: setTimeout(finishRemoval, UNDO_WINDOW_MS) };
  renderPeople();
  showToast(`Removed ${profile.name}.`, { label: 'Undo', run: undoRemoval });
}

function setChosenFiles(section, files) {
  const count = files.length;
  field(section, 'file-names').textContent = count === 0
    ? 'or click to choose the ZIP file'
    : [...files].map((file) => file.name).join(', ');
  field(section, 'dropzone').classList.toggle('has-files', count > 0);
}

function setUpDropzone(section) {
  const dropzone = field(section, 'dropzone');
  const input = field(section, 'files');

  input.addEventListener('change', () => setChosenFiles(section, input.files));

  for (const type of ['dragenter', 'dragover']) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragging');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    dropzone.addEventListener(type, () => dropzone.classList.remove('is-dragging'));
  }
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    input.files = event.dataTransfer.files;
    setChosenFiles(section, input.files);
  });
}

function renderUpload(slot) {
  const section = cloneTemplate('upload-template');
  field(section, 'heading').textContent = SLOT_HEADINGS[slot];
  setUpDropzone(section);

  const form = section.querySelector('form');
  const button = form.querySelector('button');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    field(section, 'error').hidden = true;
    button.disabled = true;
    button.textContent = 'Reading your films…';

    try {
      await finishRemoval();
      const body = await api(`/api/profiles/${slot}`, { method: 'POST', body: new FormData(form) });
      profiles = body.profiles;
      captureEvent('profile_added', {
        profile_slot: slot + 1,
        has_export: Boolean(form.elements.files.files.length),
        has_diary_username: Boolean(form.elements.username.value.trim()),
      });
      if (slot === 1) addingSecondPerson = false;
      renderPeople();
    } catch (error) {
      showError(section, error.message);
      button.disabled = false;
      button.textContent = 'Add';
    }
  });

  return section;
}

function renderInvite() {
  const section = cloneTemplate('invite-template');
  field(section, 'add').addEventListener('click', () => {
    addingSecondPerson = true;
    renderPeople();
  });
  return section;
}

function renderFilm(film) {
  const item = document.createElement('li');
  const title = document.createElement('span');
  const rating = document.createElement('span');
  title.textContent = film.year ? `${film.name} (${film.year})` : film.name;
  rating.textContent = `${film.rating}★`;
  rating.className = 'rating';
  item.append(title, rating);
  return item;
}

function setUpNetflix(section, slot, profile) {
  const count = profile.netflixTitleCount;
  const buttonText = count > 0 ? 'Replace Netflix history' : 'Add Netflix history';
  const label = field(section, 'netflix-label');
  const fileInput = field(section, 'netflix-file');

  label.textContent = buttonText;
  field(section, 'netflix-status').textContent = count > 0
    ? `${count} titles read. Anything you've watched won't be recommended.`
    : "Upload NetflixViewingHistory.csv so movies you've watched there aren't recommended.";

  fileInput.addEventListener('change', async () => {
    if (fileInput.files.length === 0) return;
    field(section, 'error').hidden = true;
    label.textContent = 'Reading…';

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
      const body = await api(`/api/profiles/${slot}/netflix`, { method: 'POST', body: formData });
      profiles = body.profiles;
      captureEvent('netflix_history_added', {
        profile_slot: slot + 1,
        history_replaced: count > 0,
        title_count: profiles[slot]?.netflixTitleCount ?? 0,
      });
      renderPeople();
    } catch (error) {
      showError(section, error.message);
      label.textContent = buttonText;
      fileInput.value = '';
    }
  });
}

function setUpDiary(section, slot, profile) {
  const form = field(section, 'diary-form');
  const button = field(section, 'diary-button');
  const input = form.elements.username;
  const username = profile.letterboxdUsername;

  input.value = username ?? '';
  button.textContent = username ? 'Update' : 'Connect';
  field(section, 'diary-status').textContent = username
    ? `Connected to ${username}. Recent diary entries are added each time you build a shortlist.`
    : 'Add your username and new watches from your public diary are picked up automatically. Your watchlist still comes from the export.';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    field(section, 'diary-error').hidden = true;
    button.disabled = true;
    button.textContent = 'Connecting…';

    try {
      const body = await api(`/api/profiles/${slot}/letterboxd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: input.value }),
      });
      profiles = body.profiles;
      captureEvent('letterboxd_diary_connected', {
        profile_slot: slot + 1,
        diary_updated: Boolean(username),
      });
      renderPeople();
    } catch (error) {
      const message = field(section, 'diary-error');
      message.textContent = error.message;
      message.hidden = false;
      button.disabled = false;
      button.textContent = username ? 'Update' : 'Connect';
    }
  });
}

function renderProfile(slot, profile) {
  const section = cloneTemplate('profile-template');
  field(section, 'heading').textContent = profile.name;
  field(section, 'summary').textContent =
    `${profile.watchlistCount} on watchlist · ${profile.watchedCount} watched · ${profile.ratedCount} rated`;
  field(section, 'films').append(...profile.topRated.map(renderFilm));

  const hiddenCount = profile.topRatedCount - profile.topRated.length;
  if (hiddenCount > 0) {
    field(section, 'more').textContent = `and ${hiddenCount} more`;
    field(section, 'more').hidden = false;
  }

  setUpDiary(section, slot, profile);
  setUpNetflix(section, slot, profile);
  field(section, 'remove').addEventListener('click', () => startRemoval(slot));
  return section;
}

function renderSlot(slot) {
  if (profiles[slot]) return [renderProfile(slot, profiles[slot])];
  if (slot === 0) return [renderUpload(0)];
  if (!profiles[0]) return [];
  return [addingSecondPerson ? renderUpload(1) : renderInvite()];
}

function renderPeople() {
  people.replaceChildren(...renderSlot(0), ...renderSlot(1));
  toTonight.disabled = !canVisit('tonight');
  servicesLegend.textContent = filledCount() === 2 ? 'Services you share' : 'Your services';
  updateSteps(currentStep());
}

// Tonight
function readChoices() {
  const formData = new FormData(finderForm);
  return {
    services: formData.getAll('services'),
    region: formData.get('region'),
    mood: formData.get('mood'),
  };
}

function loadSavedChoices() {
  return readStored(CHOICES_STORAGE_KEY) ?? {};
}

function saveChoices(choices) {
  writeStored(CHOICES_STORAGE_KEY, choices);
}

// Quiz mode has no services to pick, since films can be free, rented or bought.
function updateFinder() {
  const ready = mode === 'quiz' || readChoices().services.length > 0;
  finderButton.disabled = !ready;
  finderHint.hidden = ready;
}

function renderChoice(type, name, value, checked, ...content) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  const face = document.createElement('span');
  input.type = type;
  input.name = name;
  input.value = value;
  input.checked = checked;
  face.append(...content);
  label.append(input, face);
  return label;
}

function renderMood(mood, checked) {
  const title = document.createElement('strong');
  const note = document.createElement('small');
  title.textContent = mood.name;
  note.textContent = MOOD_NOTES[mood.id];
  const label = renderChoice('radio', 'mood', mood.id, checked, title, note);
  label.className = 'mood';
  return label;
}

async function setUpFinder() {
  const options = await api('/api/options');
  genres = options.genres;
  eras = options.eras;
  const saved = loadSavedChoices();
  const savedMood = options.moods.some(({ id }) => id === saved.mood) ? saved.mood : 'either';

  serviceOptions.replaceChildren(...options.services.map((service) => {
    const label = renderChoice('checkbox', 'services', service.id, Boolean(saved.services?.includes(service.id)), service.name);
    label.className = 'chip';
    return label;
  }));
  moodOptions.replaceChildren(...options.moods.map((mood) => renderMood(mood, mood.id === savedMood)));
  region.replaceChildren(...options.regions.map((code) => new Option(code, code)));
  if (options.regions.includes(saved.region)) region.value = saved.region;

  updateFinder();
  finderForm.addEventListener('change', updateFinder);
  finderForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const choices = readChoices();
    saveChoices(choices);
    buildShortlist(choices);
  });
}

// Quiz
function blankQuizPerson() {
  return { name: '', genres: [], avoid: [], favorites: [], era: 'any' };
}

function isQuizReady() {
  return quizAnswers.every((person) => person.name.trim() && person.genres.length > 0);
}

function readQuizForm(form) {
  const formData = new FormData(form);
  return {
    name: formData.get('name'),
    genres: formData.getAll('genres').map(Number),
    avoid: formData.getAll('avoid').map(Number),
    favorites: formData.getAll('favorites'),
    era: formData.get('era'),
  };
}

function updateQuizReady() {
  quizHint.hidden = isQuizReady();
  toTonight.disabled = !canVisit('tonight');
  updateSteps(currentStep());
}

function renderGenreChips(name, chosen) {
  return genres.map((genre) => {
    const label = renderChoice('checkbox', name, genre.id, chosen.includes(genre.id), genre.name);
    label.className = 'chip';
    return label;
  });
}

function renderQuizPerson(answers, index) {
  const section = cloneTemplate('quiz-template');
  const form = section.querySelector('form');
  field(section, 'heading').textContent = SLOT_HEADINGS[index];
  form.elements.name.value = answers.name;
  field(section, 'genres').append(...renderGenreChips('genres', answers.genres));
  field(section, 'avoid').append(...renderGenreChips('avoid', answers.avoid));
  form.querySelectorAll('[name="favorites"]').forEach((input, slot) => {
    input.value = answers.favorites[slot] ?? '';
  });
  field(section, 'era').append(...eras.map((era) => new Option(era.name, era.id)));
  field(section, 'era').value = answers.era;

  // A genre can't be both wanted and skipped, so choosing it in one list clears the other.
  form.addEventListener('input', (event) => {
    const other = { genres: 'avoid', avoid: 'genres' }[event.target.name];
    if (other && event.target.checked) {
      form.querySelector(`[name="${other}"][value="${event.target.value}"]`).checked = false;
    }
    quizAnswers[index] = readQuizForm(form);
    writeStored(QUIZ_STORAGE_KEY, quizAnswers);
    updateQuizReady();
  });

  if (index > 0) {
    field(section, 'remove').hidden = false;
    field(section, 'remove').addEventListener('click', () => {
      quizAnswers.splice(index, 1);
      writeStored(QUIZ_STORAGE_KEY, quizAnswers);
      renderQuizPeople();
    });
  }
  return section;
}

function renderQuizInvite() {
  const section = cloneTemplate('invite-template');
  field(section, 'add').addEventListener('click', () => {
    quizAnswers.push(blankQuizPerson());
    writeStored(QUIZ_STORAGE_KEY, quizAnswers);
    renderQuizPeople();
  });
  return section;
}

function renderQuizPeople() {
  const cards = quizAnswers.map(renderQuizPerson);
  if (quizAnswers.length < MAX_QUIZ_PEOPLE) cards.push(renderQuizInvite());
  quizPeople.replaceChildren(...cards);
  updateQuizReady();
}

function loadSavedQuiz() {
  const saved = readStored(QUIZ_STORAGE_KEY);
  const valid = Array.isArray(saved) && saved.length > 0 && saved.length <= MAX_QUIZ_PEOPLE;
  return valid ? saved.map((person) => ({ ...blankQuizPerson(), ...person })) : [blankQuizPerson()];
}

function quizRequest(choices) {
  return {
    people: quizAnswers.map((person) => ({
      ...person,
      name: person.name.trim(),
      favorites: person.favorites.map((title) => title.trim()).filter(Boolean),
    })),
    mood: choices.mood,
    region: choices.region,
  };
}

function setMode(nextMode) {
  mode = nextMode;
  writeStored(MODE_STORAGE_KEY, mode);
  const isQuiz = mode === 'quiz';
  modeOptions.querySelector(`[value="${mode}"]`).checked = true;
  people.hidden = isQuiz;
  quizPeople.hidden = !isQuiz;
  servicesField.hidden = isQuiz;
  tonightHeading.textContent = isQuiz ? "Tonight's mood" : 'Streaming platforms';
  if (isQuiz) {
    renderQuizPeople();
  } else {
    quizHint.hidden = true;
    renderPeople();
  }
  updateFinder();
}

// Shortlist
function showPanel(panel) {
  for (const candidate of [loading, failure, results]) candidate.hidden = candidate !== panel;
  focusHeading(panel);
}

function startLoadingMessages(messages) {
  let index = 0;
  loadingStatus.textContent = messages[0];
  loadingTimer = setInterval(() => {
    index = Math.min(index + 1, messages.length - 1);
    loadingStatus.textContent = messages[index];
  }, LOADING_MESSAGE_MS);
}

function visiblePicks() {
  return [...resultsList.children].filter((item) => !item.hidden);
}

function updatePicksHeading() {
  const total = resultsList.children.length;
  const remaining = visiblePicks().length;
  const vetoed = total - remaining;

  restorePicks.hidden = vetoed === 0;
  restorePicks.textContent = vetoed === 1 ? 'Bring back 1 pick' : `Bring back ${vetoed} picks`;

  if (remaining === 0) resultsHeading.textContent = 'None of these tonight';
  else if (remaining === 1 && vetoed > 0) resultsHeading.textContent = 'Your pick for tonight';
  else resultsHeading.textContent = "Today's Shortlist";
}

function listServices(names) {
  const shown = names.slice(0, MAX_SERVICES_SHOWN).join(', ');
  const hiddenCount = names.length - MAX_SERVICES_SHOWN;
  return hiddenCount > 0 ? `${shown} and ${hiddenCount} more` : shown;
}

// Quiz picks can be watched in many ways, so the card shows the best one first.
function whereToWatch(pick) {
  if (pick.services) return `On ${pick.services.join(', ')}`;
  const [key, label] = WATCH_OPTION_LABELS.find(([key]) => pick.watchOptions?.[key].length > 0) ?? [];
  return key ? `${label} ${listServices(pick.watchOptions[key])}` : null;
}

function renderWatchOptions(item, watchOptions) {
  const lines = WATCH_OPTION_LABELS
    .filter(([key]) => watchOptions?.[key].length > 0)
    .map(([key, label]) => {
      const line = document.createElement('li');
      line.textContent = `${label} ${watchOptions[key].join(', ')}`;
      return line;
    });
  field(item, 'watch').append(...lines);
  field(item, 'watch-details').hidden = lines.length === 0;
}

// The service leads the facts row, since it decides whether you can watch tonight.
function renderFacts(item, pick) {
  const service = whereToWatch(pick);
  const rest = [pick.runtime && `${pick.runtime} min`, pick.genres.join(', ')].filter(Boolean);
  const facts = field(item, 'facts');
  if (service) {
    const strong = document.createElement('span');
    strong.className = 'pick-service';
    strong.textContent = service;
    facts.append(strong, rest.length ? ` · ${rest.join(' · ')}` : '');
  } else {
    facts.textContent = rest.join(' · ');
  }
}

// Read more only shows when the description is actually cut off.
function fitOverview(item) {
  const overview = field(item, 'overview');
  if (overview.classList.contains('is-expanded')) return;
  field(item, 'read-more').hidden = overview.scrollHeight <= overview.clientHeight + 1;
}

function fitOverviews() {
  for (const item of resultsList.children) fitOverview(item);
}

function viewerNames() {
  return mode === 'quiz'
    ? quizAnswers.map((person) => person.name.trim())
    : profiles.filter(Boolean).map((profile) => profile.name);
}

// Each person prints in their own ink, and a pick for both prints in the overprint.
function inkFor(label) {
  if (!label) return 'first';
  if (label === 'Both of you') return 'both';
  return label === `${viewerNames()[0]}'s pick` ? 'first' : 'second';
}

function renderPick(pick, index) {
  const item = cloneTemplate('pick-template');
  item.dataset.ink = inkFor(pick.label);
  field(item, 'title').textContent = `${pick.title} (${pick.year})`;
  field(item, 'why').textContent = pick.why;
  renderFacts(item, pick);
  if (!pick.services) renderWatchOptions(item, pick.watchOptions);
  field(item, 'overview').textContent = pick.overview;
  field(item, 'overview').hidden = !pick.overview;
  field(item, 'read-more').addEventListener('click', (event) => {
    const expanded = field(item, 'overview').classList.toggle('is-expanded');
    event.currentTarget.setAttribute('aria-expanded', String(expanded));
    event.currentTarget.textContent = expanded ? 'Show less' : 'Read more';
  });

  if (pick.label) {
    field(item, 'label').textContent = pick.label;
    field(item, 'label').hidden = false;
  }
  if (pick.posterPath) {
    field(item, 'poster').src = `${POSTER_BASE_URL}${pick.posterPath}`;
    field(item, 'poster').alt = `Poster for ${pick.title}`;
    field(item, 'poster').hidden = false;
  } else {
    field(item, 'poster-fallback').textContent = pick.title;
    field(item, 'poster-fallback').hidden = false;
  }

  // A turned-down film makes way for the next backup, until the backups run out.
  field(item, 'veto').addEventListener('click', () => {
    const replacement = backupPicks.shift();
    captureEvent('shortlist_pick_vetoed', {
      shortlist_mode: mode,
      pick_position: index + 1,
      replaced: Boolean(replacement),
    });
    item.hidden = true;
    if (replacement) {
      const swappedIn = renderPick(replacement, index);
      // Stays marked until it's touched, so the change is never missed.
      field(swappedIn, 'new').hidden = false;
      swappedIn.classList.add('is-new');
      const clearNew = () => {
        field(swappedIn, 'new').hidden = true;
        swappedIn.classList.remove('is-new');
      };
      swappedIn.addEventListener('pointerdown', clearNew, { once: true });
      swappedIn.addEventListener('focusin', clearNew, { once: true });
      item.after(swappedIn);
      fitOverview(swappedIn);
      showToast(`Swapped in ${replacement.title}.`);
    }
    updatePicksHeading();
    resultsHeading.focus({ preventScroll: true });
  });
  return item;
}

function summarizeResults({ picks, candidateCount, stats }) {
  if (mode === 'quiz') {
    return picks.length > 0
      ? `Chosen from ${candidateCount} films that match your answers.`
      : `Checked ${stats.checked} films and none matched. Try more genres or a wider era.`;
  }
  const watched = stats.watchedOnLetterboxd + stats.watchedOnNetflix;
  return picks.length > 0
    ? `Chosen from ${candidateCount} films on your services. Skipped ${watched} you've already watched.`
    : `Checked ${stats.checked} films and none are on your services. Try adding another service.`;
}

function describeTonight() {
  const date = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const mood = moodOptions.querySelector('input:checked')?.closest('label')?.querySelector('strong')?.textContent;
  // Non-breaking spaces keep "Sam & Alex" together when the line wraps.
  return [date, viewerNames().join('\u00a0&\u00a0'), mood].filter(Boolean).join(' · ');
}

function showResults({ picks, backups, candidateCount, stats }) {
  captureEvent('shortlist_generated', {
    shortlist_mode: mode,
    people_count: mode === 'quiz' ? quizAnswers.length : filledCount(),
    picks_count: picks.length,
    candidate_count: candidateCount,
  });
  resultsContext.textContent = describeTonight();
  resultsSummary.textContent = summarizeResults({ picks, candidateCount, stats });
  backupPicks = [...backups];
  resultsList.replaceChildren(...picks.map(renderPick));
  updatePicksHeading();
  if (picks.length === 0) resultsHeading.textContent = 'Nothing to pick from tonight';
  showPanel(results);
  fitOverviews();
}

async function buildShortlist(choices) {
  lastChoices = choices;
  hasShortlist = true;
  showStep('shortlist');
  showPanel(loading);
  const isQuiz = mode === 'quiz';
  startLoadingMessages(isQuiz ? QUIZ_LOADING_MESSAGES : LOADING_MESSAGES);

  try {
    await finishRemoval();
    showResults(await api(isQuiz ? '/api/quiz-shortlist' : '/api/shortlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isQuiz ? quizRequest(choices) : choices),
    }));
  } catch (error) {
    failureMessage.textContent = error.message;
    showPanel(failure);
  } finally {
    clearInterval(loadingTimer);
  }
}

function setUpNavigation() {
  for (const link of document.querySelectorAll('[data-step-link]')) {
    link.addEventListener('click', () => goToStep(link.dataset.stepLink));
  }
  for (const button of document.querySelectorAll('[data-go-to]')) {
    button.addEventListener('click', () => goToStep(button.dataset.goTo));
  }
  toTonight.addEventListener('click', () => goToStep('tonight'));
  modeOptions.addEventListener('change', (event) => setMode(event.target.value));
  document.getElementById('try-again').addEventListener('click', () => buildShortlist(lastChoices));
  restorePicks.addEventListener('click', () => {
    const restored_count = resultsList.children.length - visiblePicks().length;
    captureEvent('shortlist_picks_restored', { shortlist_mode: mode, restored_count });
    for (const item of resultsList.children) item.hidden = false;
    updatePicksHeading();
    resultsHeading.focus({ preventScroll: true });
  });

  // Leaving the page ends the Undo window, so the removal still has to reach the server.
  window.addEventListener('resize', fitOverviews);

  window.addEventListener('pagehide', () => {
    if (pendingRemoval) fetch(`/api/profiles/${pendingRemoval.slot}`, { method: 'DELETE', keepalive: true });
  });
}

async function start() {
  setUpNavigation();
  try {
    await setUpFinder();
    profiles = (await api('/api/profiles')).profiles;
  } catch (error) {
    showStep('you');
    showToast(error.message);
    return;
  }
  quizAnswers = loadSavedQuiz();
  const savedMode = readStored(MODE_STORAGE_KEY) === 'quiz' ? 'quiz' : 'letterboxd';
  // Someone returning with a profile is ready to choose tonight's film.
  // Quiz answers are about what people are into right now, so they're shown again first.
  showStep(savedMode === 'letterboxd' && filledCount() > 0 ? 'tonight' : 'you');
  setMode(savedMode);
}

start();
