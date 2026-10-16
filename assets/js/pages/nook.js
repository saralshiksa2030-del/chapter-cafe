/* ==========================================================================
   nook.js — everything that happens on the Nook page.
   timer.js does the thinking; this file reads the page, listens to clicks,
   and draws the results.
   ========================================================================== */

import { getItem, setItem, onExternalChange } from '../modules/storage.js';
import { createTimer, MIN_MINUTES, MAX_MINUTES } from '../modules/timer.js';
import { addSession, minutesOnDate, lastDays, localDateString, hasAnySessions } from '../modules/sessions.js';
import { showToast } from '../modules/toast.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

const SCENES = ['rainy', 'sunny', 'library'];
const PRESETS = [15, 25, 45];
const DRINKS = ['latte', 'chai', 'cocoa', 'tea', 'water'];

// The ring is an SVG circle with radius 54. Its outline length is 2πr.
// We "draw" progress by hiding part of that outline (stroke-dashoffset).
const RING_LENGTH = 2 * Math.PI * 54;

/* ---------- Grab every element once ---------- */
const sceneRadios = document.querySelectorAll('input[name="scene"]');
const presetRadios = document.querySelectorAll('input[name="preset"]');
const drinkRadios = document.querySelectorAll('input[name="drink"]');
const customWrap = $('custom-wrap');
const customInput = $('custom-minutes');
const customError = $('custom-error');
const presetNote = $('preset-note');
const timerPanel = $('timer-panel');
const timerTitle = $('timer-title');
const timeDisplay = $('time-display');
const ringProgress = $('ring-progress');
const btnStart = $('btn-start');
const btnFinish = $('btn-finish');
const statusEl = $('timer-status');
const summaryPanel = $('summary-panel');
const summaryTitle = $('summary-title');
const summaryText = $('summary-text');
const btnAnother = $('btn-another');
const btnDone = $('btn-done');
const todayMinutes = $('today-minutes');
const rhythmEl = $('rhythm');
const rhythmText = $('rhythm-text');
const helpCard = $('help-card');
const pageTitle = $('page-title');
const otherTabNote = $('other-tab-note');

/* ==========================================================================
   Scene picker
   ========================================================================== */
function applyScene(scene) {
  root.setAttribute('data-nook', scene);   // CSS does the rest
}

function initScene() {
  // The head script already set data-nook (saved scene, or a sensible default).
  const saved = getItem('nook_scene', null, (v) => SCENES.includes(v));
  const current = saved || root.getAttribute('data-nook') || 'rainy';
  applyScene(current);
  sceneRadios.forEach((radio) => {
    radio.checked = radio.value === current;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      applyScene(radio.value);
      setItem('nook_scene', radio.value);   // saved only when SHE chooses
    });
  });
}

/* ==========================================================================
   Timer length (presets + custom)
   ========================================================================== */
function parseCustom() {
  const raw = customInput.value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= MIN_MINUTES && n <= MAX_MINUTES ? n : null;
}

function showCustomError(show) {
  customError.hidden = !show;
  customError.textContent = show ? `Try a whole number between ${MIN_MINUTES} and ${MAX_MINUTES}.` : '';
  customInput.setAttribute('aria-invalid', show ? 'true' : 'false');
}

/** The minutes currently chosen, or null if the custom value is invalid. */
function readMinutes() {
  const checked = document.querySelector('input[name="preset"]:checked');
  if (!checked) return null;
  return checked.value === 'custom' ? parseCustom() : Number(checked.value);
}

function applyMinutes(minutes) {
  timer.setPlannedMinutes(minutes);
  setItem('timer_preset', minutes);
}

function onPresetChange() {
  const checked = document.querySelector('input[name="preset"]:checked');
  if (!checked) return;
  const isCustom = checked.value === 'custom';
  customWrap.hidden = !isCustom;
  if (isCustom) {
    onCustomInput();
  } else {
    showCustomError(false);
    applyMinutes(Number(checked.value));
  }
}

function onCustomInput() {
  const minutes = parseCustom();
  if (minutes === null) {
    showCustomError(customInput.value.trim() !== '');   // stay quiet while empty
    return;
  }
  showCustomError(false);
  applyMinutes(minutes);
}

/** Make the radio buttons show a given number of minutes. */
function showMinutesInUi(minutes) {
  if (PRESETS.includes(minutes)) {
    presetRadios.forEach((r) => { r.checked = r.value === String(minutes); });
    customWrap.hidden = true;
  } else {
    presetRadios.forEach((r) => { r.checked = r.value === 'custom'; });
    customWrap.hidden = false;
    customInput.value = String(minutes);
  }
}

function initPresets() {
  const saved = getItem('timer_preset', 25, (v) => Number.isInteger(v) && v >= MIN_MINUTES && v <= MAX_MINUTES);
  showMinutesInUi(saved);
  timer.setPlannedMinutes(saved);
  presetRadios.forEach((r) => r.addEventListener('change', onPresetChange));
  customInput.addEventListener('input', onCustomInput);
}

/* ==========================================================================
   Drawing the timer
   ========================================================================== */
function formatTime(ms) {
  // Math.ceil so a fresh 25-minute timer reads 25:00, not 24:59.
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

let lastTimeText = '';

function render(snap) {
  const text = formatTime(snap.remainingMs);
  if (text !== lastTimeText) {          // only touch the page when it changed
    timeDisplay.textContent = text;
    lastTimeText = text;
  }

  const progress = snap.status === 'idle' ? 0 : snap.progress;
  ringProgress.style.strokeDashoffset = String(RING_LENGTH * (1 - progress));

  timerPanel.dataset.status = snap.status;
  btnStart.textContent = snap.status === 'running' ? 'Pause' : snap.status === 'paused' ? 'Resume' : 'Start';
  btnFinish.hidden = snap.status === 'idle';

  // Lock the length while a session is active, and say why in plain words.
  const locked = snap.status !== 'idle';
  presetRadios.forEach((r) => { r.disabled = locked; });
  customInput.disabled = locked;
  presetNote.hidden = !locked;
}

/** Screen-reader message. Cleared first so repeated text is read again. */
function announce(message) {
  statusEl.textContent = '';
  setTimeout(() => { statusEl.textContent = message; }, 50);
}

/* ==========================================================================
   Buttons
   ========================================================================== */
btnStart.addEventListener('click', () => {
  const snap = timer.getSnapshot();

  if (snap.status === 'idle') {
    const minutes = readMinutes();
    if (minutes === null) {             // custom length is empty or invalid
      showCustomError(true);
      customInput.focus();
      return;
    }
    timer.start(minutes);
    announce(`Timer started: ${minutes} minutes`);
  } else if (snap.status === 'running') {
    timer.pause();
    announce('Timer paused');
  } else {
    timer.resume();
    announce('Timer resumed');
  }
  // Focus deliberately stays on this button: it just changes its label.
});

btnFinish.addEventListener('click', () => timer.finish());

/* ==========================================================================
   When a session ends
   ========================================================================== */
function quietMinutes(n) {
  return `${n} quiet minute${n === 1 ? '' : 's'}`;
}

function handleComplete(result) {
  // SPRINT 2: announce "a session ended" to other modules. nook-sounds.js
  // listens for this to play the optional chime. A custom event means the
  // timer code never needs to know that sound exists.
  document.dispatchEvent(new CustomEvent('cc:session-ended', { detail: result }));

  if (result.minutes >= 1) {
    const isNew = addSession({
      id: result.id,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      minutes: result.minutes,
    });
    if (isNew) showToast('Session saved.');
  }
  refreshToday();
  showSummary(result);
}

function showSummary(result) {
  let title;
  let text;

  if (result.minutes < 1) {
    title = 'That was a short one.';
    text = 'No worries. Nothing was saved, and you can start again whenever you like.';
  } else if (result.reason === 'restored') {
    title = 'Welcome back.';
    text = `Your last session was saved at ${result.minutes} minutes.`;
  } else if (result.reason === 'completed') {
    title = `${quietMinutes(result.minutes)}. Lovely.`;
    text = 'Your session has been saved.';
  } else {
    title = `${quietMinutes(result.minutes)}. Every page counts.`;
    text = 'Your session has been saved.';
  }

  summaryTitle.textContent = title;
  summaryText.textContent = text;
  timerPanel.hidden = true;
  summaryPanel.hidden = false;

  if (result.reason === 'restored') {
    // She just arrived: don't move her focus by surprise.
    announce(`${title} ${text}`);
  } else {
    // Her Finish button just vanished, so put focus somewhere sensible.
    summaryTitle.focus();
    if (result.reason === 'completed') announce(`Session complete: ${result.minutes} minutes`);
  }
}

function hideSummary() {
  summaryPanel.hidden = true;
  timerPanel.hidden = false;
}

btnAnother.addEventListener('click', () => { hideSummary(); btnStart.focus(); });
btnDone.addEventListener('click', () => { hideSummary(); timerTitle.focus(); });

/* ==========================================================================
   Today card + reading rhythm
   ========================================================================== */
function refreshToday() {
  const minutes = minutesOnDate(localDateString());
  if (minutes > 0) todayMinutes.textContent = `${quietMinutes(minutes)} today`;
  else if (hasAnySessions()) todayMinutes.textContent = "Nothing yet, and that's perfectly fine.";
  else todayMinutes.textContent = 'Your first quiet minutes will show up here.';

  const days = lastDays(7);
  const readDays = days.filter((d) => d.read).length;

  rhythmEl.replaceChildren();           // clear old dots
  for (const day of days) {
    const dot = document.createElement('span');
    dot.className = 'rhythm__dot';
    dot.dataset.read = String(day.read);
    dot.dataset.today = String(day.isToday);
    dot.textContent = day.read ? '✓' : '';
    rhythmEl.appendChild(dot);
  }
  // The dots are decoration (aria-hidden in the HTML); this sentence is the real information.
  rhythmText.textContent = hasAnySessions()
    ? `You read on ${readDays} of the last 7 days.`
    : 'Your reading rhythm will appear here.';
}

/* ==========================================================================
   Drink picker (just for atmosphere)
   ========================================================================== */
function initDrink() {
  const saved = getItem('drink', 'latte', (v) => DRINKS.includes(v));
  drinkRadios.forEach((radio) => {
    radio.checked = radio.value === saved;
    radio.addEventListener('change', () => {
      if (radio.checked) setItem('drink', radio.value);
    });
  });
}

/* ==========================================================================
   First-visit tip
   ========================================================================== */
function initHelp() {
  const seen = getItem('seen_nook_help', false, (v) => typeof v === 'boolean');
  if (!seen) helpCard.hidden = false;
  $('btn-help-dismiss').addEventListener('click', () => {
    setItem('seen_nook_help', true);
    helpCard.hidden = true;
    pageTitle.focus();                  // the button vanished; give focus a home
  });
}

/* ==========================================================================
   Start everything
   ========================================================================== */
ringProgress.style.strokeDasharray = String(RING_LENGTH);
// SPRINT 2: start the ring EMPTY. Without this the ring flashes full for a
// moment on load, because a circle with no offset shows its whole outline.
ringProgress.style.strokeDashoffset = String(RING_LENGTH);

const timer = createTimer({
  onChange: render,
  onTick: render,
  onComplete: handleComplete,
});

initScene();
initPresets();
initDrink();
initHelp();
refreshToday();

// Load a session that was running when the page closed or reloaded.
timer.restore();
{
  const snap = timer.getSnapshot();
  if (snap.status !== 'idle') showMinutesInUi(Math.round(snap.plannedMs / 60000));
  render(snap);
}

// If she opens the Nook in a second tab, keep both tabs in step.
onExternalChange('timer', () => {
  timer.restore();
  const snap = timer.getSnapshot();
  if (snap.status !== 'idle') showMinutesInUi(Math.round(snap.plannedMs / 60000));
  otherTabNote.hidden = false;
});
onExternalChange('sessions', refreshToday);

// The date can change while the tab sits open (midnight). Refresh when she returns.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshToday();
});
