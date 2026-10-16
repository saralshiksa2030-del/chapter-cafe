/* ==========================================================================
   nook-sounds.js — connects the Sounds card on the Nook page to the engine.

   The split:  audio-mixer.js = the thinking (no page code)
               this file      = reads clicks, draws the result
   It builds the sound rows from the catalog, so adding a sound later
   needs no HTML change.
   ========================================================================== */

import * as mixer from '../modules/audio-mixer.js';
import { SOUNDS, SCENE_MIXES, SCENE_NAMES } from '../modules/sound-catalog.js';
import { getItem, setItem } from '../modules/storage.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

const STATE_LABELS = { off: '', loading: 'Loading…', playing: 'On', error: '⚠ Try again' };

const rows = new Map();   // sound id -> the pieces of that row

/* ---------- Screen-reader messages ---------- */
const statusEl = $('sounds-status');

/** Cleared first so the same message can be read twice in a row. */
function announce(message) {
  if (!statusEl) return;
  statusEl.textContent = '';
  setTimeout(() => { statusEl.textContent = message; }, 50);
}

/* ---------- Build one row per sound ---------- */
function buildRows(list) {
  for (const sound of SOUNDS) {
    const li = document.createElement('li');
    li.className = 'sound-row';
    li.dataset.state = 'off';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sound-toggle';
    toggle.setAttribute('aria-pressed', 'false');

    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = sound.icon;
    const name = document.createElement('span');
    name.textContent = sound.name;
    const stateText = document.createElement('span');
    stateText.className = 'sound-toggle__state';
    stateText.setAttribute('aria-hidden', 'true');   // aria-pressed already says on/off
    toggle.append(icon, name, stateText);

    const output = document.createElement('output');
    output.className = 'sound-row__value';

    const sliderId = `volume-${sound.id}`;
    const label = document.createElement('label');
    label.className = 'visually-hidden';
    label.htmlFor = sliderId;
    label.textContent = `${sound.name} volume`;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = sliderId;
    slider.className = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '5';
    output.htmlFor = sliderId;

    const message = document.createElement('p');
    message.className = 'sound-row__message field__error';
    message.hidden = true;

    li.append(toggle, output, label, slider, message);
    list.appendChild(li);

    /* --- events --- */
    toggle.addEventListener('click', () => {
      const status = mixer.getSnapshot().sounds[sound.id].status;
      const isActive = status === 'playing' || status === 'loading';
      if (isActive) {
        mixer.setSoundOn(sound.id, false);
        announce(`${sound.name} off`);
      } else {
        turnOn(sound);        // also retries after an error
        announce(`${sound.name} on`);
      }
    });

    slider.addEventListener('input', () => {
      mixer.setSoundVolume(sound.id, Number(slider.value) / 100);
      // Moving the slider on a sound that is off switches it on (less fiddly).
      if (mixer.getSnapshot().sounds[sound.id].status === 'off') turnOn(sound);
    });

    rows.set(sound.id, { li, toggle, stateText, output, slider, message, lastStatus: 'off' });
  }
}

/** Switching a sound on while muted would feel broken, so unmute first. */
function turnOn(sound) {
  if (mixer.getSnapshot().muted) mixer.setMuted(false);
  mixer.setSoundOn(sound.id, true);
}

/* ---------- Draw everything from a snapshot ---------- */
function errorText(kind) {
  return kind === 'offline'
    ? "Needs a connection. Try again when you're back online."
    : "This sound couldn't load. Try again.";
}

function render(snap) {
  const muteToggle = $('mute-toggle');
  const btnMuteAll = $('btn-mute-all');
  const masterSlider = $('master-volume');
  const masterOutput = $('master-output');

  // Mute controls (header icon + card button share one source of truth)
  muteToggle.setAttribute('aria-pressed', String(snap.muted));
  muteToggle.querySelector('[data-icon]').textContent = snap.muted ? '🔇' : '🔊';
  btnMuteAll.textContent = snap.muted ? 'Unmute' : 'Mute all';

  // Overall volume
  const masterPercent = Math.round(snap.master * 100);
  if (Number(masterSlider.value) !== masterPercent) masterSlider.value = String(masterPercent);
  masterOutput.textContent = `${masterPercent}%`;
  masterSlider.setAttribute('aria-valuetext', `Overall volume, ${masterPercent} percent`);

  // Rows
  const activeNames = [];
  for (const sound of SOUNDS) {
    const info = snap.sounds[sound.id];
    const row = rows.get(sound.id);
    const active = info.status === 'playing' || info.status === 'loading';
    if (active) activeNames.push(sound.name);

    row.li.dataset.state = info.status;
    row.toggle.setAttribute('aria-pressed', String(active));
    row.toggle.setAttribute('aria-busy', String(info.status === 'loading'));
    row.stateText.textContent = STATE_LABELS[info.status];

    const percent = Math.round(info.vol * 100);
    if (Number(row.slider.value) !== percent) row.slider.value = String(percent);
    row.output.textContent = `${percent}%`;
    row.slider.setAttribute('aria-valuetext', `${sound.name}, ${percent} percent`);

    row.message.hidden = info.status !== 'error';
    row.message.textContent = info.status === 'error' ? errorText(info.error) : '';
    if (info.status === 'error' && row.lastStatus !== 'error') {
      announce(`${sound.name} couldn't load.`);
    }
    row.lastStatus = info.status;
  }

  // Mini-player label in the header (names come from our own catalog)
  const miniLabel = $('mini-label');
  const labelText = snap.muted ? 'Muted' : activeNames.join(' · ');
  miniLabel.textContent = labelText;
  miniLabel.hidden = labelText === '';

  // "Resume" box
  const resumeBox = $('resume-box');
  resumeBox.hidden = !snap.needsResume;
  if (snap.needsResume) {
    const wanted = SOUNDS.filter((s) => snap.sounds[s.id].on).map((s) => s.name);
    let text;
    let buttonLabel = 'Resume your sounds';
    if (snap.otherTab) {
      text = 'Sounds are playing in another tab.';
      buttonLabel = 'Play here instead';
    } else if (snap.anyActive && !snap.contextRunning) {
      text = 'Your browser paused the sounds.';
      buttonLabel = 'Resume sounds';
    } else {
      text = `Your last mix is ready: ${wanted.join(', ')}.`;
    }
    $('resume-text').textContent = text;
    $('btn-resume').textContent = buttonLabel;
  }
}

/* ---------- Scene suggestion text ---------- */
function updateSceneHint() {
  const scene = root.getAttribute('data-nook');
  const mix = SCENE_MIXES[scene];
  const hint = $('scene-mix-hint');
  if (!mix) { hint.textContent = ''; return; }
  const parts = SOUNDS.filter((s) => typeof mix[s.id] === 'number')
    .map((s) => `${s.name} ${Math.round(mix[s.id] * 100)}%`);
  hint.textContent = `${SCENE_NAMES[scene]}: ${parts.join(', ')}.`;
}

/* ---------- Start ---------- */
function init() {
  if (!$('sounds-body')) return;   // this page has no Sounds card

  if (!mixer.isAudioSupported) {
    $('sounds-unsupported').hidden = false;
    $('sounds-body').hidden = true;
    $('mini-player').hidden = true;
    return;
  }

  buildRows($('sound-rows'));

  // Mute (header icon and card button)
  const toggleMute = () => {
    const nowMuted = !mixer.getSnapshot().muted;
    mixer.setMuted(nowMuted);
    announce(nowMuted ? 'Sounds muted' : 'Sounds unmuted');
  };
  $('mute-toggle').addEventListener('click', toggleMute);
  $('btn-mute-all').addEventListener('click', toggleMute);

  $('master-volume').addEventListener('input', (event) => {
    mixer.setMasterVolume(Number(event.target.value) / 100);
  });

  $('btn-resume').addEventListener('click', () => {
    if (mixer.getSnapshot().muted) mixer.setMuted(false);
    mixer.resumeSaved();
    announce('Sounds resumed');
  });

  $('btn-all-off').addEventListener('click', () => {
    mixer.stopAll();
    announce('All sounds off');
  });

  // "Use this scene's sounds" is a button press: scene changes alone never start sound.
  $('btn-scene-mix').addEventListener('click', () => {
    const scene = root.getAttribute('data-nook');
    const mix = SCENE_MIXES[scene];
    if (!mix) return;
    if (mixer.getSnapshot().muted) mixer.setMuted(false);
    mixer.applyMix(mix);
    announce(`${SCENE_NAMES[scene]} sounds on`);
  });
  document.querySelectorAll('input[name="scene"]').forEach((radio) => {
    radio.addEventListener('change', updateSceneHint);
  });
  updateSceneHint();

  // Optional chime. The setting is saved; the sound is played by the engine.
  const chimeBox = $('chime-toggle');
  chimeBox.checked = getItem('chime', true, (v) => typeof v === 'boolean');
  chimeBox.addEventListener('change', () => setItem('chime', chimeBox.checked));

  // nook.js announces "a session ended" with this custom event.
  document.addEventListener('cc:session-ended', (event) => {
    const result = event.detail || {};
    // Only for a normal finish: not for early finish, not for "welcome back".
    if (result.reason === 'completed' && chimeBox.checked) mixer.playChime();
  });

  // Get the speakers ready on the very FIRST click anywhere, so a chime can
  // sound even if she pressed Start before the sound card was touched.
  // Nothing plays here; it only wakes the audio system.
  document.addEventListener('click', () => { mixer.prepare(); }, { once: true, capture: true });

  mixer.subscribe(render);
  render(mixer.getSnapshot());
}

init();
