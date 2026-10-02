# Privacy Policy

**Last updated: 2026-10-02**

PersistMark ("the extension") is a browser extension that lets you highlight
text on web pages and keeps those highlights on your device. This policy
explains what data is involved and how it is handled.

## Summary

**PersistMark does not collect, transmit, or sell any personal data.** There are
no accounts, no analytics, no trackers, and no third-party services. Everything
the extension stores stays inside your browser's extension storage on your
device.

## What the extension stores

| Data | Where | Why |
|---|---|---|
| Your highlights (selected text, surrounding context for re-anchoring, color, intensity, optional note, timestamps) | `chrome.storage.local` — or `chrome.storage.sync` **only if you enable it** | To re-apply your highlights when you return to a page |
| Your settings (enabled colors, intensity, toolbar preferences, blocklist) | `chrome.storage.local` | To remember your preferences |
| A per-page index of pages that have highlights | `chrome.storage.local` | To show page counts in the popup |

All of this data is created by your own actions (selecting text, changing
settings). The extension stores **nothing** about pages you never highlight.

## What the extension does NOT do

- ❌ No analytics or telemetry of any kind
- ❌ No network requests — the extension contains no code that communicates with any server
- ❌ No cookies, no fingerprinting, no tracking pixels
- ❌ No accounts, sign-ins, or identifiers
- ❌ No selling, sharing, or profiling — there is nothing to share

## Permissions and why they are needed

| Permission | Justification |
|---|---|
| `storage` / `unlimitedStorage` | Saving your highlights and settings locally; large numbers of highlights need more than the default quota |
| `<all_urls>` (host permission) | Injecting the highlighter into the pages *you* visit — required for a highlighter that works on every site. The extension reads page content only to (re)apply your highlights and only on pages where you have created them |
| `contextMenus` | The right-click "Highlight …" menu entry |
| `commands` | The keyboard shortcuts |

## Sync storage (optional, off by default)

If you explicitly enable **"Store highlights in Chrome Sync"**, your highlights
are copied into `chrome.storage.sync`, which syncs across devices signed into
the same browser profile through your browser vendor's own sync infrastructure
(e.g. Google Sync). That data is governed by your browser vendor's privacy
policy; PersistMark itself still never sees or transmits it. Disabling the
option copies everything back to local storage.

## Deleting your data

- **One page:** popup → *Clear page*
- **Everything:** options page → *Delete ALL data* (removes local and sync copies)
- **Uninstalling** the extension also removes all local extension storage.

## Backups

The *Export* feature downloads a JSON file of your highlights to your computer.
That file is under your control only — treat it like any personal document.

## Changes to this policy

Material changes will be noted here with an updated date and a CHANGELOG entry.

## Contact

Open a GitHub issue at the [repository](https://github.com/your-username/persistmark-extension/issues)
or use the Security tab for sensitive matters.
