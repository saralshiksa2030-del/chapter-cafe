/* ==========================================================================
   toast.js — a short message that appears, then fades by itself.
   The #toast-region element in the HTML has aria-live="polite", so screen
   readers announce each new message without interrupting the reader.
   ========================================================================== */

export function showToast(message, { duration = 5000 } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;          // textContent is safe: it never runs HTML
  region.appendChild(toast);

  let timeoutId = setTimeout(leave, duration);

  function leave() {
    toast.classList.add('toast--leaving');
    setTimeout(() => toast.remove(), 300);
  }

  // Pausing on hover gives people time to read.
  toast.addEventListener('mouseenter', () => clearTimeout(timeoutId));
  toast.addEventListener('mouseleave', () => { timeoutId = setTimeout(leave, 2000); });
}