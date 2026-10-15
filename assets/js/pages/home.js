/* ==========================================================================
   home.js — Home page only.
   Its one job: if she has a book open, show a "Continue reading" card.
   Nothing saves a current book yet (that arrives with the Reader sprint),
   so for now this stays hidden. You can test it by hand (see test list).
   ========================================================================== */

import { getItem } from './../modules/storage.js';

function isValidBook(book) {
  return (
    book !== null && typeof book === 'object' &&
    typeof book.id === 'string' &&
    typeof book.title === 'string' &&
    Number.isFinite(book.progress)
  );
}

const slot = document.getElementById('continue-slot');
const book = getItem('current_book', null, isValidBook);

if (slot && book) {
  const percent = Math.round(Math.min(100, Math.max(0, book.progress)));

  const card = document.createElement('section');
  card.className = 'card continue-card';
  card.setAttribute('aria-labelledby', 'continue-title');

  const textBox = document.createElement('div');
  const heading = document.createElement('h2');
  heading.id = 'continue-title';
  heading.textContent = 'Continue reading';
  const line = document.createElement('p');
  line.textContent = `${book.title}, ${percent}%`;   // book.title is saved data: use textContent
  textBox.append(heading, line);

  const link = document.createElement('a');
  link.className = 'btn btn--primary';
  link.href = `pages/reader.html?book=${encodeURIComponent(book.id)}`;
  link.textContent = 'Open Reader';

  card.append(textBox, link);
  slot.appendChild(card);
}