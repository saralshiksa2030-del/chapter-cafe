/* ==========================================================================
   audio-mixer.js — the sound ENGINE. It never touches the page (no DOM
   code); nook-sounds.js listens to it and draws things.

   HOW WEB AUDIO WORKS (the short version)
   Sounds flow through a chain of "nodes", like pipes:

     source (the file, looping) -> gain (this sound's volume)
                                      -> master gain (overall volume / mute)
                                           -> speakers (ctx.destination)

   WHY decoded buffers instead of an <audio> tag? A decoded buffer with
   loop = true repeats with no gap, which matters for rain and fire.
   (Trade-off: decoded sound uses more memory, so keep files short.)

   AUTOPLAY RULE: browsers only allow sound after the person clicks or
   presses a key. So the AudioContext is created inside click handlers
   (see prepare()), and nothing ever plays on page load.

   Two kinds of state live here:
     SAVED   what she wants (on/off, volumes). Stored via storage.js.
     RUNTIME what is actually happening right now (loading, playing, error).
   ========================================================================== */

import { getItem, setItem } from './storage.js';
import { SOUNDS, SOUND_BY_ID } from './sound-catalog.js';

const FADE_IN = 0.3;                      // seconds
const FADE_OUT = 1.0;
const QUICK_RAMP = 0.1;                   // slider moves: short ramp avoids crackles
const MUTE_RAMP = 0.3;
const HIDDEN_SUSPEND_MS = 10 * 60 * 1000; // pause sound after 10 min in a hidden tab
const CHIME_PEAK = 0.15;                  // chime loudness (soft!)
const SAVE_DELAY_MS = 250;

const AudioContextClass = window.AudioContext || window.webkitAudioContext;
export const isAudioSupported = Boolean(AudioContextClass);

let ctx = null;          // the AudioContext, created on the first click
let masterGain = null;
let pausedByOtherTab = false;
let saveTimer = null;
let hiddenTimer = null;

const buffers = new Map();   // sound id -> decoded audio (decoded once, reused)
const pending = new Map();   // sound id -> loading in progress (avoids double loads)
const listeners = new Set();

/* ---------- Saved state ---------- */

function clamp01(value, fallback) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function defaultState() {
  const sounds = {};
  for (const sound of SOUNDS) sounds[sound.id] = { on: false, vol: sound.defaultVolume };
  return { master: 0.5, sounds };
}

/** Read the saved mix and repair anything missing or broken. */
function loadState() {
  const state = defaultState();
  const saved = getItem('mix', null, (v) => v !== null && typeof v === 'object' && !Array.isArray(v));
  if (!saved) return state;

  state.master = clamp01(saved.master, state.master);
  if (saved.sounds && typeof saved.sounds === 'object') {
    for (const sound of SOUNDS) {
      const item = saved.sounds[sound.id];
      if (item && typeof item === 'object') {
        state.sounds[sound.id].on = item.on === true;
        state.sounds[sound.id].vol = clamp01(item.vol, sound.defaultVolume);
      }
    }
  }
  return state;
}

const state = loadState();
state.muted = false;   // muting is temporary: it is NOT saved (resuming into silence is confusing)

function persistNow() {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
  setItem('mix', { master: state.master, sounds: state.sounds });
}

// Sliders fire many events a second, so wait a moment before saving.
function persistSoon() {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, SAVE_DELAY_MS);
}

window.addEventListener('pagehide', () => { if (saveTimer !== null) persistNow(); });

/* ---------- Runtime state ---------- */

// status: 'off' | 'loading' | 'playing' | 'error'
const channels = new Map(
  SOUNDS.map((sound) => [sound.id, { status: 'off', error: null, gain: null, source: null, token: 0 }])
);

/** A plain copy of everything the screen needs to draw itself. */
export function getSnapshot() {
  const sounds = {};
  let anyActive = false;
  for (const sound of SOUNDS) {
    const channel = channels.get(sound.id);
    const saved = state.sounds[sound.id];
    sounds[sound.id] = { on: saved.on, vol: saved.vol, status: channel.status, error: channel.error };
    if (channel.status === 'playing' || channel.status === 'loading') anyActive = true;
  }
  const contextRunning = Boolean(ctx) && ctx.state === 'running';
  const wantsAny = SOUNDS.some((sound) => state.sounds[sound.id].on);
  return {
    supported: isAudioSupported,
    master: state.master,
    muted: state.muted,
    sounds,
    anyActive,
    contextRunning,
    otherTab: pausedByOtherTab,
    // Show "Resume" when she wants sound but nothing is playing, or the browser paused it.
    needsResume: wantsAny && (!anyActive || !contextRunning),
  };
}

/** Call fn(snapshot) whenever anything changes. Returns an "unsubscribe" function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const snapshot = getSnapshot();
  listeners.forEach((fn) => {
    try { fn(snapshot); } catch (err) { console.error('[Chapter Café] listener error', err); }
  });
}

/* ---------- The audio context ---------- */

function ensureContext() {
  if (!isAudioSupported) return null;
  if (!ctx) {
    try {
      ctx = new AudioContextClass();
    } catch (err) {
      console.warn('[Chapter Café] Could not start audio:', err);
      return null;
    }
    masterGain = ctx.createGain();
    masterGain.gain.value = state.muted ? 0 : state.master;
    masterGain.connect(ctx.destination);
    ctx.addEventListener('statechange', () => emit());
  }
  return ctx;
}

/**
 * Create / wake the audio context. MUST be called from inside a click or
 * key handler. Nothing plays here; it only gets the speakers ready.
 */
export async function prepare() {
  const context = ensureContext();
  if (!context) return false;
  if (context.state !== 'running') {
    try { await context.resume(); } catch (err) { /* needs a click; the UI offers "Resume" */ }
  }
  return context.state === 'running';
}

/** Smoothly move a volume to a new value (a jump would make a click sound). */
function rampTo(param, value, seconds) {
  if (!ctx) return;
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

function targetGain(sound) {
  return state.sounds[sound.id].vol * sound.trim;
}

/* ---------- Loading sound files ---------- */

function decode(data) {
  // Callback style works in every browser; we wrap it in a Promise.
  return new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject));
}

async function fetchAndDecode(sound) {
  let lastError = null;
  for (const file of sound.files) {
    // URL is relative to THIS file, so it works from any page folder.
    const url = new URL('../../audio/' + file, import.meta.url).href;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await decode(await response.arrayBuffer());
    } catch (err) {
      lastError = err;
      // A hint for you, the builder: the person never sees this.
      console.warn(`[Chapter Café] Could not load ${url} (${err.message || err}). Is the file in assets/audio/ ?`);
    }
  }
  throw lastError || new Error('No files listed for this sound');
}

function getBuffer(sound) {
  if (buffers.has(sound.id)) return Promise.resolve(buffers.get(sound.id));
  if (pending.has(sound.id)) return pending.get(sound.id);
  const promise = fetchAndDecode(sound).then(
    (buffer) => { buffers.set(sound.id, buffer); pending.delete(sound.id); return buffer; },
    (err) => { pending.delete(sound.id); throw err; }
  );
  pending.set(sound.id, promise);
  return promise;
}

/* ---------- Starting and stopping one sound ---------- */

async function startChannel(sound) {
  const channel = channels.get(sound.id);
  if (!ctx || channel.status === 'playing' || channel.status === 'loading') return;

  // "token" lets us notice if she switched the sound off while it was loading.
  const token = ++channel.token;
  channel.status = 'loading';
  channel.error = null;
  emit();
  claimAudio();

  try {
    const buffer = await getBuffer(sound);
    if (channel.token !== token) return;       // cancelled while loading

    const gain = ctx.createGain();
    gain.gain.value = 0;                       // start silent, then fade in
    gain.connect(masterGain);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;                        // seamless repeat
    source.connect(gain);
    source.start();
    rampTo(gain.gain, targetGain(sound), FADE_IN);

    channel.gain = gain;
    channel.source = source;
    channel.status = 'playing';
  } catch (err) {
    if (channel.token !== token) return;
    channel.status = 'error';
    channel.error = navigator.onLine ? 'failed' : 'offline';
    // Don't keep a broken sound in the "resume" list.
    state.sounds[sound.id].on = false;
    persistSoon();
  }
  emit();
}

function stopChannel(id) {
  const channel = channels.get(id);
  channel.token += 1;                          // cancels a load in progress
  if (channel.source && ctx) {
    const { source, gain } = channel;
    rampTo(gain.gain, 0, FADE_OUT);
    source.stop(ctx.currentTime + FADE_OUT + 0.05);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
  }
  channel.source = null;
  channel.gain = null;
  channel.status = 'off';
  channel.error = null;
}

/* ---------- Public controls ---------- */

export async function setSoundOn(id, on) {
  const sound = SOUND_BY_ID.get(id);
  if (!sound || !isAudioSupported) return;

  state.sounds[id].on = on;
  persistSoon();

  if (on) {
    pausedByOtherTab = false;
    await prepare();          // called right away, so it still counts as part of the click
    await startChannel(sound);
  } else {
    stopChannel(id);
    emit();
  }
}

export function setSoundVolume(id, volume) {
  const sound = SOUND_BY_ID.get(id);
  if (!sound) return;
  state.sounds[id].vol = clamp01(volume, state.sounds[id].vol);
  persistSoon();
  const channel = channels.get(id);
  if (channel.gain) rampTo(channel.gain.gain, targetGain(sound), QUICK_RAMP);
  emit();
}

export function setMasterVolume(volume) {
  state.master = clamp01(volume, state.master);
  persistSoon();
  if (masterGain && !state.muted) rampTo(masterGain.gain, state.master, QUICK_RAMP);
  emit();
}

export function setMuted(muted) {
  state.muted = Boolean(muted);
  if (masterGain) rampTo(masterGain.gain, state.muted ? 0 : state.master, MUTE_RAMP);
  emit();
}

/** Turn every sound off and forget the "resume" list. */
export function stopAll() {
  for (const sound of SOUNDS) {
    state.sounds[sound.id].on = false;
    stopChannel(sound.id);
  }
  pausedByOtherTab = false;
  persistSoon();
  emit();
}

/**
 * Apply a scene mix like { rain: 0.45, cafe: 0.2 }:
 * listed sounds go on at that volume, all the others go off.
 */
export async function applyMix(mix) {
  if (!isAudioSupported) return;
  const ready = prepare();   // start waking the speakers inside the click
  pausedByOtherTab = false;

  for (const sound of SOUNDS) {
    const entry = state.sounds[sound.id];
    const wanted = mix[sound.id];
    if (typeof wanted === 'number') {
      entry.on = true;
      entry.vol = clamp01(wanted, entry.vol);
    } else {
      entry.on = false;
    }
  }
  persistSoon();
  await ready;

  await Promise.all(SOUNDS.map((sound) => {
    if (!state.sounds[sound.id].on) { stopChannel(sound.id); return null; }
    const channel = channels.get(sound.id);
    if (channel.gain) { rampTo(channel.gain.gain, targetGain(sound), MUTE_RAMP); return null; }
    return startChannel(sound);
  }));
  emit();
}

/** Start whatever was saved as "on", or wake sounds the browser paused. */
export async function resumeSaved() {
  if (!isAudioSupported) return;
  const ready = prepare();
  pausedByOtherTab = false;
  await ready;
  await Promise.all(
    SOUNDS.filter((sound) => state.sounds[sound.id].on).map((sound) => startChannel(sound))
  );
  emit();
}

/* ---------- Session-end chime (generated, so no licence needed) ---------- */

export function playChime() {
  if (!ctx || ctx.state !== 'running' || state.muted) return;
  const start = ctx.currentTime;
  // Two soft notes (E5 then C5), each fading away gently.
  [[659.25, 0], [523.25, 0.35]].forEach(([frequency, delay]) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + delay);
    gain.gain.linearRampToValueAtTime(CHIME_PEAK, start + delay + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 1.6);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start + delay);
    oscillator.stop(start + delay + 1.7);
  });
}

/* ---------- Politeness: one tab at a time, quiet when hidden ---------- */

let tabChannel = null;
try {
  if ('BroadcastChannel' in window) tabChannel = new BroadcastChannel('chapter-cafe-audio');
} catch (err) { /* not supported: skip */ }

function claimAudio() {
  try { if (tabChannel) tabChannel.postMessage('claim'); } catch (err) { /* ignore */ }
}

if (tabChannel) {
  tabChannel.onmessage = (event) => {
    if (event.data !== 'claim') return;
    // Another tab just started sound. Step aside so sounds don't double up.
    let stoppedSomething = false;
    for (const sound of SOUNDS) {
      if (channels.get(sound.id).status !== 'off') { stopChannel(sound.id); stoppedSomething = true; }
    }
    if (stoppedSomething) { pausedByOtherTab = true; emit(); }
  };
}

document.addEventListener('visibilitychange', () => {
  clearTimeout(hiddenTimer);
  if (document.hidden) {
    // Save battery: pause after 10 minutes in the background.
    hiddenTimer = setTimeout(() => {
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    }, HIDDEN_SUSPEND_MS);
  } else if (ctx && ctx.state === 'suspended') {
    // Some browsers refuse without a click; then the "Resume" button appears.
    ctx.resume().catch(() => {});
  }
});
