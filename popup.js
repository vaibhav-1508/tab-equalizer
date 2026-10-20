const $ = (id) => document.getElementById(id);

const DEFAULT_SETTINGS = { gains: EQ_BANDS.map(() => 0), preamp: 0, preset: 'Flat' };

let tab = null;
let settings = { ...DEFAULT_SETTINGS };
let active = false;
const sliders = [];
const outputs = [];

// ---------- messaging ----------

function toBackground(message) {
  return chrome.runtime.sendMessage({ ...message, target: 'background' });
}

function showError(text) {
  $('error').textContent = text || '';
  $('error').hidden = !text;
}

// ---------- UI construction ----------

function formatFreq(f) {
  return f >= 1000 ? `${f / 1000}k` : String(f);
}

function formatDb(v) {
  return v > 0 ? `+${v}` : String(v);
}

function buildBands() {
  const group = $('bands');
  EQ_BANDS.forEach(({ freq }, i) => {
    const band = document.createElement('div');
    band.className = 'band';

    const out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = -EQ_MAX_DB;
    input.max = EQ_MAX_DB;
    input.step = 0.5;
    input.title = `${formatFreq(freq)} Hz`;
    input.addEventListener('input', () => {
      settings.gains[i] = Number(input.value);
      settings.preset = 'Custom';
      onSettingsChanged();
    });
    input.addEventListener('dblclick', () => {
      settings.gains[i] = 0;
      settings.preset = 'Custom';
      onSettingsChanged();
    });

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = formatFreq(freq);

    band.append(out, input, label);
    group.append(band);
    sliders.push(input);
    outputs.push(out);
  });

  const select = $('preset');
  for (const name of [...Object.keys(EQ_PRESETS), 'Custom']) {
    const opt = document.createElement('option');
    opt.value = opt.textContent = name;
    select.append(opt);
  }
  select.addEventListener('change', () => {
    const gains = EQ_PRESETS[select.value];
    if (!gains) return;
    settings.gains = [...gains];
    settings.preset = select.value;
    onSettingsChanged();
  });

  $('preamp').addEventListener('input', (e) => {
    settings.preamp = Number(e.target.value);
    onSettingsChanged();
  });
  $('preamp').addEventListener('dblclick', () => {
    settings.preamp = 0;
    onSettingsChanged();
  });

  $('reset').addEventListener('click', () => {
    settings = { ...DEFAULT_SETTINGS, gains: [...DEFAULT_SETTINGS.gains] };
    onSettingsChanged();
  });

  $('enabled').addEventListener('change', onToggle);
}

function renderControls() {
  sliders.forEach((s, i) => {
    s.value = settings.gains[i];
    outputs[i].textContent = formatDb(settings.gains[i]);
  });
  $('preamp').value = settings.preamp;
  $('preampValue').textContent = formatDb(settings.preamp);
  $('preset').value = settings.preset;
  $('enabled').checked = active;
}

// Slider drags fire many input events; push to the audio at most once per frame.
let pushQueued = false;
function onSettingsChanged() {
  renderControls();
  drawGraph();
  if (pushQueued) return;
  pushQueued = true;
  requestAnimationFrame(() => {
    pushQueued = false;
    toBackground({ type: 'settings', settings });
  });
}

// ---------- enabling capture ----------

async function onToggle() {
  showError('');
  const want = $('enabled').checked;
  try {
    if (want) {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      const res = await toBackground({ type: 'start', tabId: tab.id, streamId });
      if (!res?.ok) throw new Error(res?.error);
      active = true;
      startSpectrum();
    } else {
      await toBackground({ type: 'stop', tabId: tab.id });
      active = false;
      spectrumData = null;
    }
  } catch (err) {
    active = false;
    showError(friendlyError(err));
  }
  renderControls();
  drawGraph();
}

function friendlyError(err) {
  const msg = String(err?.message || err || 'Unknown error');
  if (/Chrome pages cannot be captured|chrome:\/\/|webstore/i.test(msg)) {
    return "Chrome doesn't allow capturing this page. Try a regular website tab.";
  }
  if (/active stream/i.test(msg)) {
    return 'This tab is already being captured (maybe by another extension or screen share).';
  }
  return msg;
}

// ---------- graph: EQ curve + live spectrum ----------

const canvas = $('graph');
const g = canvas.getContext('2d');
const F_MIN = 20;
const F_MAX = 20000;
const DB_RANGE = 20;
const CURVE_POINTS = 256;

// An OfflineAudioContext lets us build the same filters the offscreen doc
// uses and ask them for their real frequency response, without opening an
// audio device.
const curveCtx = new OfflineAudioContext(1, 1, 48000);
const curveChain = buildEqChain(curveCtx);
const curveFreqs = new Float32Array(CURVE_POINTS);
for (let i = 0; i < CURVE_POINTS; i++) {
  curveFreqs[i] = F_MIN * Math.pow(F_MAX / F_MIN, i / (CURVE_POINTS - 1));
}

const xOf = (f) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * canvas.width;
const yOfDb = (db) => canvas.height / 2 - (db / DB_RANGE) * (canvas.height / 2 - 10);

let spectrumData = null;

function computeCurve() {
  const total = new Float32Array(CURVE_POINTS).fill(settings.preamp);
  const mag = new Float32Array(CURVE_POINTS);
  const phase = new Float32Array(CURVE_POINTS);
  curveChain.filters.forEach((f, i) => {
    // Set values directly (not via automation) so getFrequencyResponse sees them now.
    f.gain.value = settings.gains[i];
    f.getFrequencyResponse(curveFreqs, mag, phase);
    for (let k = 0; k < CURVE_POINTS; k++) total[k] += 20 * Math.log10(mag[k]);
  });
  return total;
}

function drawGrid() {
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 1;
  g.fillStyle = 'rgba(255,255,255,0.3)';
  g.font = '16px system-ui';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const x = Math.round(xOf(f)) + 0.5;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, canvas.height);
    g.stroke();
    g.fillText(formatFreq(f), x + 4, canvas.height - 6);
  }
  for (const db of [-18, -12, -6, 0, 6, 12, 18]) {
    const y = Math.round(yOfDb(db)) + 0.5;
    g.strokeStyle = db === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(canvas.width, y);
    g.stroke();
  }
}

function drawSpectrum() {
  if (!spectrumData) return;
  const { bins, sampleRate } = spectrumData;
  const binHz = sampleRate / 2 / bins.length;
  g.beginPath();
  g.moveTo(0, canvas.height);
  for (let x = 0; x <= canvas.width; x += 3) {
    const f = F_MIN * Math.pow(F_MAX / F_MIN, x / canvas.width);
    const v = bins[Math.min(bins.length - 1, Math.round(f / binHz))] / 255;
    g.lineTo(x, canvas.height - v * canvas.height * 0.9);
  }
  g.lineTo(canvas.width, canvas.height);
  g.closePath();
  g.fillStyle = 'rgba(148, 163, 184, 0.18)';
  g.fill();
}

function drawCurve() {
  const curve = computeCurve();
  g.beginPath();
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = xOf(curveFreqs[i]);
    const y = yOfDb(Math.max(-DB_RANGE, Math.min(DB_RANGE, curve[i])));
    i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  g.strokeStyle = active ? accent : 'rgba(255,255,255,0.35)';
  g.lineWidth = 3;
  g.stroke();

  g.lineTo(canvas.width, yOfDb(0));
  g.lineTo(0, yOfDb(0));
  g.closePath();
  g.fillStyle = active ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.05)';
  g.fill();
}

function drawGraph() {
  g.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  drawSpectrum();
  drawCurve();
}

let spectrumRunning = false;
async function startSpectrum() {
  if (spectrumRunning) return;
  spectrumRunning = true;
  while (active) {
    try {
      const res = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'spectrum',
        tabId: tab.id,
      });
      spectrumData = res?.spectrum ?? null;
    } catch {
      spectrumData = null;
    }
    drawGraph();
    await new Promise((r) => setTimeout(r, 40));
  }
  spectrumRunning = false;
}

// ---------- init ----------

async function init() {
  buildBands();

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('tabTitle').textContent = tab?.title || 'Current tab';

  const stored = (await chrome.storage.local.get('settings')).settings;
  settings = { ...DEFAULT_SETTINGS, ...stored };
  settings.gains = [...settings.gains];

  const status = await toBackground({ type: 'status', tabId: tab.id });
  active = !!status?.active;

  renderControls();
  drawGraph();
  if (active) startSpectrum();
}

init().catch((err) => showError(friendlyError(err)));
