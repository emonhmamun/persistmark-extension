# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-09-29

### Fixed
- **Critical:** every floating-UI button (Highlight, color swatches, Delete, Copy)
  was unresponsive — a capture-phase `stopPropagation` on the toolbar root swallowed
  all events before they reached the buttons. Events are now isolated on the host
  element in the bubble phase, so all buttons work while page scripts still can't
  interfere. Verified with a 39-check Playwright E2E suite running in real Chromium.
- "Yellow lock" — selecting a color other than the default now applies immediately.
- Deleting a highlight (popover Delete, toolbar trash, context menu, `Alt+Shift+D`)
  now reliably removes it from both the DOM and storage, with no resurrection races.
- Dark-section highlights now resolve their color scheme after the mark is inserted
  into the DOM, so the correct variant is always computed.

### Added
- Custom color picker — pick **any color** (not just the 8 presets) from the
  toolbar's new sliders panel.
- Intensity control — set how light or strong each highlight is (per-highlight and
  as a default), with live preview, applied per light/dark page scheme.
- Highlights are now styled with computed inline colors (scheme + intensity aware),
  making them reliable on aggressive sites that override styles.
- Undo toast — after a deletion, a 6-second "Highlight removed — Undo" toast lets
  you restore it in one click.
- Highlighter mode (auto-highlight every selection) is now fully opt-in and was
  removed from the floating toolbar to prevent accidental activation; control it
  from the popup, the options page, or `Alt+Shift+H`.
- Keyboard shortcut `Alt+Shift+D` — remove highlights inside the current selection.
- Intensity + custom-color management in the popup and the options page.
- Playwright E2E test suite (`test/e2e-test.js`) and jsdom engine test suite
  (`test/engine-test.js`).

## [1.0.0] — 2026-09-28

### Added
- Initial release.
- Selection toolbar with 8 preset colors and one-click Highlight button.
- Robust text anchoring (prefix/text/suffix context + occurrence index + XPath
  fallback) so highlights survive refresh, browser restarts and moderate DOM changes.
- Per-highlight notes, recoloring, copy, and deletion via a click popover.
- Popup with searchable highlight list, jump-to-highlight, per-page stats and badge count.
- Options page: master switch, toolbar toggle, iframe and editable-area support,
  site blocklist, optional Chrome Sync storage, JSON export/import backups.
- Context menu, keyboard shortcuts, SPA/dynamic-page support via MutationObserver,
  and automatic light/dark scheme detection.
