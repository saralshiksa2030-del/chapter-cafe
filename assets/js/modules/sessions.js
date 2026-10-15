/* ==========================================================================
   sessions.js — the log of reading sessions, and simple stats from it.

   Each session: { id, bookId, startedAt, endedAt, minutes, localDate }
   localDate is a text like "2026-10-15" in the READER'S local time.
   WHY text dates: they can't be broken by time zones or daylight saving.
   ========================================================================== */

import { getItem, setItem } from './storage.js';

const KEY = 'sessions';
const MAX_SESSIONS = 5000;   // a safety cap so the log can never grow forever

/** "2026-10-15" for a timestamp, using the device's local time. */
export function localDateString(timestamp = Date.now()) {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');   // months start at 0
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidSession(s) {
  return (
    s !== null && typeof s === 'object' &&
    typeof s.id === 'string' &&
    Number.isFinite(s.minutes) && s.minutes > 0 &&
    typeof s.localDate === 'string'
  );
}

/** All good sessions. Broken entries are skipped, never crash the page. */
export function getSessions() {
  const saved = getItem(KEY, [], Array.isArray);
  return saved.filter(isValidSession);
}

/**
 * Add a session. Returns true if it was new, false if already logged.
 * WHY the id check: two open tabs (or a reload) must never log the same
 * session twice.
 */
export function addSession({ id, startedAt, endedAt, minutes, bookId = null }) {
  const sessions = getSessions();
  if (sessions.some((s) => s.id === id)) return false;
  sessions.push({
    id,
    bookId,
    startedAt,
    endedAt,
    minutes,
    localDate: localDateString(endedAt),
  });
  setItem(KEY, sessions.slice(-MAX_SESSIONS));
  return true;
}

export function hasAnySessions() {
  return getSessions().length > 0;
}

/** Total minutes read on one date such as "2026-10-15". */
export function minutesOnDate(localDate) {
  return getSessions()
    .filter((s) => s.localDate === localDate)
    .reduce((total, s) => total + s.minutes, 0);
}

/** The last `count` days (oldest first), each with whether she read. */
export function lastDays(count = 7) {
  const minutesByDate = {};
  for (const s of getSessions()) {
    minutesByDate[s.localDate] = (minutesByDate[s.localDate] || 0) + s.minutes;
  }
  const days = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - back);          // JS handles month ends for us
    const date = localDateString(d.getTime());
    const minutes = minutesByDate[date] || 0;
    days.push({ date, minutes, read: minutes > 0, isToday: back === 0 });
  }
  return days;
}