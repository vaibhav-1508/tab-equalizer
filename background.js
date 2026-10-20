// Service worker: owns the offscreen document and keeps track of which tabs
// are being equalized. The popup talks to this worker; this worker talks to
// the offscreen document, which is where the actual audio processing lives.

const OFFSCREEN_URL = 'offscreen.html';

const DEFAULT_SETTINGS = {
  gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  preamp: 0,
  preset: 'Flat',
};

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function getActiveTabs() {
  const { activeTabs = [] } = await chrome.storage.session.get('activeTabs');
  return activeTabs;
}

async function setActiveTabs(tabs) {
  await chrome.storage.session.set({ activeTabs: tabs });
  updateBadges(tabs);
}

function updateBadges(tabs) {
  chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
  chrome.tabs.query({}, (all) => {
    for (const t of all) {
      chrome.action.setBadgeText({ tabId: t.id, text: tabs.includes(t.id) ? 'EQ' : '' });
    }
  });
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Process captured tab audio through the equalizer.',
  });
}

async function closeOffscreenIfIdle() {
  if ((await getActiveTabs()).length > 0) return;
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) await chrome.offscreen.closeDocument();
}

function toOffscreen(message) {
  return chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
}

async function startTab(tabId, streamId) {
  await ensureOffscreen();
  const settings = await getSettings();
  const res = await toOffscreen({ type: 'start', tabId, streamId, settings });
  if (!res?.ok) throw new Error(res?.error || 'Could not start capture');
  const tabs = await getActiveTabs();
  if (!tabs.includes(tabId)) await setActiveTabs([...tabs, tabId]);
}

async function stopTab(tabId) {
  const tabs = await getActiveTabs();
  if (!tabs.includes(tabId)) return;
  await setActiveTabs(tabs.filter((id) => id !== tabId));
  try {
    await toOffscreen({ type: 'stop', tabId });
  } catch {
    // Offscreen document already gone; nothing to stop.
  }
  await closeOffscreenIfIdle();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'background') return;

  (async () => {
    switch (msg.type) {
      case 'start':
        await startTab(msg.tabId, msg.streamId);
        return { ok: true };
      case 'stop':
        await stopTab(msg.tabId);
        return { ok: true };
      case 'status':
        return { ok: true, active: (await getActiveTabs()).includes(msg.tabId) };
      case 'settings': {
        await chrome.storage.local.set({ settings: msg.settings });
        if ((await getActiveTabs()).length > 0) {
          await toOffscreen({ type: 'settings', settings: msg.settings });
        }
        return { ok: true };
      }
      case 'captureEnded':
        // The offscreen doc tells us when a tab's stream dies on its own.
        await stopTab(msg.tabId);
        return { ok: true };
      default:
        return { ok: false, error: `Unknown message: ${msg.type}` };
    }
  })()
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));

  return true; // keep the channel open for the async response
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopTab(tabId);
});

// The service worker can restart, but the offscreen document (and its audio)
// may not have survived. Reconcile on startup.
chrome.runtime.onStartup.addListener(() => setActiveTabs([]));
chrome.runtime.onInstalled.addListener(() => setActiveTabs([]));
