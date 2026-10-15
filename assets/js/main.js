/* ==========================================================================
   main.js — shared startup, loaded by EVERY page.
   ========================================================================== */

import { initTheme } from './modules/theme.js';
import { isStorageAvailable } from './modules/storage.js';

initTheme();

/** Show a note under the navbar. role="alert" is read out at once;
    role="status" is read out politely. */
function addBanner(id, text, role) {
  const region = document.getElementById('banner-region');
  if (!region || document.getElementById(id)) return;
  const banner = document.createElement('p');
  banner.id = id;
  banner.className = 'banner';
  banner.setAttribute('role', role);
  banner.textContent = text;            // textContent, never innerHTML
  region.appendChild(banner);
}

function removeBanner(id) {
  const banner = document.getElementById(id);
  if (banner) banner.remove();
}

if (!isStorageAvailable()) {
  addBanner(
    'storage-banner',
    "Your browser isn't saving data right now, so progress won't be kept. You can still use the timer.",
    'alert'
  );
}

function updateOnlineBanner() {
  if (navigator.onLine) removeBanner('offline-banner');
  else addBanner('offline-banner', "You're offline. The timer still works fine.", 'status');
}
window.addEventListener('online', updateOnlineBanner);
window.addEventListener('offline', updateOnlineBanner);
updateOnlineBanner();