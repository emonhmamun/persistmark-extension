# Chrome Web Store — Listing Copy (ready to paste)

Everything below is ready to paste into the Chrome Web Store developer dashboard
when you publish PersistMark. Character limits noted per field.

## Store listing

### Name (75 max)

```
PersistMark — Permanent Text Highlighter
```

### Summary (132 max)

```
Highlight text on any website in any color. Highlights persist across refresh,
restarts & revisits. Private — no accounts, no tracking.
```

### Description (16,000 max)

```
✔ HIGHLIGHT ANYTHING, ANYWHERE — AND KEEP IT FOREVER

Select any text on any website and highlight it in one click. Your highlights
survive page refreshes, browser restarts and return visits — PersistMark is the
highlighter your browser should have shipped with.

🎨 ANY COLOR, ANY STRENGTH
• 8 preset colors + a custom color picker (millions of shades)
• Intensity slider — from subtle tint to bold marker
• The Highlight button always uses your last-used color
• Per-highlight recolor and intensity — click any highlight to change it

🔒 BUILT TO LAST
• Smart text anchoring re-locates highlights even when page layout changes
• Works on dynamic pages: SPAs (YouTube, Reddit), lazy-loaded content, iframes
• Automatic dark-mode & light-mode adaptation for perfect readability

🧹 FULLY MANAGEABLE
• Delete via popover, toolbar, right-click menu or Alt+Shift+D
• One-click Undo toast after every deletion
• Popup manager: searchable list, notes on any highlight, jump-to-highlight
• Export / import JSON backups
• Optional sync across devices (uses your browser's own Chrome Sync)
• Site blocklist — disable on specific websites

🔐 100% PRIVATE. REALLY.
No accounts. No analytics. No tracking. No network requests at all. Everything
is stored locally in your browser — your highlights belong to you.

⌨️ SHORTCUTS
• Alt+Shift+H — toggle highlighter mode (auto-highlight selections)
• Alt+Shift+L — highlight current selection
• Alt+Shift+D — remove highlights in selection

HOW TO USE
1. Select text (drag, double-click, triple-click or keyboard) — a small toolbar
   appears above it.
2. Click Highlight (or pick a color dot). Done — nothing is highlighted until
   you confirm.
3. Come back later. Your highlights are still there.

Works on Chrome, Edge and Brave (Manifest V3). Not compatible with canvas-based
apps like Google Docs (their text is not real DOM text).

Notes are saved automatically. Deleting a highlight can be undone for 6
seconds.
```

### Category

`Productivity`

### Language

`English`

## Graphics

| Asset | File | Notes |
|---|---|---|
| Store icon | `icons/icon128.png` | must be ≤ 128×128 |
| Screenshots (≥ 1280×800, 1–5) | `screenshots/*.png` | toolbar, custom color panel, multi-color highlights, popup, dark mode |
| Small promo tile (440×280) | `assets/promo-tile.png` | optional |

## Privacy disclosures (dashboard → Privacy)

- **Single purpose:** highlight and persistently save user-selected text on web
  pages.
- **Do you sell or transfer data to third parties?** No.
- **Do you use data for purposes unrelated to your single purpose?** No.
- **Do you collect websites' content?** No — the extension only reads page text
  to apply the user's own highlights, on pages where the user created them.

### Permission justifications

| Permission | Text to paste |
|---|---|
| `storage` / `unlimitedStorage` | "Saves the user's highlights and settings locally in the browser; unlimitedStorage prevents data loss when the user has many highlights." |
| `<all_urls>` | "Required so the highlighter can run on every website the user chooses to highlight on. Reads page content only to apply the user's own highlights. No data leaves the browser." |
| `contextMenus` | "Adds the right-click 'Highlight selection' menu entry." |
| (commands) | "Provides the Alt+Shift+H / L / D keyboard shortcuts." |

## Publishing checklist

- [ ] Zip the extension: `npm run package` → `dist/persistmark-extension.zip`
  (or download the CI artifact)
- [ ] One-time $5 developer registration at
      [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
- [ ] New item → upload zip → paste listing above
- [ ] Upload screenshots + promo tile
- [ ] Fill privacy tab (single purpose, no data sale, justifications above)
- [ ] Add a privacy policy URL (link to the raw PRIVACY_POLICY.md on GitHub)
- [ ] Submit for review (typically a few days)
