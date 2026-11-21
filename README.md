#### 🎬 VIDEO FILTER 1.0

**Google Chrome extension for real-time SVG video enhancement.**
Applies a customizable post-processing pipeline to **all web videos** without canvas frame copying or audio desync:
**Auto-Exposure** (adaptive night brightness) → **FakeHDR** → **LumaSharpen** → **FXAA**. 

🌐 **Language:** **English** | [Русский](./README_ru.md) 

#### ✨ Features

* **4-Stage Real-Time Pipeline:** Fine-tune adaptive night brightness, local contrast, luminance sharpening, and edge anti-aliasing via smooth sliders.
* **Before / After Split-Screen:** Compare original and processed video side-by-side (0%–100%) using a draggable vertical green divider rendered inside a single SourceGraphic.
* **Presets & JSON Backup:** Includes 5 built-in presets (*Original*, *Night*, *Cinema*, *Sharpen + FXAA*, *Flat*) plus custom preset saving, .json export, and import.
* **Bilingual Interface:** Instant **English / Russian** toggle (i18n.js) stored independently in vfPreferences (chrome.storage), keeping your active filter settings intact.

#### 🚀 Installation

1. Create a video-filter folder and place all extension files inside:
manifest.json, filter.js, i18n.js, content.js, background.js, popup.html, popup.css, popup.js.
2. Open chrome://extensions/ and enable **Developer mode** (top-right corner).
3. Click **Load unpacked** and select the video-filter folder.
4. Pin the **VIDEO FILTER** icon to your toolbar.

**Updating:** Replace the files in the folder, click the refresh icon (↻) in chrome://extensions/, and **reload open video tabs** so updated content scripts take effect. 

#### 🎛 Controls & Shortcuts

* **Open Panel:** Click the extension icon in the toolbar.
* **Toggle Filter:** Press Alt+Shift+F or use the **ON/OFF** switch in the header.
* **Toggle Stage:** Use the **Block Active** switch inside each of the 4 filter sections.
* **Before / After Mode:** Click **Show Line** to split the frame, drag **Line Position** (0%–100%), or click **Center** (50%). Click **Hide Line** to return to full-frame view. *(Note: Unavailable on protected Chrome pages and in Picture-in-Picture).*
* **Presets:** Click built-in preset chips, enter a name + **+ Save** to create your own, or click × to delete.
* **Backup & Reset:** Use **↓ Export .json**, **↑ Load .json**, **Reset**, or the site exclusion button at the bottom of the panel.

#### 🛠 SVG Processing Pipeline

SourceGraphic
  ├─ STAGE 0 · Auto-Exposure   feColorMatrix(luma) → feGaussianBlur(55)
  │                            → feComponentTransfer(mask) → feComposite(k1=1.05, k2=1.00)
  ├─ STAGE 1 · FakeHDR         feGaussianBlur(1.0) → feComposite(k2=1.30, k3=-0.30)
  │                            → feComponentTransfer(9-point curve) → feColorMatrix(saturate)
  ├─ STAGE 2 · LumaSharpen     luma → blur(1.40) → dual opposing differences (±0.24)
  │                            → feComposite(k2=1, k3=1) → feComposite(k2=1, k3=-1)
  ├─ STAGE 3 · FXAA            luma → blur(1.2) → edge detector |L−B| with threshold
  │                            → edge alpha mask → edge-only stair-step smoothing
  ├─ Blend with Original       feComposite(k2=mix, k3=1-mix)
  └─ Alpha Clipping            feComposite operator="in" → Output

*(Controlled via stage toggles enabled, aeOn, hdrOn, shOn, fxaaOn and 20 continuous filter parameters defaulting to the **Original** preset).*