# Installation Guide

## Chrome / Edge / Brave (from source)

1. **Download the code**
   - Click **Code → Download ZIP** on the repository page and unzip it, or
   - `git clone https://github.com/your-username/persistmark-extension.git`
2. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Enable **Developer mode** (toggle at the top-right).
4. Click **Load unpacked** and select the folder that contains `manifest.json`.
5. Pin PersistMark to your browser toolbar for quick access to the highlight manager.

### Updating to a new version

1. Replace the old folder with the new one (or `git pull`).
2. On the extensions page, click the **↻ Reload** button on the PersistMark card.
3. Refresh any open tabs that should show highlights.

### Local files (`file://`)

To highlight text in local HTML files:

`chrome://extensions` → PersistMark → **Details** → enable **Allow access to file URLs**.

### Chrome Web Store

Once published, the store version installs with one click — this section will
link to it.

## Firefox

Firefox supports most of Manifest V3 with small differences. To run PersistMark
in Firefox:

1. In `manifest.json`, replace the background block:

   ```diff
   - "background": { "service_worker": "background/service-worker.js" }
   + "background": { "scripts": ["shared/common.js", "background/service-worker.js"] }
   ```

   and delete the `importScripts('/shared/common.js');` line at the top of
   `background/service-worker.js` (loading `common.js` via the manifest replaces it).

2. `chrome.*` APIs work in Firefox, but to be safe you can add this shim at the
   very top of `shared/common.js`:

   ```js
   if (typeof browser !== 'undefined' && typeof chrome === 'undefined') {
     globalThis.chrome = globalThis.browser;
   }
   ```

3. (Recommended for distribution) add a browser-specific id:

   ```json
   "browser_specific_settings": {
     "gecko": { "id": "persistmark@your-addon-id" }
   }
   ```

4. Load it via `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**
   → select `manifest.json`.

## Verifying the install

1. Open any article (or `test/test-page.html` locally).
2. Select a sentence — the floating toolbar should appear immediately.
3. Click **Highlight** — the text gains a colored background.
4. Refresh the page (F5) — the highlight reappears. ✅

If anything fails, see the [troubleshooting section in the README](../README.md#-faq)
or [open an issue](https://github.com/your-username/persistmark-extension/issues).
