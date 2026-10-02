# Architecture

PersistMark is a Manifest V3 browser extension with four contexts:

```
┌──────────────────────────┐   messages    ┌────────────────────────────┐
│ background/service-worker│◄─────────────►│  popup / options pages     │
│ context menus, commands, │               │  highlight manager,        │
│ badge count              │               │  settings, backups, sync   │
└────────────▲─────────────┘               └─────────────▲──────────────┘
             │ tabs.sendMessage                           │ chrome.storage
             ▼                                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│ content/content-script.js  (runs in every http/https/file frame)      │
│  • selection toolbar / popover / undo toast  (closed shadow roots)    │
│  • highlight engine: wrap, unwrap, recolor, intensity                 │
│  • text anchoring: save → locate → re-apply                           │
│  • persistence: chrome.storage.local (or sync)                        │
│  • SPA URL watcher + MutationObserver for dynamic pages               │
└──────────────────────────────────────────────────────────────────────┘
```

## Storage model

All state lives under `pm:`-prefixed keys in `chrome.storage.local`
(or `.sync` when the user opts in):

| Key | Contents |
|---|---|
| `pm:settings` | user preferences (colors, intensity, toggles, blocklist) |
| `pm:page:<origin+path+query>` | array of highlight records for that URL |
| `pm:pages` | index of pages that have highlights (for stats/backup) |

Each highlight record stores:

```js
{
  id, url, urlKey, title,
  frame: 'top' | 'sub',      // which frame owns it
  color, intensity, note,
  text, prefix, suffix,      // the anchor (see below)
  occurrenceFull, occurrenceText,
  xpath: { start, startOffset, end, endOffset },  // last-resort fallback
  createdAt, updatedAt
}
```

Top frames and iframes persist **only their own records** (merged by frame type),
so two frames on the same URL never clobber each other.

## Text anchoring — how highlights survive refresh

Highlighting is easy; *finding the same text again later* is the hard part.
PersistMark never stores pixel positions or raw DOM node references — those
break on every reload. Instead, at save time it:

1. Builds a **normalized text index** of the whole document: a tree-walker
   collects every visible text node, whitespace is collapsed, and each
   normalized character is mapped back to its `(textNode, offset)`.
2. Converts the selection's DOM Range to `[start, end)` positions in that
   normalized string.
3. Stores the selected text plus ~40 characters of **context on each side**,
   and counts **which occurrence** of `prefix+text+suffix` (and of the bare
   text) the selection was — this disambiguates repeated phrases.

At restore time it rebuilds the index on the fresh DOM and resolves each record
through a fallback chain:

```
prefix + text + suffix   (occurrence)   → most stable
prefix + text            (occurrence)
text + suffix            (occurrence)
text alone               (occurrence)   → weakest context match
XPath saved at highlight time          → last resort (sanity-checked
                                         against the stored text)
```

The located range is then wrapped into `<span class="pm-hl" data-pm-id …>`
elements. Records that cannot be resolved yet (lazy-loaded content) are queued
and retried when a `MutationObserver` fires, the tab becomes visible again, or
the page is restored from the back/forward cache — for up to 60 attempts or
5 minutes.

### Concurrency detail

Wrapping a range splits text nodes, which invalidates the node map of any
already-built index. Records are therefore applied **one at a time, each with a
fresh index**, with `setTimeout(0)` yields between records so large restorations
never block the page.

## Styling: colors, intensity, schemes

Every mark gets its final background computed at apply time:

```
bg = rgba(base, alpha)
alpha = clamp(record.intensity)          // 0.15 … 0.85
dark pages: base is lightened 18%, alpha × 0.9
```

The page scheme (light/dark) is detected per mark by walking up the ancestor
chain and reading the first opaque `background-color`, falling back to
`prefers-color-scheme`. The computed color is applied as an **inline
`!important` style**, which keeps highlights visible on sites with aggressive
CSS while `content/styles.css` (injected via the manifest, so not subject to
page CSP) handles everything else.

## Floating UI isolation

The toolbar, popover and undo toast live in **closed shadow roots** attached to
a single `div.pm-host`. Page stylesheets cannot restyle them, and page scripts
cannot reach inside. `mousedown` uses capture-phase `preventDefault` inside the
UI (to keep the page selection alive) — but event isolation happens on the
*host* in the bubble phase, so every button inside still receives its events.

## Dynamic pages & SPAs

- An 800 ms interval watches `location.href` to detect `pushState`/`replaceState`
  navigation; on change, marks are unwrapped, records reloaded for the new URL
  and re-applied.
- A `MutationObserver` retries pending records when the DOM grows.
- `chrome.storage.onChanged` reconciles the DOM when records change elsewhere
  (popup deletes, imports, another device's sync).

## Testing

Two layers, both runnable headless:

- `test/engine-test.js` — jsdom sessions that drive the real content script
  through a mocked `chrome` API: creating, restoring, removing and undoing
  highlights, occurrence disambiguation, decoy-text resilience, dark-scheme
  detection.
- `test/e2e-test.js` — Playwright loads the actual extension in real Chromium
  (temporary profile, `--load-extension`) and clicks the real floating UI with
  real mouse events: toolbar, swatches, custom color + intensity panel,
  popover recolor/delete, undo toast, trash delete, reload persistence,
  double-click behavior and dark sections. Communication with the isolated
  content-script world happens through a DOM bridge injected only in test
  builds.
