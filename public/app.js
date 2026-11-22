const SLOT_HEADINGS = ['You', 'Second person'];
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';
const CHOICES_STORAGE_KEY = 'shortlist-choices';
const MODE_STORAGE_KEY = 'shortlist-mode';
const QUIZ_STORAGE_KEY = 'shortlist-quiz';
const MAX_QUIZ_PEOPLE = 2;
const MAX_SERVICES_SHOWN = 2;
const MAX_GENRES_SHOWN = 2;
const UNDO_WINDOW_MS = 6000;
const QUIZ_SAVE_DELAY_MS = 800;
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
const accountEmail = document.getElementById('account-email');
const signInButton = document.getElementById('sign-in');
const signOutButton = document.getElementById('sign-out');
const accountDialog = document.getElementById('account-dialog');
const accountForm = document.getElementById('account-form');
const accountTitle = document.getElementById('account-title');
const accountError = document.getElementById('account-error');
const accountSubmit = document.getElementById('account-submit');
const accountSwitch = document.getElementById('account-switch');
const accountSwitchText = document.getElementById('account-switch-text');
const passwordNote = document.getElementById('password-note');
const accountReason = document.getElementById('account-reason');
const myShortlistsButton = document.getElementById('my-shortlists');
const backToSaved = document.getElementById('back-to-saved');
const historySummary = document.getElementById('history-summary');
const savedList = document.getElementById('saved-list');
const historyStart = document.getElementById('history-start');
const saveButton = document.getElementById('save-shortlist');
const nameForm = document.getElementById('name-form');
const refine = document.getElementById('refine');
const refineGroups = document.getElementById('refine-groups');
const refineSummary = document.getElementById('refine-summary');
const refineHint = document.getElementById('refine-hint');
const refineButton = document.getElementById('refine-button');
const refineClear = document.getElementById('refine-clear');
const personInput = document.getElementById('person-input');
const personResults = document.getElementById('person-results');
const personChips = document.getElementById('person-chips');
const toast = document.getElementById('toast');
const toastText = document.getElementById('toast-text');
const toastAction = document.getElementById('toast-action');

let profiles = [null, null];
let addingSecondPerson = false;
let pendingRemoval = null;
let lastChoices = null;
let hasShortlist = false;
let backupPicks = [];
let account = null;
let accountMode = 'login';
// Whose names the pick labels use: tonight's viewers, or a saved list's.
let shownViewers = [];
let shownHeading = "Today's Shortlist";
let pendingDelete = null;
// The shortlist on screen, kept so it can be saved if the person chooses to.
let currentResult = null;
let saveAfterSignIn = false;
let quizSaveTimer = null;
let toastTimer = null;
let loadingTimer = null;
let mode = 'letterboxd';
let quizAnswers = [];
let genres = [];
let eras = [];
let subgenreOptions = [];
const MAX_SUBGENRES = 3;
const MAX_FILM_PEOPLE = 2;
const PERSON_SEARCH_DELAY_MS = 250;
// People picked in the refine panel but not yet applied.
let selectedPeople = [];
let personSearchTimer = null;
let latestPersonQuery = '';

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
  subgenreOptions = options.subgenres;
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
    storeQuiz();
    updateQuizReady();
  });

  if (index > 0) {
    field(section, 'remove').hidden = false;
    field(section, 'remove').addEventListener('click', () => {
      quizAnswers.splice(index, 1);
      storeQuiz();
      renderQuizPeople();
    });
  }
  return section;
}

function renderQuizInvite() {
  const section = cloneTemplate('invite-template');
  field(section, 'add').addEventListener('click', () => {
    quizAnswers.push(blankQuizPerson());
    storeQuiz();
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

function quizFrom(saved) {
  const valid = Array.isArray(saved) && saved.length > 0 && saved.length <= MAX_QUIZ_PEOPLE;
  return valid ? saved.map((person) => ({ ...blankQuizPerson(), ...person })) : [blankQuizPerson()];
}

function loadSavedQuiz() {
  return quizFrom(readStored(QUIZ_STORAGE_KEY));
}

function hasQuizAnswers(answers) {
  return answers.some((person) => person.name.trim() || person.genres.length > 0);
}

// Signed in, answers are kept with the account; signed out, in this browser only.
async function loadQuiz() {
  if (!account) return loadSavedQuiz();
  return quizFrom((await api('/api/setup/quiz')).quiz);
}

async function sendQuiz() {
  clearTimeout(quizSaveTimer);
  quizSaveTimer = null;
  try {
    await api('/api/setup/quiz', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quiz: quizAnswers }),
    });
  } catch (error) {
    showToast(error.message);
  }
}

// Typing changes the answers on every key, so the account copy is saved once typing pauses.
function storeQuiz() {
  if (!account) {
    writeStored(QUIZ_STORAGE_KEY, quizAnswers);
    return;
  }
  clearTimeout(quizSaveTimer);
  quizSaveTimer = setTimeout(sendQuiz, QUIZ_SAVE_DELAY_MS);
}

// Shows whichever setup now applies: the account's when signed in, this browser's when not.
async function refreshSetup() {
  profiles = (await api('/api/profiles')).profiles;
  quizAnswers = await loadQuiz();
  setMode(mode);
  if (currentStep() === 'tonight' && !canVisit('tonight')) showStep('you');
  else updateSteps(currentStep());
}

// The first sign-in carries this browser's setup over; after that the account's own is used.
// Returns a sentence for the sign-in toast, or an empty string.
async function adoptSetup() {
  const browserQuiz = loadSavedQuiz();
  const { adopted } = await api('/api/setup/adopt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quiz: hasQuizAnswers(browserQuiz) ? browserQuiz : null }),
  });
  await refreshSetup();
  if (adopted) return 'Your setup is now saved to your account.';
  return profiles.some(Boolean) || hasQuizAnswers(quizAnswers) ? 'Loaded your setup from your account.' : '';
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
    subgenres: choices.subgenres ?? [],
    withPeople: choices.withPeople ?? [],
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
  else resultsHeading.textContent = shownHeading;
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
  // Two genres keep the facts row to one line on most cards.
  const genres = pick.genres.slice(0, MAX_GENRES_SHOWN).join(', ');
  const rest = [pick.runtime && `${pick.runtime} min`, genres].filter(Boolean);
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
  return label === `${shownViewers[0]}'s pick` ? 'first' : 'second';
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

function subgenreNames(ids = []) {
  return ids.map((id) => subgenreOptions.find((subgenre) => subgenre.id === id)?.name).filter(Boolean);
}

function describeFilmPeople(withPeople = []) {
  return withPeople.length > 0 ? `with ${withPeople.map((person) => person.name).join(' & ')}` : null;
}

function describeTonight(subgenres, withPeople) {
  const date = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const mood = moodOptions.querySelector('input:checked')?.closest('label')?.querySelector('strong')?.textContent;
  // Non-breaking spaces keep "Sam & Alex" together and each dot at the end of its line.
  return [date, viewerNames().join('\u00a0&\u00a0'), mood, describeFilmPeople(withPeople), ...subgenreNames(subgenres)]
    .filter(Boolean)
    .join('\u00a0· ');
}

// Refine by genre
function selectedSubgenres() {
  return [...refineGroups.querySelectorAll('input:checked')].map((input) => input.value);
}

function sameSubgenres(a, b) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function samePeople(a, b) {
  return a.length === b.length && a.every((person) => b.some((other) => other.id === person.id));
}

// Refine is ready whenever the picked filters differ from the ones tonight's list was built with.
function updateRefine() {
  const activeSubgenres = lastChoices?.subgenres ?? [];
  const activePeople = lastChoices?.withPeople ?? [];
  const changed = !sameSubgenres(selectedSubgenres(), activeSubgenres) || !samePeople(selectedPeople, activePeople);
  refineButton.disabled = !changed;
  refineClear.hidden = activeSubgenres.length === 0 && activePeople.length === 0;
}

function renderPersonChips() {
  personChips.replaceChildren(...selectedPeople.map((person) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'person-chip';
    chip.textContent = `${person.name} ×`;
    chip.setAttribute('aria-label', `Remove ${person.name}`);
    chip.addEventListener('click', () => {
      selectedPeople = selectedPeople.filter((other) => other.id !== person.id);
      renderPersonChips();
      personInput.focus();
    });
    return chip;
  }));
  const full = selectedPeople.length >= MAX_FILM_PEOPLE;
  personInput.disabled = full;
  personInput.placeholder = full ? 'Remove someone to add another' : 'Search by name';
  updateRefine();
}

function hidePersonResults() {
  personResults.hidden = true;
  personResults.replaceChildren();
}

function choosePerson(person) {
  if (!selectedPeople.some((other) => other.id === person.id)) {
    selectedPeople = [...selectedPeople, { id: person.id, name: person.name }];
  }
  personInput.value = '';
  hidePersonResults();
  renderPersonChips();
  if (!personInput.disabled) personInput.focus();
}

function renderPersonResults(people) {
  if (people.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'person-empty';
    empty.textContent = 'No actors or directors found.';
    personResults.replaceChildren(empty);
  } else {
    personResults.replaceChildren(...people.map((person) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'person-result';
      const name = document.createElement('strong');
      name.textContent = person.name;
      const note = document.createElement('small');
      note.textContent = [person.department, person.knownFor && `Known for ${person.knownFor}`].filter(Boolean).join(' · ');
      button.append(name, note);
      button.addEventListener('click', () => choosePerson(person));
      item.append(button);
      return item;
    }));
  }
  personResults.hidden = false;
}

// Waits for a pause in typing, and ignores answers to anything but the latest query.
function searchPeople() {
  clearTimeout(personSearchTimer);
  const query = personInput.value.trim();
  if (query.length < 2) {
    hidePersonResults();
    return;
  }
  personSearchTimer = setTimeout(async () => {
    latestPersonQuery = query;
    try {
      const { people } = await api(`/api/people?query=${encodeURIComponent(query)}`);
      if (query === latestPersonQuery) renderPersonResults(people);
    } catch (error) {
      if (query === latestPersonQuery) showToast(error.message);
    }
  }, PERSON_SEARCH_DELAY_MS);
}

// Chips grouped under their main genre, with tonight's active ones already ticked.
function renderRefine(active, activePeople = []) {
  const groups = [...new Set(subgenreOptions.map((subgenre) => subgenre.group))];
  refineGroups.replaceChildren(...groups.map((group) => {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'choices';
    const legend = document.createElement('legend');
    legend.textContent = group;
    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.append(...subgenreOptions.filter((subgenre) => subgenre.group === group).map((subgenre) => {
      const label = renderChoice('checkbox', 'subgenre', subgenre.id, active.includes(subgenre.id), subgenre.name);
      label.className = 'chip';
      return label;
    }));
    fieldset.append(legend, chips);
    return fieldset;
  }));
  refineHint.hidden = true;
  // Closed by default, so the films stay near the top on a phone; the label says what's active.
  refine.open = false;
  const chosen = active.length + activePeople.length;
  refineSummary.textContent = chosen > 0 ? `Refine by person or genre · ${chosen} chosen` : 'Refine by person or genre';
  selectedPeople = [...activePeople];
  personInput.value = '';
  hidePersonResults();
  renderPersonChips();
}

function onRefineChange(event) {
  if (selectedSubgenres().length > MAX_SUBGENRES) {
    event.target.checked = false;
    refineHint.textContent = `Pick up to ${MAX_SUBGENRES} genres.`;
    refineHint.hidden = false;
  } else {
    refineHint.hidden = true;
  }
  updateRefine();
}

// Each refine is a new shortlist, so it costs one more Claude call.
function refineShortlist(subgenres, withPeople) {
  captureEvent('shortlist_refined', {
    shortlist_mode: mode,
    subgenres,
    subgenre_count: subgenres.length,
    people_filter_count: withPeople.length,
  });
  buildShortlist({ ...lastChoices, subgenres, withPeople });
}

function renderShortlist({ picks, backups, viewers, context, summary, fromSaved, heading }) {
  shownViewers = viewers;
  shownHeading = heading ?? "Today's Shortlist";
  nameForm.hidden = true;
  resultsContext.textContent = context;
  resultsSummary.textContent = summary;
  backToSaved.hidden = !fromSaved;
  refine.hidden = fromSaved;
  saveButton.hidden = fromSaved || picks.length === 0;
  saveButton.disabled = false;
  saveButton.textContent = 'Save shortlist';
  backupPicks = [...backups];
  resultsList.replaceChildren(...picks.map(renderPick));
  updatePicksHeading();
  if (picks.length === 0) resultsHeading.textContent = 'Nothing to pick from tonight';
  showPanel(results);
  fitOverviews();
}

function showResults({ picks, backups, candidateCount, stats, subgenres = [], subgenresRelaxed, withPeople = [] }) {
  captureEvent('shortlist_generated', {
    shortlist_mode: mode,
    people_count: mode === 'quiz' ? quizAnswers.length : filledCount(),
    picks_count: picks.length,
    candidate_count: candidateCount,
  });
  const moodLabel = moodOptions.querySelector('input:checked')?.closest('label')?.querySelector('strong')?.textContent;
  currentResult = { mode, mood: lastChoices.mood, moodLabel, viewers: viewerNames(), subgenres, withPeople, picks, backups };
  let summary = summarizeResults({ picks, candidateCount, stats });
  if (picks.length === 0 && withPeople.length > 0) {
    summary = `No films ${describeFilmPeople(withPeople)} came up that you can watch tonight. Try someone else, or clear the filters.`;
  } else if (subgenresRelaxed && picks.length > 0) {
    summary = `${summary} Few films were tagged with these genres, so these are the closest matches.`;
  }
  renderShortlist({
    picks,
    backups,
    viewers: currentResult.viewers,
    context: describeTonight(subgenres, withPeople),
    summary,
    fromSaved: false,
  });
  renderRefine(subgenres, withPeople);
  // With nothing matching, the filters are the next thing to change, so they open.
  if (picks.length === 0 && (subgenres.length > 0 || withPeople.length > 0)) refine.open = true;
}

function formatSavedDate(iso) {
  const date = new Date(iso);
  const day = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

function describeSaved({ viewers, mood }) {
  return [viewers.join('\u00a0&\u00a0'), mood].filter(Boolean).join('\u00a0· ');
}

// Saved shortlists
// A starting name the person can keep or type over, like "Light and easy with Sam & Alex".
function suggestedName({ moodLabel, viewers }) {
  return [moodLabel, viewers.join(' & ')].filter(Boolean).join(' with ');
}

// Saving needs an account, so a signed-out click signs in first, then asks for a name.
function startSave() {
  if (!account) {
    saveAfterSignIn = true;
    openAccountDialog();
    return;
  }
  saveButton.hidden = true;
  nameForm.hidden = false;
  nameForm.elements.name.value = suggestedName(currentResult);
  nameForm.elements.name.focus();
  nameForm.elements.name.select();
}

function cancelSave() {
  nameForm.hidden = true;
  saveButton.hidden = false;
  saveButton.focus();
}

async function submitSave(event) {
  event.preventDefault();
  const submit = nameForm.querySelector('[type="submit"]');
  submit.disabled = true;
  const { moodLabel, ...shortlist } = currentResult;
  try {
    await api('/api/shortlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...shortlist, name: nameForm.elements.name.value }),
    });
    nameForm.hidden = true;
    saveButton.hidden = false;
    saveButton.disabled = true;
    saveButton.textContent = 'Saved';
    captureEvent('shortlist_saved', { shortlist_mode: shortlist.mode, picks_count: shortlist.picks.length });
    showToast('Saved to My shortlists.', { label: 'View', run: openHistory });
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
  }
}

async function openSaved(id) {
  try {
    const saved = await api(`/api/shortlists/${id}`);
    captureEvent('shortlist_saved_viewed', { shortlist_mode: saved.mode, picks_count: saved.picks.length });
    hasShortlist = true;
    showStep('shortlist');
    renderShortlist({
      picks: saved.picks,
      backups: saved.backups,
      viewers: saved.viewers,
      context: [
        formatSavedDate(saved.createdAt),
        describeSaved({ viewers: saved.viewers, mood: saved.moodName }),
        describeFilmPeople(saved.withPeople),
        ...subgenreNames(saved.subgenres),
      ].filter(Boolean).join('\u00a0· '),
      summary: 'A shortlist saved to your account.',
      fromSaved: true,
      heading: saved.name || 'Saved Shortlist',
    });
  } catch (error) {
    showToast(error.message);
  }
}

function listTitles(titles) {
  const shown = titles.slice(0, 3).join(', ');
  return titles.length > 3 ? `${shown} and ${titles.length - 3} more` : shown;
}

// An unnamed list goes by its date, so the date leads either way.
function renderSaved(saved) {
  const item = cloneTemplate('saved-template');
  const date = formatSavedDate(saved.createdAt);
  const label = saved.name || date;
  field(item, 'name').textContent = label;
  field(item, 'meta').textContent = [saved.name ? date : null, describeSaved(saved)].filter(Boolean).join('\u00a0· ');
  field(item, 'titles').textContent = listTitles(saved.titles);
  field(item, 'open').addEventListener('click', () => openSaved(saved.id));
  field(item, 'rename').setAttribute('aria-label', `Rename ${label}`);
  field(item, 'rename').addEventListener('click', () => startRename(saved, item));
  field(item, 'delete').setAttribute('aria-label', `Delete ${label}`);
  field(item, 'delete').addEventListener('click', () => deleteSaved(saved.id, item));
  return item;
}

function showRenameForm(item, open) {
  field(item, 'rename-form').hidden = !open;
  field(item, 'open').hidden = open;
  field(item, 'actions').hidden = open;
}

function startRename(saved, item) {
  const form = field(item, 'rename-form');
  showRenameForm(item, true);
  field(item, 'rename-error').hidden = true;
  form.elements.name.value = saved.name ?? '';
  form.elements.name.focus();
  form.elements.name.select();
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const { name } = await api(`/api/shortlists/${saved.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.elements.name.value }),
      });
      captureEvent('shortlist_saved_renamed', {});
      const renamed = renderSaved({ ...saved, name });
      item.replaceWith(renamed);
      field(renamed, 'rename').focus();
    } catch (error) {
      field(item, 'rename-error').textContent = error.message;
      field(item, 'rename-error').hidden = false;
    }
  };
  field(item, 'rename-cancel').onclick = () => {
    showRenameForm(item, false);
    field(item, 'rename').focus();
  };
}

function summarizeSaved() {
  const count = [...savedList.children].filter((item) => !item.hidden).length;
  historyStart.hidden = count > 0;
  historySummary.textContent = count === 0
    ? 'Shortlists you build while signed in are saved here, newest first.'
    : `${count} saved ${count === 1 ? 'shortlist' : 'shortlists'}, newest first.`;
}

async function openHistory() {
  await finishDelete();
  goToStep('history');
  historySummary.textContent = 'Loading your shortlists…';
  savedList.replaceChildren();
  try {
    const { shortlists } = await api('/api/shortlists');
    savedList.replaceChildren(...shortlists.map(renderSaved));
    summarizeSaved();
  } catch (error) {
    historySummary.textContent = error.message;
  }
}

// Deleting waits out the Undo window, like removing a person.
async function finishDelete() {
  if (!pendingDelete) return;
  const { id, item, timer } = pendingDelete;
  clearTimeout(timer);
  pendingDelete = null;
  hideToast();
  try {
    await api(`/api/shortlists/${id}`, { method: 'DELETE' });
    captureEvent('shortlist_saved_deleted', {});
    item.remove();
  } catch (error) {
    item.hidden = false;
    summarizeSaved();
    showToast(error.message);
  }
}

function undoDelete() {
  const { item, timer } = pendingDelete;
  clearTimeout(timer);
  pendingDelete = null;
  item.hidden = false;
  hideToast();
  summarizeSaved();
}

async function deleteSaved(id, item) {
  await finishDelete();
  item.hidden = true;
  summarizeSaved();
  pendingDelete = { id, item, timer: setTimeout(finishDelete, UNDO_WINDOW_MS) };
  showToast('Deleted a saved shortlist.', { label: 'Undo', run: undoDelete });
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
  refineGroups.addEventListener('change', onRefineChange);
  refineButton.addEventListener('click', () => refineShortlist(selectedSubgenres(), selectedPeople));
  refineClear.addEventListener('click', () => refineShortlist([], []));
  personInput.addEventListener('input', searchPeople);
  personInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePersonResults();
  });
  restorePicks.addEventListener('click', () => {
    const restored_count = resultsList.children.length - visiblePicks().length;
    captureEvent('shortlist_picks_restored', { shortlist_mode: mode, restored_count });
    for (const item of resultsList.children) item.hidden = false;
    updatePicksHeading();
    resultsHeading.focus({ preventScroll: true });
  });

  window.addEventListener('resize', fitOverviews);

  // Leaving the page ends the Undo window, so the removal still has to reach the server.
  window.addEventListener('pagehide', () => {
    if (pendingRemoval) fetch(`/api/profiles/${pendingRemoval.slot}`, { method: 'DELETE', keepalive: true });
    if (pendingDelete) fetch(`/api/shortlists/${pendingDelete.id}`, { method: 'DELETE', keepalive: true });
    if (quizSaveTimer) {
      fetch('/api/setup/quiz', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz: quizAnswers }),
        keepalive: true,
      });
    }
  });
}

// Account
function renderAccount() {
  accountEmail.textContent = account?.email ?? '';
  accountEmail.hidden = !account;
  signInButton.hidden = Boolean(account);
  signOutButton.hidden = !account;
  myShortlistsButton.hidden = !account;
  // Narrow screens hide the email, so it's still there on hover and to screen readers.
  signOutButton.title = account ? `Signed in as ${account.email}` : '';
  signOutButton.setAttribute('aria-label', account ? `Sign out of ${account.email}` : 'Sign out');
}

function setAccountMode(nextMode) {
  accountMode = nextMode;
  const isSignup = nextMode === 'signup';
  accountTitle.textContent = isSignup ? 'Create an account' : 'Sign in';
  accountSubmit.textContent = isSignup ? 'Create account' : 'Sign in';
  accountSwitchText.textContent = isSignup ? 'Already have an account?' : 'New here?';
  accountSwitch.textContent = isSignup ? 'Sign in' : 'Create an account';
  accountForm.elements.password.autocomplete = isSignup ? 'new-password' : 'current-password';
  passwordNote.hidden = !isSignup;
  accountError.hidden = true;
}

function openAccountDialog() {
  setAccountMode('login');
  accountForm.reset();
  accountReason.hidden = !saveAfterSignIn;
  accountDialog.showModal();
}

async function submitAccount(event) {
  event.preventDefault();
  const isSignup = accountMode === 'signup';
  accountSubmit.disabled = true;
  accountError.hidden = true;
  try {
    const body = await api(`/api/account/${isSignup ? 'signup' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: accountForm.elements.email.value,
        password: accountForm.elements.password.value,
      }),
    });
    account = body.user;
    renderAccount();
    accountDialog.close();
    captureEvent(isSignup ? 'account_created' : 'account_signed_in', {});
    let setupNote = '';
    try {
      setupNote = await adoptSetup();
    } catch (error) {
      setupNote = "Your setup couldn't be loaded. Refresh the page to try again.";
    }
    const greeting = isSignup ? `Account created for ${account.email}.` : `Signed in as ${account.email}.`;
    showToast([greeting, setupNote].filter(Boolean).join(' '));
    if (saveAfterSignIn) {
      saveAfterSignIn = false;
      startSave();
    }
  } catch (error) {
    accountError.textContent = error.message;
    accountError.hidden = false;
  } finally {
    accountSubmit.disabled = false;
  }
}

async function signOut() {
  try {
    // An answer typed just before signing out still reaches the account.
    if (quizSaveTimer) await sendQuiz();
    await api('/api/account/logout', { method: 'POST' });
    account = null;
    renderAccount();
    await refreshSetup();
    // Saved lists belong to the account, so they leave the screen with it.
    if (currentStep() === 'history' || !backToSaved.hidden) showStep('you');
    saveButton.disabled = false;
    saveButton.textContent = 'Save shortlist';
    if (!nameForm.hidden) cancelSave();
    captureEvent('account_signed_out', {});
    showToast('Signed out.');
  } catch (error) {
    showToast(error.message);
  }
}

function setUpAccount() {
  signInButton.addEventListener('click', () => {
    saveAfterSignIn = false;
    openAccountDialog();
  });
  saveButton.addEventListener('click', startSave);
  nameForm.addEventListener('submit', submitSave);
  document.getElementById('name-cancel').addEventListener('click', cancelSave);
  // Closing the dialog without signing in drops the pending save.
  accountDialog.addEventListener('close', () => {
    if (!account) saveAfterSignIn = false;
  });
  signOutButton.addEventListener('click', signOut);
  myShortlistsButton.addEventListener('click', openHistory);
  backToSaved.addEventListener('click', openHistory);
  accountForm.addEventListener('submit', submitAccount);
  accountSwitch.addEventListener('click', () => setAccountMode(accountMode === 'login' ? 'signup' : 'login'));
  document.getElementById('account-close').addEventListener('click', () => accountDialog.close());
  // Signing in is optional, so a failed check just leaves the page signed out.
  return api('/api/account')
    .then((body) => {
      account = body.user;
      renderAccount();
    })
    .catch(() => {});
}

async function start() {
  setUpNavigation();
  const accountChecked = setUpAccount();
  try {
    await setUpFinder();
    profiles = (await api('/api/profiles')).profiles;
    await accountChecked;
    quizAnswers = await loadQuiz();
  } catch (error) {
    showStep('you');
    showToast(error.message);
    return;
  }
  const savedMode = readStored(MODE_STORAGE_KEY) === 'quiz' ? 'quiz' : 'letterboxd';
  // Someone returning with a profile is ready to choose tonight's film.
  // Quiz answers are about what people are into right now, so they're shown again first.
  showStep(savedMode === 'letterboxd' && filledCount() > 0 ? 'tonight' : 'you');
  setMode(savedMode);
}

start();
