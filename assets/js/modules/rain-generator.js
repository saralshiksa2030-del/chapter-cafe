/* ==========================================================================
   rain-generator.js — makes a rain sound out of math. No file, no licence.

   HOW IT WORKS
   A sound on a computer is just a long list of numbers (one per tiny slice
   of time). We fill that list ourselves:

     Layer 1, the "wash": the soft shhhh of many drops far away.
        random numbers -> made softer ("pink") -> rumble and hiss removed
        -> slowly getting a little louder and quieter, like real rain.
     Layer 2, the "drops": tiny sharp ticks at random moments.

   The two layers are mixed, then the END of the loop is blended into the
   START so that when the sound repeats you cannot hear the join.

   The result is an AudioBuffer, exactly the same kind of thing
   decodeAudioData gives us for a real file, so the mixer treats both alike.

   Tuning knobs (if it sounds wrong, change these):
     HIGH_PASS_HZ / LOW_PASS_HZ  make it thinner/duller. Lower LOW_PASS_HZ
                                 if it sounds too hissy.
     DROPS_PER_SECOND            more = heavier rain. Fewer = lighter.
     DROPS_WEIGHT                how loud the ticks are against the wash.
                                 Lower it if it sounds clicky.
   ========================================================================== */

const LOOP_SECONDS = 10;        // length of the repeating sound
const FADE_SECONDS = 1.5;       // how much end/start overlap hides the join
const PEAK = 0.7;               // loudest point after normalising (0 to 1)

const HIGH_PASS_HZ = 300;       // removes low rumble
const LOW_PASS_HZ = 6500;       // removes harsh hiss
const WASH_WEIGHT = 0.85;
const DROPS_PER_SECOND = 28;    // per speaker
const DROPS_WEIGHT = 0.3;

/** How fast a simple one-pole filter reacts at a given frequency. */
function filterCoefficient(hz, sampleRate) {
  return 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
}

/** Average loudness (root mean square) of a list of samples. */
function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length) || 1;   // never 0, so we never divide by zero
}

/** Layer 1: the soft wash of rain. */
function renderWash(length, sampleRate) {
  const out = new Float32Array(length);

  // Memory cells for the "pink noise" recipe (Paul Kellet's filter).
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let slow = 0;   // follows the low rumble, so we can subtract it (high-pass)
  let fast = 0;   // smooths out harsh hiss (low-pass)

  const highCoef = filterCoefficient(HIGH_PASS_HZ, sampleRate);
  const lowCoef = filterCoefficient(LOW_PASS_HZ, sampleRate);

  // Two slow sine waves make the rain swell and fade a little.
  // Their speeds are exact fits for the loop length (1x and 3x per loop),
  // so the swell lines up perfectly when the sound repeats.
  const phaseA = Math.random() * 2 * Math.PI;
  const phaseB = Math.random() * 2 * Math.PI;

  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;

    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;

    slow += highCoef * (pink - slow);
    const withoutRumble = pink - slow;
    fast += lowCoef * (withoutRumble - fast);

    const t = i / sampleRate;
    const swell =
      1 +
      0.12 * Math.sin((2 * Math.PI * t) / LOOP_SECONDS + phaseA) +
      0.08 * Math.sin((2 * Math.PI * 3 * t) / LOOP_SECONDS + phaseB);

    out[i] = fast * swell;
  }
  return out;
}

/** Layer 2: tiny random ticks (each a very short burst that fades fast). */
function renderDrops(length, sampleRate) {
  const out = new Float32Array(length);
  const count = Math.round((DROPS_PER_SECOND * length) / sampleRate);

  for (let d = 0; d < count; d += 1) {
    const start = Math.floor(Math.random() * (length - 1));
    const decay = (0.003 + Math.random() * 0.007) * sampleRate;   // 3 to 10 ms
    const strength = 0.3 + Math.random() * 0.7;                   // some louder, some softer
    const duration = Math.min(Math.floor(decay * 6), length - start);

    let previous = 0;
    for (let k = 0; k < duration; k += 1) {
      const white = Math.random() * 2 - 1;
      // Subtracting the previous value keeps mostly the bright, sharp part.
      out[start + k] += (white - previous) * strength * Math.exp(-k / decay);
      previous = white;
    }
  }
  return out;
}

/** One speaker's worth of rain, a little longer than the loop (for the blend). */
function renderChannel(totalLength, sampleRate) {
  const wash = renderWash(totalLength, sampleRate);
  const drops = renderDrops(totalLength, sampleRate);

  // Scale each layer to the same average loudness, THEN mix with our weights.
  // WHY: that way the weights mean what they say, whatever the raw numbers were.
  const washScale = (WASH_WEIGHT / rms(wash));
  const dropsScale = (DROPS_WEIGHT / rms(drops));

  const mixed = new Float32Array(totalLength);
  for (let i = 0; i < totalLength; i += 1) {
    mixed[i] = wash[i] * washScale + drops[i] * dropsScale;
  }
  return mixed;
}

/**
 * Cut the stream to loop length and blend its extra tail into the start.
 * After this, the last sample flows straight into the first one.
 * (Equal-power blend: sin² + cos² = 1, so the volume stays steady.)
 */
function makeSeamless(stream, loopLength, fadeLength) {
  const out = new Float32Array(loopLength);
  for (let i = 0; i < loopLength; i += 1) {
    if (i < fadeLength) {
      const t = i / fadeLength;
      out[i] =
        stream[i] * Math.sin((t * Math.PI) / 2) +
        stream[loopLength + i] * Math.cos((t * Math.PI) / 2);
    } else {
      out[i] = stream[i];
    }
  }
  return out;
}

/**
 * Build the rain as an AudioBuffer.
 * @param {AudioContext} ctx  needed for the sample rate and createBuffer
 */
export function createRainBuffer(ctx) {
  const sampleRate = ctx.sampleRate;
  const loopLength = Math.round(LOOP_SECONDS * sampleRate);
  const fadeLength = Math.round(FADE_SECONDS * sampleRate);
  const totalLength = loopLength + fadeLength;

  // Left and right are generated separately, so they differ (wide, natural).
  const left = makeSeamless(renderChannel(totalLength, sampleRate), loopLength, fadeLength);
  const right = makeSeamless(renderChannel(totalLength, sampleRate), loopLength, fadeLength);

  // One shared scale for both speakers keeps the left/right balance.
  let peak = 0;
  for (let i = 0; i < loopLength; i += 1) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const scale = peak > 0 ? PEAK / peak : 1;

  const buffer = ctx.createBuffer(2, loopLength, sampleRate);
  const leftOut = buffer.getChannelData(0);
  const rightOut = buffer.getChannelData(1);
  for (let i = 0; i < loopLength; i += 1) {
    leftOut[i] = left[i] * scale;
    rightOut[i] = right[i] * scale;
  }
  return buffer;
}
