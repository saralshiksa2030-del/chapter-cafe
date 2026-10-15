/* ==========================================================================
   storage.js — the ONLY file that touches localStorage.

   WHY a wrapper? (1) Every read/write needs try/catch, because browsers can
   block or fill up storage. Doing it once here means no other file has to
   remember. (2) Later, to use a database like Supabase, you change THIS
   file and nothing else.

   Values are saved as JSON text under keys starting with "cc_"
   (Chapter Café), so we never clash with other sites' data.
   ========================================================================== */

const PREFIX = 'cc_';

// If localStorage is blocked or full, we fall back to this in-memory Map.
// The app keeps working during the visit; data just isn't kept afterwards.
const memory = new Map();

let available = null; // remembers the result of the first check

function checkAvailable() {
  if (available !== null) return available;
  try {
    const probe = PREFIX + '__probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    available = true;
  } catch (err) {
    available = false;
  }
  return available;
}

/** true if data will really be saved on this device. */
export function isStorageAvailable() {
  return checkAvailable();
}

function readRaw(fullKey) {
  if (checkAvailable()) {
    try {
      return window.localStorage.getItem(fullKey);
    } catch (err) { /* fall through to memory */ }
  }
  return memory.has(fullKey) ? memory.get(fullKey) : null;
}

function writeRaw(fullKey, raw) {
  if (checkAvailable()) {
    try {
      window.localStorage.setItem(fullKey, raw);
      return true;
    } catch (err) { /* storage full: use memory instead */ }
  }
  memory.set(fullKey, raw);
  return false;
}

function removeRaw(fullKey) {
  try {
    if (checkAvailable()) window.localStorage.removeItem(fullKey);
  } catch (err) { /* ignore */ }
  memory.delete(fullKey);
}

/**
 * Read a value.
 * @param {string} key       name without the "cc_" prefix
 * @param {*} fallback       returned when nothing is saved or data is broken
 * @param {Function} [validate]  optional check; return false to reject the value
 */
export function getItem(key, fallback = null, validate = null) {
  const fullKey = PREFIX + key;
  const raw = readRaw(fullKey);
  if (raw === null || raw === undefined) return fallback;
  try {
    const value = JSON.parse(raw);
    // Data parsed fine but has the wrong shape (e.g. old format): ignore it.
    if (validate && !validate(value)) return fallback;
    return value;
  } catch (err) {
    // Corrupted text that isn't valid JSON: remove it and start fresh.
    removeRaw(fullKey);
    return fallback;
  }
}

/** Save a value. Returns true if it reached real storage. */
export function setItem(key, value) {
  try {
    return writeRaw(PREFIX + key, JSON.stringify(value));
  } catch (err) {
    return false;
  }
}

export function removeItem(key) {
  removeRaw(PREFIX + key);
}

/**
 * Run `callback` when ANOTHER tab changes this key.
 * (The browser's "storage" event only fires in the other tabs, not the one
 * that made the change. That is exactly what we want.)
 */
export function onExternalChange(key, callback) {
  window.addEventListener('storage', (event) => {
    // event.key is null when someone clears all storage
    if (event.key === PREFIX + key || event.key === null) callback();
  });
}