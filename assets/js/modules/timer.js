/* ==========================================================================
   timer.js — the timer's brain. It does NOT touch the page (no DOM code);
   nook.js listens to it and draws things.

   KEY IDEA: we never count seconds. We save WHEN things happened (a
   timestamp) and calculate the elapsed time from the clock. WHY: if the
   laptop sleeps, the tab is in the background, or the page reloads, counting
   would drift or reset, but timestamps stay correct.

   State saved in storage while a session is active:
     status           'running' | 'paused'
     plannedMs        the length she chose
     sessionStartedAt when the session first began (also its unique id)
     resumedAt        when it last started running (null while paused)
     accumulatedMs    time already elapsed before the current running stretch
   ========================================================================== */

import { getItem, setItem, removeItem } from './storage.js';

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 180;
const KEY = 'timer';
const TICK_MS = 250;   // how often we re-check the clock (display only)

export function clampMinutes(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 25;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, n));
}

function isValidSavedState(s) {
  return (
    s !== null && typeof s === 'object' &&
    (s.status === 'running' || s.status === 'paused') &&
    Number.isFinite(s.plannedMs) &&
    s.plannedMs >= MIN_MINUTES * 60000 && s.plannedMs <= MAX_MINUTES * 60000 &&
    Number.isFinite(s.accumulatedMs) && s.accumulatedMs >= 0 &&
    Number.isFinite(s.sessionStartedAt) &&
    (s.status === 'paused' || Number.isFinite(s.resumedAt))
  );
}

/**
 * @param {object} options
 *   onChange(snapshot)   status changed (start, pause, resume, finish...)
 *   onTick(snapshot)     called ~4 times a second while running
 *   onComplete(result)   session ended: {id, startedAt, endedAt, minutes, reason}
 *                        reason: 'completed' | 'restored' | 'finished-early'
 *   now()                clock function (lets us test with a fake clock)
 */
export function createTimer({ onChange, onTick, onComplete, now = () => Date.now() } = {}) {
  let state = idleState(25);
  let intervalId = null;

  function idleState(minutes) {
    return {
      status: 'idle',
      plannedMs: minutes * 60000,
      sessionStartedAt: null,
      resumedAt: null,
      accumulatedMs: 0,
    };
  }

  function elapsedMs() {
    if (state.status === 'running') {
      // Math.max guards against the clock being set backwards.
      return state.accumulatedMs + Math.max(0, now() - state.resumedAt);
    }
    return state.accumulatedMs;
  }

  function snapshot() {
    const elapsed = Math.min(elapsedMs(), state.plannedMs);
    return {
      status: state.status,
      plannedMs: state.plannedMs,
      elapsedMs: elapsed,
      remainingMs: Math.max(0, state.plannedMs - elapsed),
      progress: state.plannedMs > 0 ? elapsed / state.plannedMs : 0,
    };
  }

  function save() {
    if (state.status === 'idle') removeItem(KEY);
    else setItem(KEY, state);
  }

  function emitChange() {
    if (onChange) onChange(snapshot());
  }

  function startTicking() {
    if (intervalId === null) intervalId = setInterval(tick, TICK_MS);
  }

  function stopTicking() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function tick() {
    if (state.status !== 'running') return;
    if (elapsedMs() >= state.plannedMs) {
      complete('completed');
      return;
    }
    if (onTick) onTick(snapshot());
  }

  /** The planned time was reached. */
  function complete(reason) {
    // The exact moment the time ran out (works even if we noticed late).
    const endedAt = state.resumedAt + (state.plannedMs - state.accumulatedMs);
    const result = {
      id: String(state.sessionStartedAt),
      startedAt: state.sessionStartedAt,
      endedAt,
      minutes: Math.round(state.plannedMs / 60000),
      reason,
    };
    state = idleState(state.plannedMs / 60000);
    stopTicking();
    save();
    emitChange();
    if (onComplete) onComplete(result);
  }

  function start(minutes) {
    const m = clampMinutes(minutes);
    const t = now();
    state = { status: 'running', plannedMs: m * 60000, sessionStartedAt: t, resumedAt: t, accumulatedMs: 0 };
    save();
    startTicking();
    emitChange();
  }

  function pause() {
    if (state.status !== 'running') return;
    state.accumulatedMs = elapsedMs();
    state.resumedAt = null;
    state.status = 'paused';
    stopTicking();
    save();
    emitChange();
  }

  function resume() {
    if (state.status !== 'paused') return;
    state.status = 'running';
    state.resumedAt = now();
    save();
    startTicking();
    emitChange();
  }

  /** End early. Logs only the minutes really read (rounded down). */
  function finish() {
    if (state.status === 'idle') return;
    const result = {
      id: String(state.sessionStartedAt),
      startedAt: state.sessionStartedAt,
      endedAt: now(),
      minutes: Math.floor(elapsedMs() / 60000),
      reason: 'finished-early',
    };
    state = idleState(state.plannedMs / 60000);
    stopTicking();
    save();
    emitChange();
    if (onComplete) onComplete(result);
  }

  /** Change the planned length. Only allowed while idle. */
  function setPlannedMinutes(minutes) {
    if (state.status !== 'idle') return;
    state = idleState(clampMinutes(minutes));
    emitChange();
  }

  /** Load a saved session (page reload, or another tab changed it). */
  function restore() {
    const saved = getItem(KEY, null, isValidSavedState);
    if (!saved) {
      if (state.status !== 'idle') state = idleState(state.plannedMs / 60000);
      stopTicking();
      emitChange();
      return;
    }
    state = saved;
    if (state.status === 'running') {
      if (elapsedMs() >= state.plannedMs) {
        complete('restored');          // time ran out while she was away
        return;
      }
      startTicking();
    } else {
      stopTicking();
    }
    emitChange();
  }

  // When the tab becomes visible again, re-check the clock right away
  // (browsers slow timers in background tabs).
  function onVisibility() {
    if (!document.hidden) tick();
  }
  document.addEventListener('visibilitychange', onVisibility);

  function destroy() {
    stopTicking();
    document.removeEventListener('visibilitychange', onVisibility);
  }

  return { start, pause, resume, finish, restore, setPlannedMinutes, getSnapshot: snapshot, destroy };
}