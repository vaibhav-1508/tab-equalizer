# Tab Equalizer

A 10-band audio equalizer for Chrome that works on any tab playing sound: YouTube, Spotify Web, Netflix, SoundCloud, podcasts, and more.

## Features

- 10 bands from 32 Hz to 16 kHz, each adjustable by ±18 dB
- Preamp slider to keep the overall volume in check
- Presets: Flat, Bass Boost, Bass Cut, Treble Boost, Vocal, Rock, Electronic, Acoustic, Late Night, Loudness
- Live graph of the EQ curve over the tab's spectrum
- Built-in limiter to prevent harsh distortion on big boosts
- Works on several tabs at once; an **EQ** badge marks the tabs being equalized
- Settings are saved between browser sessions

## Requirements

Chrome 124 or newer, or another Chromium-based browser such as Edge, Brave, Opera or Arc. Firefox and Safari are not supported.

## Installation

The extension isn't on the Chrome Web Store, so you load it as an unpacked extension.

### 1. Download the code

Either clone the repository:

```bash
git clone https://github.com/vaibhav-1508/tab-equalizer.git
```

or click **Code → Download ZIP** on GitHub and unzip it. Keep the folder somewhere permanent, because the browser loads the extension from it every time it starts.

### 2. Open the extensions page

| Browser | Address to type |
|---|---|
| Chrome | `chrome://extensions` |
| Edge | `edge://extensions` |
| Brave | `brave://extensions` |
| Opera | `opera://extensions` |

### 3. Turn on Developer mode

Chrome and Brave have a toggle in the top-right corner. In Edge it's in the left sidebar.

### 4. Load the extension

Click **Load unpacked** and select the `tab-equalizer` folder, the one that contains `manifest.json`. **Tab Equalizer** should now appear in your list of extensions.

### 5. Pin it to the toolbar

Click the puzzle-piece icon next to the address bar, then click the pin next to **Tab Equalizer**.

## Usage

1. Open a tab that is playing audio.
2. Click the **Tab Equalizer** icon in the toolbar.
3. Turn on the switch in the top-right corner of the popup. The icon shows an **EQ** badge on that tab.
4. Choose a preset or drag the sliders.
   - Double-click a slider to reset it to 0 dB.
   - **Reset** sets every band back to flat.
   - If the sound starts to get squashed or "pumpy", lower the **Pre** slider by a few dB.
5. To stop equalizing, open the popup and turn the switch off. Closing the tab also stops it.

The EQ settings are shared by every tab being equalized. Changes take effect immediately.

### Bass tips

Most laptop speakers, phones and earbuds can barely play sound below about 60 Hz, so the **32 Hz** slider mainly matters on a subwoofer or good over-ear headphones. For bass you can hear on most devices, use the **64 Hz** and **125 Hz** sliders.

## Updating

Pull the latest code (or download the ZIP again), open the extensions page, and click the ↻ reload button on Tab Equalizer. Then reload any tabs you want to equalize.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Chrome doesn't allow capturing this page" | The browser blocks capture on `chrome://` pages and the Web Store. Use a regular website. |
| "This tab is already being captured" | Stop screen sharing in that tab, or turn off any other extension that captures tab audio. |
| The switch turns on but the sound doesn't change | Reload the extension, then reload the tab and turn the switch on again. |
| Other errors | On the extensions page, click **service worker** under Tab Equalizer to see its log. Right-click the popup and choose **Inspect** to see errors from the popup. |

## How it works

When you turn the switch on, the popup asks Chrome for the tab's audio using the [`tabCapture`](https://developer.chrome.com/docs/extensions/reference/api/tabCapture) API. Capturing a tab mutes its normal output. A hidden [offscreen document](https://developer.chrome.com/docs/extensions/reference/api/offscreen) then plays the audio through a Web Audio chain:

```
tab audio → preamp → 10 biquad filters → limiter → analyser → speakers
```

Because the original output is muted, you only hear the equalized sound.

| File | Role |
|---|---|
| `manifest.json` | Extension configuration and permissions |
| `popup.html` / `popup.css` / `popup.js` | The popup: controls, presets, EQ curve and spectrum graph |
| `background.js` | Service worker: manages the offscreen document, tracks equalized tabs, saves settings |
| `offscreen.html` / `offscreen.js` | Runs the audio processing for each captured tab |
| `eq-config.js` | Band frequencies, presets and the filter chain, shared by the popup and the audio engine |

### Permissions

| Permission | Why it's needed |
|---|---|
| `tabCapture` | To read the audio of the tab you turn the EQ on for |
| `offscreen` | To keep processing audio after the popup closes |
| `storage` | To save your EQ settings |

The extension doesn't collect data or make network requests.

## Limitations

- It only affects audio playing in the browser, not other apps on your computer.
- It can't equalize a tab that's being screen-shared or captured by another extension.
