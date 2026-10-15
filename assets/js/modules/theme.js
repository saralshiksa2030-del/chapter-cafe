/* ==========================================================================
   theme.js — light/dark theme and the "Reduce motion" switch.

   The tiny script in each page's <head> already set the first theme BEFORE
   the page painted (so there is no flash of the wrong colours). This file
   takes over from there: it handles the buttons and keeps things in sync.
   ========================================================================== */

import { getItem, setItem } from './storage.js';

const root = document.documentElement;
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Read settings and make sure each value is one we recognise. */
export function getSettings() {
  const saved = getItem('settings', {}, isObject);
  return {
    theme: ['auto', 'daylight', 'midnight'].includes(saved.theme) ? saved.theme : 'auto',
    motion: saved.motion === 'off' ? 'off' : 'system',
  };
}

/** Change some settings, keeping any other settings we don't know about. */
function updateSettings(changes) {
  const saved = getItem('settings', {}, isObject);
  setItem('settings', { ...saved, ...changes });
}

function resolveTheme(preference) {
  if (preference === 'daylight' || preference === 'midnight') return preference;
  return darkQuery.matches ? 'midnight' : 'daylight';   // "auto" follows the device
}

function updateThemeButton(button) {
  if (!button) return;
  const isDark = root.getAttribute('data-theme') === 'midnight';
  // The button describes what it WILL do, which is clearer for screen readers.
  button.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  const icon = button.querySelector('[data-icon]');
  if (icon) icon.textContent = isDark ? '☀' : '☾';
}

function applyTheme(button) {
  root.setAttribute('data-theme', resolveTheme(getSettings().theme));
  updateThemeButton(button);
}

function applyMotion(button) {
  const reduced = getSettings().motion === 'off';
  if (reduced) root.setAttribute('data-motion', 'off');
  else root.removeAttribute('data-motion');
  if (button) {
    button.setAttribute('aria-pressed', String(reduced));
    const state = button.querySelector('[data-state]');
    if (state) state.textContent = reduced ? 'On' : 'Off';
  }
}

export function initTheme() {
  const themeButton = document.getElementById('theme-toggle');
  const motionButton = document.getElementById('motion-toggle');

  applyTheme(themeButton);
  applyMotion(motionButton);

  if (themeButton) {
    themeButton.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'midnight' ? 'daylight' : 'midnight';
      updateSettings({ theme: next });
      applyTheme(themeButton);
    });
  }

  if (motionButton) {
    motionButton.addEventListener('click', () => {
      const nowReduced = getSettings().motion !== 'off';
      updateSettings({ motion: nowReduced ? 'off' : 'system' });
      applyMotion(motionButton);
    });
  }

  // If the person never chose a theme, follow the device when it changes.
  darkQuery.addEventListener('change', () => {
    if (getSettings().theme === 'auto') applyTheme(themeButton);
  });
}