/* ==========================================================================
   theme.js — theme picker, light/dark button, and "Reduce motion" switch.

   SPRINT 2 CHANGES: a fourth theme ("contrast") and the footer picker.
   The tiny script in each page's <head> already set the first theme BEFORE
   the page painted (so there is no flash of the wrong colours). This file
   takes over from there.
   ========================================================================== */

import { getItem, setItem } from './storage.js';

const root = document.documentElement;
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const THEMES = ['auto', 'daylight', 'midnight', 'contrast'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Read settings and make sure each value is one we recognise. */
export function getSettings() {
  const saved = getItem('settings', {}, isObject);
  return {
    theme: THEMES.includes(saved.theme) ? saved.theme : 'auto',
    motion: saved.motion === 'off' ? 'off' : 'system',
  };
}

/** Change some settings, keeping any other settings we don't know about. */
function updateSettings(changes) {
  const saved = getItem('settings', {}, isObject);
  setItem('settings', { ...saved, ...changes });
}

function resolveTheme(preference) {
  if (preference === 'auto') return darkQuery.matches ? 'midnight' : 'daylight';  // follow the device
  return preference;
}

function updateThemeButton(button) {
  if (!button) return;
  const isDark = root.getAttribute('data-theme') === 'midnight';
  // The button describes what it WILL do, which is clearer for screen readers.
  button.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  const icon = button.querySelector('[data-icon]');
  if (icon) icon.textContent = isDark ? '☀' : '☾';
}

function applyTheme(button, select) {
  const preference = getSettings().theme;
  root.setAttribute('data-theme', resolveTheme(preference));
  updateThemeButton(button);
  if (select) select.value = preference;     // keep the footer picker in step
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
  const themeSelect = document.getElementById('theme-select');
  const motionButton = document.getElementById('motion-toggle');

  applyTheme(themeButton, themeSelect);
  applyMotion(motionButton);

  if (themeButton) {
    themeButton.addEventListener('click', () => {
      // The header button simply flips light <-> dark.
      const next = root.getAttribute('data-theme') === 'midnight' ? 'daylight' : 'midnight';
      updateSettings({ theme: next });
      applyTheme(themeButton, themeSelect);
    });
  }

  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      // Never trust the value blindly: only accept names we know.
      const chosen = THEMES.includes(themeSelect.value) ? themeSelect.value : 'auto';
      updateSettings({ theme: chosen });
      applyTheme(themeButton, themeSelect);
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
    if (getSettings().theme === 'auto') applyTheme(themeButton, themeSelect);
  });
}
