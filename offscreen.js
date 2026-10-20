// Offscreen document: the only extension context that can hold a live
// MediaStream and AudioContext without a visible page. One audio graph per
// captured tab:
//
//   tab stream -> preamp -> 10 biquad bands -> limiter -> analyser -> speakers
//
// Capturing a tab mutes it, so routing the processed signal to the speakers
// is what you hear — there's no doubled audio.

const sessions = new Map(); // tabId -> { ctx, stream, chain, analyser }

async function start(tabId, streamId, settings) {
  if (sessions.has(tabId)) stop(tabId);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  });

  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const source = ctx.createMediaStreamSource(stream);
  const chain = buildEqChain(ctx);

  // Boosting bands can push peaks above 0 dBFS; a brick-wall-ish
  // compressor keeps that from turning into harsh digital clipping.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.8;

  source.connect(chain.input);
  chain.output.connect(limiter);
  limiter.connect(analyser);
  analyser.connect(ctx.destination);

  applyEqSettings(chain, settings, ctx);

  stream.getAudioTracks()[0].addEventListener('ended', () => {
    stop(tabId);
    chrome.runtime.sendMessage({ target: 'background', type: 'captureEnded', tabId });
  });

  sessions.set(tabId, { ctx, stream, chain, analyser });
}

function stop(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  s.stream.getTracks().forEach((t) => t.stop());
  s.ctx.close();
  sessions.delete(tabId);
}

function applyAll(settings) {
  for (const s of sessions.values()) applyEqSettings(s.chain, settings, s.ctx);
}

// Returns the spectrum as bytes (0-255) plus enough info for the popup to map
// bins to frequencies.
function spectrum(tabId) {
  const s = sessions.get(tabId);
  if (!s) return null;
  const data = new Uint8Array(s.analyser.frequencyBinCount);
  s.analyser.getByteFrequencyData(data);
  return { bins: Array.from(data), sampleRate: s.ctx.sampleRate };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  switch (msg.type) {
    case 'start':
      start(msg.tabId, msg.streamId, msg.settings)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    case 'stop':
      stop(msg.tabId);
      sendResponse({ ok: true });
      return;
    case 'settings':
      applyAll(msg.settings);
      sendResponse({ ok: true });
      return;
    case 'spectrum':
      sendResponse({ ok: true, spectrum: spectrum(msg.tabId) });
      return;
  }
});
