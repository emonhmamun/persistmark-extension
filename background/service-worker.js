/*
 * PersistMark – background service worker (MV3)
 * Context menus, keyboard commands, toolbar badge.
 */

importScripts('/shared/common.js');

const SETTINGS_KEY = 'pm:settings';

/* ---------------------------------------------------------------------- */
/* Install                                                                 */
/* ---------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const cur = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    if (!cur) await chrome.storage.local.set({ [SETTINGS_KEY]: HL_DEFAULT_SETTINGS });
  } catch (e) { /* noop */ }
  buildContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  buildContextMenus();
});

/* ---------------------------------------------------------------------- */
/* Context menu:  Highlight "..." > colors  /  Remove highlights           */
/* ---------------------------------------------------------------------- */

function buildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    const opts = { contexts: ['selection'] };
    chrome.contextMenus.create(
      Object.assign({ id: 'pm-highlight', title: 'Highlight “%s”' }, opts),
      () => void chrome.runtime.lastError
    );
    for (const c of HL_PALETTE) {
      chrome.contextMenus.create(
        Object.assign({ id: 'pm-color-' + c.id, parentId: 'pm-highlight', title: c.name }, opts),
        () => void chrome.runtime.lastError
      );
    }
    chrome.contextMenus.create(
      Object.assign({ id: 'pm-remove', title: 'Remove highlights in selection' }, opts),
      () => void chrome.runtime.lastError
    );
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id == null) return;
  let msg = null;
  if (info.menuItemId && info.menuItemId.indexOf('pm-color-') === 0) {
    msg = { type: 'PM_HIGHLIGHT', color: info.menuItemId.slice(8) };
  } else if (info.menuItemId === 'pm-remove') {
    msg = { type: 'PM_REMOVE_IN_SELECTION' };
  }
  if (msg) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
});

/* ---------------------------------------------------------------------- */
/* Keyboard commands                                                       */
/* ---------------------------------------------------------------------- */

chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) return;
    if (command === 'toggle-highlighter-mode') {
      chrome.tabs.sendMessage(tab.id, { type: 'PM_TOGGLE_AUTO' }).catch(() => {});
    } else if (command === 'highlight-selection') {
      chrome.tabs.sendMessage(tab.id, { type: 'PM_HIGHLIGHT' }).catch(() => {});
    } else if (command === 'remove-in-selection') {
      chrome.tabs.sendMessage(tab.id, { type: 'PM_REMOVE_IN_SELECTION' }).catch(() => {});
    }
  } catch (e) { /* noop */ }
});

/* ---------------------------------------------------------------------- */
/* Badge: number of highlights on the current page                         */
/* ---------------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'PM_COUNT' && sender.tab && sender.tab.id != null) {
    const text = msg.count > 0 ? String(msg.count) : '';
    try {
      chrome.action.setBadgeBackgroundColor({ color: '#7c5cff', tabId: sender.tab.id });
      chrome.action.setBadgeTextColor && chrome.action.setBadgeTextColor({ color: '#ffffff', tabId: sender.tab.id });
      chrome.action.setBadgeText({ text, tabId: sender.tab.id });
    } catch (e) { /* noop */ }
  }
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    try { chrome.action.setBadgeText({ text: '', tabId }); } catch (e) { /* noop */ }
  }
});
