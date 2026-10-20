// Shared by the popup and the offscreen document so the drawn curve always
// matches the filters actually applied to the audio.

const EQ_BANDS = [
  { freq: 32, type: 'lowshelf' },
  { freq: 64, type: 'peaking' },
  { freq: 125, type: 'peaking' },
  { freq: 250, type: 'peaking' },
  { freq: 500, type: 'peaking' },
  { freq: 1000, type: 'peaking' },
  { freq: 2000, type: 'peaking' },
  { freq: 4000, type: 'peaking' },
  { freq: 8000, type: 'peaking' },
  { freq: 16000, type: 'highshelf' },
];

const EQ_Q = 1.4;
const EQ_MAX_DB = 18;

const EQ_PRESETS = {
  Flat:            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Boost':    [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  'Bass Cut':      [-6, -5, -4, -2, 0, 0, 0, 0, 0, 0],
  'Treble Boost':  [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  Vocal:           [-3, -2, -1, 1, 3, 4, 4, 3, 1, 0],
  Rock:            [5, 4, 2, -1, -2, -1, 2, 4, 5, 5],
  Electronic:      [6, 5, 1, 0, -2, 1, 0, 2, 4, 5],
  Acoustic:        [4, 3, 2, 1, 2, 2, 3, 3, 2, 1],
  'Late Night':    [-2, -1, 0, 1, 2, 2, 1, 0, -2, -3],
  Loudness:        [6, 4, 0, 0, -2, 0, -1, 0, 4, 2],
};

function buildEqChain(ctx) {
  const preamp = ctx.createGain();
  const filters = EQ_BANDS.map(({ freq, type }) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = EQ_Q;
    f.gain.value = 0;
    return f;
  });
  let node = preamp;
  for (const f of filters) {
    node.connect(f);
    node = f;
  }
  return { input: preamp, output: node, preamp, filters };
}

function applyEqSettings(chain, settings, ctx) {
  const t = ctx.currentTime;
  // setTargetAtTime avoids clicks/zipper noise while dragging sliders.
  chain.preamp.gain.setTargetAtTime(Math.pow(10, settings.preamp / 20), t, 0.02);
  chain.filters.forEach((f, i) => f.gain.setTargetAtTime(settings.gains[i] ?? 0, t, 0.02));
}
