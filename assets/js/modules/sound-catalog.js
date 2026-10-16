/* ==========================================================================
   sound-catalog.js — the list of ambient sounds and the scene mixes.

   WHY a separate file? To add, rename or re-balance a sound later you edit
   ONLY this file. The engine (audio-mixer.js) and the screen
   (nook-sounds.js) both read from it.

   Fields:
     id             short code used in saved data (never change it later)
     name           what the person sees
     icon           decoration only (hidden from screen readers)
     files          file names in assets/audio/, tried in this order.
                    OGG loops more smoothly; MP3 works everywhere.
                    You only need ONE of them to exist. Use [] for "no files".
     generator      (optional) the name of a sound the code can MAKE ITSELF.
                    It is used when files is empty, or when every file fails.
                    Only 'rain' exists so far (see rain-generator.js).
     defaultVolume  0 to 1, used the first time
     trim           multiplier to level-match sounds. If one is much louder
                    than the others, lower its trim (e.g. 0.6).
   ========================================================================== */

export const SOUNDS = [
  // Rain is built into the code, so it works with no files at all.
  // Later, if you add a licensed recording, change it to:
  //    files: ['rain.ogg', 'rain.mp3'],
  // and keep generator: 'rain'. The recording is used, and the built-in
  // rain becomes the backup if the file ever fails to load.
  { id: 'rain',  name: 'Rain',        icon: '🌧', files: [], generator: 'rain',             defaultVolume: 0.4,  trim: 1 },
  { id: 'fire',  name: 'Fireplace',   icon: '🔥', files: ['fireplace.ogg', 'fireplace.mp3'], defaultVolume: 0.3,  trim: 1 },
  { id: 'cafe',  name: 'Café murmur', icon: '☕', files: ['cafe.ogg', 'cafe.mp3'],           defaultVolume: 0.25, trim: 1 },
  { id: 'birds', name: 'Birdsong',    icon: '🐦', files: ['birds.ogg', 'birds.mp3'],         defaultVolume: 0.3,  trim: 1 },
];

// A quick way to find a sound by its id.
export const SOUND_BY_ID = new Map(SOUNDS.map((sound) => [sound.id, sound]));

// "Use this scene's sounds": volumes from 0 to 1. Any sound NOT listed
// for a scene is switched off when the button is pressed.
export const SCENE_MIXES = {
  rainy:   { rain: 0.45, cafe: 0.2 },
  sunny:   { birds: 0.3, cafe: 0.25 },
  library: { fire: 0.35, rain: 0.15 },
};

export const SCENE_NAMES = {
  rainy: 'Rainy Window',
  sunny: 'Sunny Corner',
  library: 'Midnight Library',
};
