/*
 * PersistMark — Permanent Text Highlighter
 * Copyright (C) 2026  MD Mamun
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
(() => {
  'use strict';

  if (window.__PERSISTMARK_CS__) return;
  window.__PERSISTMARK_CS__ = true;

  /* ======================================================================
   * 1. State
   * ==================================================================== */

  const IS_TOP = window === window.top;
  const CTX_LEN = 40;          // context chars stored on each side of the text
  const MAX_TEXT = 20000;      // refuse absurdly large selections
  const MAX_RETRIES = 60;

  let settings = Object.assign({}, HL_DEFAULT_SETTINGS);
  let armed = false;
  let uiBuilt = false;
  let listenersAttached = false;
  let watchersStarted = false;

  let urlKey = '';
  let lastHref = location.href;
  let records = [];            // all records stored for this URL (both frames)
  let applied = new Map();     // id -> [mark elements]
  let pendingRecords = [];
  let retries = 0;
  let pageBootAt = 0;

  let TB = null;               // toolbar  { host, shadow, root, ... }
  let POP = null;              // popover  { host, shadow, root, ... }
  let currentPopId = null;
  let TOAST = null;               // undo toast { host, shadow, root, txt, btn, recs }

  /* ======================================================================
   * 2. Small utilities
   * ==================================================================== */

  const debounce = (fn, ms) => {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, ms);
    };
  };

  const uid = () => 'pm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);

  const normWs = (s) => (s || '').replace(/\s+/g, ' ').trim();

  const markSel = (id) => 'span.pm-hl[data-pm-id="' + id + '"]';

  const marksFor = (id) => Array.from(document.querySelectorAll(markSel(id)));

  const inShadow = (n) => {
    try { return !!(n && n.getRootNode && n.getRootNode() !== document); }
    catch (e) { return false; }
  };

  const luminance = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  function computeUrlKey() {
    return location.origin + location.pathname + location.search;
  }

  function siteBlocked() {
    const host = (location.hostname || '').toLowerCase();
    if (!host) return false;
    return (settings.blocklist || []).some((p) => {
      p = String(p || '').trim().toLowerCase();
      if (!p) return false;
      return host === p || host.endsWith('.' + p);
    });
  }

  function canArm() {
    const proto = location.protocol;
    if (proto !== 'http:' && proto !== 'https:' && proto !== 'file:') return false;
    if (!settings.enabled || siteBlocked()) return false;
    if (!IS_TOP && !settings.iframeEnabled) return false;
    return true;
  }

  async function safeRuntimeMessage(msg) {
    try { await chrome.runtime.sendMessage(msg); } catch (e) { /* context gone */ }
  }

  /* ======================================================================
   * 3. Settings & storage
   * ==================================================================== */

  async function loadSettings() {
    try {
      const o = await chrome.storage.local.get('pm:settings');
      settings = Object.assign({}, HL_DEFAULT_SETTINGS, o['pm:settings'] || {});
    } catch (e) { /* keep defaults */ }
  }

  function saveSettings() {
    chrome.storage.local.set({ 'pm:settings': settings }).catch(() => {});
  }

  function getStore() {
    return settings.syncEnabled ? chrome.storage.sync : chrome.storage.local;
  }

  async function loadRecords() {
    const key = 'pm:page:' + urlKey;
    let syncData = null, localData = null;
    try { syncData = (await chrome.storage.sync.get(key))[key]; } catch (e) { /* noop */ }
    try { localData = (await chrome.storage.local.get(key))[key]; } catch (e) { /* noop */ }
    let r = settings.syncEnabled ? (syncData || localData) : (localData || syncData);
    if (!Array.isArray(r)) r = [];
    records = r;
  }

  function recordsForThisFrame() {
    const t = IS_TOP ? 'top' : 'sub';
    return records.filter((r) => (r.frame || 'top') === t);
  }

  /* Persist only this frame's records, merging with the other frame type
     so a top frame and an iframe never clobber each other. */
  async function persistRecords() {
    if (!urlKey) return;
    const key = 'pm:page:' + urlKey;
    const myType = IS_TOP ? 'top' : 'sub';
    const store = getStore();

    let existing = [];
    try { existing = (await store.get(key))[key] || []; } catch (e) { /* noop */ }
    if (!Array.isArray(existing)) existing = [];

    const mine = records.filter((r) => (r.frame || 'top') === myType);
    const merged = existing.filter((r) => (r.frame || 'top') !== myType).concat(mine);

    try {
      await store.set({ [key]: merged });
    } catch (e) {
      // e.g. storage.sync quota exceeded -> fall back to local
      if (settings.syncEnabled) {
        try {
          await chrome.storage.local.set({ [key]: merged });
          await chrome.storage.local.set({ 'pm:syncwarn': Date.now() });
        } catch (e2) { /* noop */ }
      }
    }
    await updatePageIndex(merged.length);
  }

  async function updatePageIndex(count) {
    try {
      const store = getStore();
      const pages = (await store.get('pm:pages'))['pm:pages'] || {};
      if (count > 0) {
        pages[urlKey] = { url: location.href, title: document.title || '', count, updatedAt: Date.now() };
      } else {
        delete pages[urlKey];
      }
      await store.set({ 'pm:pages': pages });
    } catch (e) { /* noop */ }
  }

  function sendCount() {
    if (!IS_TOP) return;
    safeRuntimeMessage({ type: 'PM_COUNT', count: recordsForThisFrame().length });
  }

  /* ======================================================================
   * 4. Text index & anchors
   * ==================================================================== */

  /* Builds a normalized snapshot of all text in the document, with a
     mapping from every normalized character back to (textNode, offset). */
  function buildTextIndex() {
    const nodes = [], offs = [], parts = [];
    const rootEl = document.body || document.documentElement;
    if (!rootEl) return { text: '', nodes, offs, locate: () => null };

    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const t = p.tagName;
        if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'TEMPLATE' ||
            t === 'TEXTAREA' || t === 'INPUT' || t === 'SELECT' || t === 'IFRAME') {
          return NodeFilter.FILTER_REJECT;
        }
        if (!n.nodeValue || !n.nodeValue.length) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let prevChar = '';
    let node;
    while ((node = walker.nextNode())) {
      const val = node.nodeValue;
      for (let i = 0; i < val.length; i++) {
        const ch = val[i];
        if (/\s/.test(ch)) {
          if (parts.length === 0 || prevChar === ' ') continue; // collapse whitespace
          parts.push(' '); nodes.push(node); offs.push(i); prevChar = ' ';
        } else {
          parts.push(ch); nodes.push(node); offs.push(i); prevChar = ch;
        }
      }
    }

    return {
      text: parts.join(''),
      nodes, offs,
      locate(pos) {
        return (pos >= 0 && pos < nodes.length) ? { node: nodes[pos], offset: offs[pos] } : null;
      }
    };
  }

  /* Is index entry `node` located after the boundary point (container, offset)? */
  function entryAfterBoundary(node, container, offset) {
    if (container.nodeType === 3) {
      if (node === container) return false;
      const rel = container.compareDocumentPosition(node);
      return (rel & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }
    if (container.nodeType === 1 && container.contains(node)) {
      let cur = node;
      while (cur.parentNode && cur.parentNode !== container) cur = cur.parentNode;
      if (!cur.parentNode) return false;
      const ci = Array.prototype.indexOf.call(container.childNodes, cur);
      return ci >= offset;
    }
    const rel = container.compareDocumentPosition(node);
    return (rel & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)) !== 0;
  }

  /* Maps a DOM Range to [start, end) positions in the normalized text. */
  function rangeToNormBounds(idx, range) {
    const sc = range.startContainer, so = range.startOffset;
    const ec = range.endContainer, eo = range.endOffset;
    let start = -1, end = 0;
    const n = idx.nodes.length;

    for (let k = 0; k < n; k++) {
      const node = idx.nodes[k];
      if (start === -1) {
        if (node === sc) { if (idx.offs[k] >= so) start = k; }
        else if (entryAfterBoundary(node, sc, so)) start = k;
      }
      let afterEnd = false;
      if (node === ec) afterEnd = idx.offs[k] >= eo;
      else afterEnd = entryAfterBoundary(node, ec, eo);
      if (!afterEnd) end = k + 1;
      else if (start !== -1 && k > start) break;
    }
    if (start === -1) start = 0;
    if (end < start) end = start;
    return { start, end };
  }

  function allIndexOf(hay, needle) {
    const out = [];
    if (!needle) return out;
    let i = hay.indexOf(needle);
    while (i !== -1) { out.push(i); i = hay.indexOf(needle, i + 1); }
    return out;
  }

  /* How many occurrences of `needle` start before position `pos`. */
  function countBefore(hay, needle, pos) {
    if (!needle) return 0;
    let count = 0;
    let i = hay.indexOf(needle);
    while (i !== -1 && i < pos) { count++; i = hay.indexOf(needle, i + 1); }
    return count;
  }

  function getXPath(node) {
    if (!node) return '';
    if (node.nodeType === 3) {
      const parent = node.parentNode;
      if (!parent) return '';
      let i = 0, sib = parent.firstChild;
      while (sib) {
        if (sib.nodeType === 3) { if (sib === node) break; i++; }
        sib = sib.nextSibling;
      }
      return getXPath(parent) + '/text()[' + (i + 1) + ']';
    }
    if (node.nodeType !== 1) return '';
    if (node === document.documentElement) return '/html[1]';
    const parts = [];
    let el = node;
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      let idx = 1, sib = el.previousElementSibling;
      while (sib) { if (sib.tagName === el.tagName) idx++; sib = sib.previousElementSibling; }
      parts.unshift(el.tagName.toLowerCase() + '[' + idx + ']');
      el = el.parentNode;
    }
    if (el !== document.documentElement) return '';
    return '/html[1]' + parts.map((p) => '/' + p).join('');
  }

  function evalXPath(xp) {
    /* xp may originate from imported backup files — bound its size so a
       crafted expression can never become a performance weapon. */
    if (!xp || typeof xp !== 'string' || xp.length > 2000) return null;
    try {
      const res = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return res.singleNodeValue;
    } catch (e) { return null; }
  }

  function rangeToAnchor(range) {
    try {
      const idx = buildTextIndex();
      const { start, end } = rangeToNormBounds(idx, range);
      if (end <= start) return null;
      const text = idx.text.slice(start, end);
      if (!text.trim()) return null;
      const prefix = idx.text.slice(Math.max(0, start - CTX_LEN), start);
      const suffix = idx.text.slice(end, Math.min(idx.text.length, end + CTX_LEN));
      return {
        text, prefix, suffix,
        occFull: countBefore(idx.text, prefix + text + suffix, start - prefix.length),
        occText: countBefore(idx.text, text, start),
        xpath: {
          start: getXPath(range.startContainer), startOffset: range.startOffset,
          end: getXPath(range.endContainer), endOffset: range.endOffset
        }
      };
    } catch (e) { return null; }
  }

  function anchorToRange(rec, idx) {
    const tries = [
      [rec.prefix + rec.text + rec.suffix, rec.occurrenceFull, rec.prefix.length],
      [rec.prefix + rec.text, rec.occurrenceFull, rec.prefix.length],
      [rec.text + rec.suffix, rec.occurrenceText, 0],
      [rec.text, rec.occurrenceText, 0]
    ];
    for (let i = 0; i < tries.length; i++) {
      const pattern = tries[i][0], occ = tries[i][1], lead = tries[i][2];
      if (!pattern || occ == null || occ < 0) continue;
      const positions = allIndexOf(idx.text, pattern);
      if (occ < positions.length) {
        const p = positions[occ];
        const s = p + lead;
        const e = s + rec.text.length;
        const a = idx.locate(s);
        const b = idx.locate(e - 1);
        if (!a || !b) continue;
        try {
          const r = document.createRange();
          r.setStart(a.node, a.offset);
          r.setEnd(b.node, b.offset + 1);
          if (r.collapsed) continue;
          return r;
        } catch (err) { /* try next strategy */ }
      }
    }
    return null;
  }

  function xpathToRange(rec) {
    try {
      if (!rec.xpath || !rec.xpath.start || !rec.xpath.end) return null;
      const sc = evalXPath(rec.xpath.start);
      const ec = evalXPath(rec.xpath.end);
      if (!sc || !ec) return null;
      const so = Math.min(rec.xpath.startOffset, sc.nodeType === 3 ? sc.nodeValue.length : sc.childNodes.length);
      const eo = Math.min(rec.xpath.endOffset, ec.nodeType === 3 ? ec.nodeValue.length : ec.childNodes.length);
      const r = document.createRange();
      r.setStart(sc, so);
      r.setEnd(ec, eo);
      if (r.collapsed) return null;
      const t = normWs(r.toString());
      if (t && normWs(rec.text) && t !== normWs(rec.text)) return null; // sanity check
      return r;
    } catch (e) { return null; }
  }

  /* ======================================================================
   * 5. Wrapping / unwrapping marks in the DOM
   * ==================================================================== */

  /* Detects whether a mark sits on a light or dark page background so the
     correct color variant is used (works for dark-mode sites too). */
  function detectScheme(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.classList && node.classList.contains('pm-hl')) { node = node.parentElement; continue; }
      const bg = getComputedStyle(node).backgroundColor;
      const m = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\)/.exec(bg || '');
      if (m) {
        const a = (m[4] === undefined) ? 1 : parseFloat(m[4]);
        if (a > 0.2) {
          return luminance(+m[1], +m[2], +m[3]) < 0.35 ? 'dark' : 'light';
        }
      }
      node = node.parentElement;
    }
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  function wrapTextNode(target, rec) {
    const node = target.node;
    const parent = node.parentNode;
    if (!parent) return null;
    const s = target.s, e = target.e;
    const val = node.nodeValue;

    if (e < val.length) node.splitText(e);
    let middle = node;
    if (s > 0) { node.splitText(s); middle = node.nextSibling; }
    if (!middle || !middle.parentNode) return null;

    const mark = document.createElement('span');
    mark.className = 'pm-hl';
    mark.setAttribute('data-pm-id', rec.id);
    if (rec.note) mark.setAttribute('title', rec.note);

    parent.insertBefore(mark, middle);
    mark.appendChild(middle);
    /* style AFTER insertion so detectScheme can walk up the real parent chain */
    applyMarkStyle(mark, rec);
    return mark;
  }

  function wrapRange(range, rec) {
    const common = range.commonAncestorContainer;
    const rootEl = common.nodeType === 1 ? common : common.parentNode;
    if (!rootEl) return [];

    const targets = [];
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.length) continue;
      if (!range.intersectsNode(node)) continue;
      const val = node.nodeValue;
      let s = 0, e = val.length;
      if (node === range.startContainer) s = Math.max(s, Math.min(range.startOffset, val.length));
      if (node === range.endContainer) e = Math.min(e, Math.max(range.endOffset, 0));
      if (e > s) targets.push({ node, s, e });
    }

    const marks = [];
    for (const t of targets) {
      try {
        const m = wrapTextNode(t, rec);
        if (m) marks.push(m);
      } catch (err) { /* skip this node */ }
    }
    return marks;
  }

  function unwrapMarks(marks) {
    for (const m of marks) {
      if (!m || !m.parentNode) continue;
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      m.remove();
      try { parent.normalize(); } catch (e) { /* noop */ }
    }
  }

  function unwrapAllMarks() {
    unwrapMarks(Array.from(document.querySelectorAll('span.pm-hl[data-pm-id]')));
  }

  function marksInRange(range) {
    return Array.from(document.querySelectorAll('span.pm-hl[data-pm-id]'))
      .filter((m) => { try { return range.intersectsNode(m); } catch (e) { return false; } });
  }

  /* ======================================================================
   * 6. Highlight operations
   * ==================================================================== */

  function isEditableRange(range) {
    if (settings.allowEditable) return false;
    let n = range.commonAncestorContainer;
    if (n.nodeType === 3) n = n.parentNode;
    if (!n || n.nodeType !== 1) return false;
    if (n.closest('[contenteditable="true"], [contenteditable=""]')) return true;
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) && ae.contains(n)) return true;
    return false;
  }

  function currentSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const text = sel.toString();
    if (!text || !text.trim() || text.length > MAX_TEXT) return null;
    if (inShadow(range.startContainer) || inShadow(range.endContainer)) return null;
    if (isEditableRange(range)) return null;
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { sel, range, text, rect };
  }

  /* If the selection exactly matches an existing highlight, recolor it
     instead of creating a nested duplicate. */
  function tryRecolorIfExact(range, color) {
    const marks = marksInRange(range);
    if (!marks.length) return false;
    const ids = new Set(marks.map((m) => m.getAttribute('data-pm-id')));
    if (ids.size !== 1) return false;
    const id = marks[0].getAttribute('data-pm-id');
    if (normWs(range.toString()) !== normWs(marks.map((m) => m.textContent).join(''))) return false;
    recolor(id, color);
    return true;
  }

  function saveHighlightRange(range, color) {
    if (!armed) return null;
    const raw = range.toString();
    if (!raw || !raw.trim() || raw.length > MAX_TEXT) return null;

    if (tryRecolorIfExact(range, color)) return { recolored: true };

    const anchor = rangeToAnchor(range);
    if (!anchor) return null;

    const rec = {
      id: uid(),
      url: location.href,
      urlKey: urlKey,
      title: document.title || '',
      frame: IS_TOP ? 'top' : 'sub',
      color: color,
      intensity: (typeof settings.intensity === 'number' && !isNaN(settings.intensity))
        ? clampIntensity(settings.intensity, 'light') : null,
      note: '',
      text: anchor.text,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      occurrenceFull: anchor.occFull,
      occurrenceText: anchor.occText,
      xpath: anchor.xpath,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    records.push(rec);
    const marks = wrapRange(range, rec);
    if (!marks.length) {
      records = records.filter((r) => r.id !== rec.id);
      return null;
    }
    applied.set(rec.id, marks);
    persistRecords();
    sendCount();
    return { rec, marks };
  }

  function highlightSelection(color) {
    const info = currentSelectionInfo();
    if (!info) return null;
    return saveHighlightRange(info.range, color || settings.activeColor || HL_DEFAULT_COLOR);
  }

  function recolor(id, color, intensity, skipPersist) {
    const rec = records.find((r) => r.id === id);
    if (!rec) return;
    if (color != null && isValidColor(color)) rec.color = color;
    if (typeof intensity === 'number' && !isNaN(intensity)) rec.intensity = clampIntensity(intensity, 'light');
    rec.updatedAt = Date.now();
    for (const m of marksFor(id)) applyMarkStyle(m, rec);
    if (!skipPersist) persistRecords();
  }

  function removeHighlight(id, skipUndo) {
    const rec = records.find((r) => r.id === id);
    unwrapMarks(marksFor(id));
    applied.delete(id);
    records = records.filter((r) => r.id !== id);
    persistRecords();
    sendCount();
    if (rec && !skipUndo) queueUndo([rec]);
  }

  function removeInSelection() {
    const info = currentSelectionInfo();
    if (!info) return false;
    const ids = new Set(marksInRange(info.range).map((m) => m.getAttribute('data-pm-id')));
    if (!ids.size) return false;
    const removed = [];
    ids.forEach((id) => {
      const rec = records.find((r) => r.id === id);
      if (rec) removed.push(rec);
      removeHighlight(id, true);
    });
    try { info.sel.removeAllRanges(); } catch (e) { /* noop */ }
    if (removed.length) queueUndo(removed);
    return true;
  }

  function clearPage() {
    unwrapAllMarks();
    applied.clear();
    records = [];
    pendingRecords = [];
    persistRecords();
    sendCount();
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.documentElement.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) { return false; }
    }
  }

  /* ======================================================================
   * 7. Applying saved highlights
   * ==================================================================== */

  function applyRecord(rec, idx) {
    try {
      const existing = marksFor(rec.id);
      if (existing.length) {
        applied.set(rec.id, existing);
        return true;
      }
      let range = anchorToRange(rec, idx);
      if (!range) range = xpathToRange(rec);
      if (!range) return false;
      const marks = wrapRange(range, rec);
      if (!marks.length) return false;
      applied.set(rec.id, marks);
      return true;
    } catch (e) { return false; }
  }

  function applyPage() {
    if (!armed) return;
    pendingRecords = [];
    const mine = recordsForThisFrame()
      .filter((rec) => !applied.has(rec.id) && !marksFor(rec.id).length);
    retries = 0;
    /* Wrapping a record splits text nodes, which invalidates the node
       mappings of an already-built index. So every record gets a FRESH
       index, and we yield between records to avoid blocking the page. */
    applyQueue(mine.slice());
  }

  function applyQueue(queue) {
    if (!armed) return;
    if (!queue.length) { sendCount(); return; }
    const rec = queue.shift();
    if (!applyRecord(rec, buildTextIndex())) {
      if (pendingRecords.indexOf(rec) === -1) pendingRecords.push(rec);
    }
    sendCount();
    if (queue.length) setTimeout(() => applyQueue(queue), 0);
  }

  function applyPending() {
    if (!armed || !pendingRecords.length) return;
    if (retries >= MAX_RETRIES || Date.now() - pageBootAt > 300000) {
      pendingRecords = [];
      return;
    }
    retries++;
    const still = [];
    for (const rec of pendingRecords) {
      if (marksFor(rec.id).length) continue; // appeared meanwhile
      if (!applyRecord(rec, buildTextIndex())) still.push(rec);
    }
    pendingRecords = still;
  }

  /* Re-sync DOM with stored records (after storage changes, imports,
     sync from another device, etc.). */
  async function reconcile() {
    if (!armed) return;
    await loadRecords();
    const mine = recordsForThisFrame();
    const valid = new Map(mine.map((r) => [r.id, r]));

    for (const id of Array.from(applied.keys())) {
      if (!valid.has(id)) {
        unwrapMarks(marksFor(id));
        applied.delete(id);
      }
    }

    for (const rec of mine) {
      const marks = (applied.get(rec.id) || []).filter((m) => m.isConnected);
      if (marks.length) {
        for (const m of marks) {
          applyMarkStyle(m, rec);
          const wantTitle = rec.note || null;
          const hasTitle = m.getAttribute('title');
          if (wantTitle !== hasTitle) {
            if (wantTitle) m.setAttribute('title', wantTitle);
            else m.removeAttribute('title');
          }
        }
        continue;
      }
      if (!applyRecord(rec, buildTextIndex()) && pendingRecords.indexOf(rec) === -1) {
        pendingRecords.push(rec);
      }
    }
    pendingRecords = pendingRecords.filter((r, i, a) => a.indexOf(r) === i);
    sendCount();
  }

  const debouncedReconcile = debounce(reconcile, 300);
  const debouncedApplyPending = debounce(applyPending, 500);

  /* ======================================================================
   * 8. Floating UI (toolbar + popover), rendered in closed shadow roots
   * ==================================================================== */

  const SVG_PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const SVG_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const SVG_SLIDERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>';
  const SVG_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

  const TOOLBAR_CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .tb {
      display: flex; align-items: center; gap: 3px;
      background: #232941; border: 1px solid rgba(255,255,255,.09);
      border-radius: 10px; padding: 4px 5px;
      box-shadow: 0 8px 24px rgba(8, 10, 30, .5);
      user-select: none; -webkit-user-select: none; white-space: nowrap;
    }
    .hlbtn {
      display: flex; align-items: center; justify-content: center; gap: 4px;
      height: 24px; padding: 0 10px; border: 0; border-radius: 7px;
      background: #ffd94d; /* replaced live with the active color */
      color: #1d2333; font-size: 11px; font-weight: 700; cursor: pointer;
      transition: filter .12s ease;
    }
    .hlbtn:hover { filter: brightness(1.1); }
    .hlbtn svg { width: 12px; height: 12px; }
    .sep { width: 1px; height: 16px; background: rgba(255,255,255,.16); margin: 0 2px; }
    .sw {
      width: 17px; height: 17px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,.28); cursor: pointer; padding: 0;
      transition: transform .1s ease, border-color .1s ease;
    }
    .sw:hover { transform: scale(1.25); border-color: #fff; }
    .sw.active { border-color: #fff; box-shadow: 0 0 0 2px rgba(124,92,255,.85); }
    .ib {
      display: flex; align-items: center; justify-content: center;
      width: 25px; height: 25px; border: 0; border-radius: 7px;
      background: transparent; color: #c7cde4; cursor: pointer;
      transition: background .12s ease, color .12s ease;
    }
    .ib:hover { background: rgba(255,255,255,.14); color: #fff; }
    .ib.on { background: linear-gradient(135deg, #7c5cff, #5a8bff); color: #fff; }
    .ib.danger:hover { background: rgba(255,90,90,.25); color: #ff9d9d; }
    .ib svg { width: 13px; height: 13px; }
    .hlbtn.auto { box-shadow: 0 0 0 2px rgba(124,92,255,.9); }
    .wrap { position: relative; }
    .cpanel {
      position: absolute; top: calc(100% + 8px); left: 0;
      width: 196px; background: #232941; border: 1px solid rgba(255,255,255,.09);
      border-radius: 12px; padding: 11px; color: #e8eaf4;
      box-shadow: 0 12px 34px rgba(8, 10, 30, .55);
      user-select: none; -webkit-user-select: none; display: none;
    }
    .cpanel.open { display: block; }
    .crow { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
    input.cin {
      width: 42px; height: 30px; border: 1px solid rgba(255,255,255,.18);
      border-radius: 8px; background: rgba(255,255,255,.07); padding: 2px; cursor: pointer;
    }
    .cprev {
      flex: 1; height: 30px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,.14);
    }
    .clab { font-size: 11px; color: #aab2cf; display: block; margin-bottom: 5px; }
    input.crange { width: 100%; accent-color: #7c5cff; cursor: pointer; margin-bottom: 10px; }
    .capply {
      width: 100%; height: 28px; border: 0; border-radius: 8px; cursor: pointer;
      background: linear-gradient(135deg, #7c5cff, #5a8bff); color: #fff;
      font-size: 11.5px; font-weight: 700;
    }
    .capply:hover { filter: brightness(1.1); }
  `;

  const POPOVER_CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .pop {
      width: 228px; background: #232941; border: 1px solid rgba(255,255,255,.09);
      border-radius: 14px; padding: 10px; color: #e8eaf4;
      box-shadow: 0 12px 34px rgba(8, 10, 30, .55);
      user-select: none; -webkit-user-select: none;
    }
    .head { display: flex; align-items: center; gap: 7px; margin-bottom: 9px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
    .txt { font-size: 11.5px; color: #aab2cf; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .swrow { display: flex; gap: 5px; margin-bottom: 9px; }
    .sw {
      width: 20px; height: 20px; border-radius: 50%; flex: 0 0 auto;
      border: 2px solid rgba(255,255,255,.28); cursor: pointer; padding: 0;
      transition: transform .12s ease, border-color .12s ease;
    }
    .sw:hover { transform: scale(1.2); border-color: #fff; }
    .sw.active { border-color: #fff; box-shadow: 0 0 0 2px rgba(124,92,255,.85); }
    textarea.note {
      width: 100%; height: 46px; resize: none; border-radius: 8px;
      border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.07);
      color: #e8eaf4; font-size: 12px; padding: 6px 8px; outline: none;
      user-select: text; -webkit-user-select: text;
    }
    textarea.note:focus { border-color: #7c5cff; }
    textarea.note::placeholder { color: #7d86a8; }
    .irow { margin-bottom: 9px; }
    .ilab { display: flex; justify-content: space-between; font-size: 11px; color: #aab2cf; margin-bottom: 4px; }
    .ilab b { color: #e8eaf4; font-weight: 600; }
    input.irange { width: 100%; accent-color: #7c5cff; cursor: pointer; }
    .acts { display: flex; gap: 6px; margin-top: 9px; }
    .acts button {
      flex: 1; height: 27px; border: 0; border-radius: 8px; cursor: pointer;
      font-size: 11.5px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 5px;
      background: rgba(255,255,255,.1); color: #dfe3f2;
      transition: background .12s ease;
    }
    .acts button:hover { background: rgba(255,255,255,.2); }
    .acts button.danger { background: rgba(255,90,90,.18); color: #ff9d9d; }
    .acts button.danger:hover { background: rgba(255,90,90,.32); }
    .acts svg { width: 12px; height: 12px; }
  `;

  const TOAST_CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .utoast {
      margin: 0 auto 22px; width: max-content; pointer-events: auto;
      display: flex; align-items: center; gap: 12px;
      background: #232941; color: #e8eaf4; border: 1px solid rgba(255,255,255,.09);
      border-radius: 11px; padding: 8px 8px 8px 15px; font-size: 12.5px;
      box-shadow: 0 10px 30px rgba(8, 10, 30, .55); white-space: nowrap;
    }
    .utoast button {
      border: 0; border-radius: 8px; padding: 6px 14px; cursor: pointer;
      background: linear-gradient(135deg, #7c5cff, #5a8bff); color: #fff;
      font-weight: 700; font-size: 12px;
    }
    .utoast button:hover { filter: brightness(1.12); }
  `;

  function makeHost() {
    const host = document.createElement('div');
    host.className = 'pm-host';
    host.style.cssText = 'position:fixed;left:0;top:0;display:none;';
    const shadow = host.attachShadow({ mode: 'closed' });
    (document.documentElement || document.body).appendChild(host);
    return { host, shadow };
  }

  function placeByRect(ui, anchorRect, preferAbove) {
    const host = ui.host, el = ui.root;
    host.style.display = 'block';
    host.style.visibility = 'hidden';
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 40;
    let x = anchorRect.left + anchorRect.width / 2 - w / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    let y;
    if (preferAbove && anchorRect.top - h - 10 >= 0) {
      y = anchorRect.top - h - 10;
    } else {
      y = Math.min(anchorRect.bottom + 10, window.innerHeight - h - 8);
      y = Math.max(8, y);
    }
    host.style.left = Math.round(x) + 'px';
    host.style.top = Math.round(y) + 'px';
    host.style.visibility = 'visible';
  }

  function buildUi() {
    if (uiBuilt) return;
    uiBuilt = true;

    /* ---- toolbar ---- */
    TB = makeHost();
    TB.shadow.innerHTML = '<style>' + TOOLBAR_CSS + '</style><div class="wrap"><div class="tb" role="toolbar" aria-label="PersistMark"></div><div class="cpanel"></div></div>';
    TB.root = TB.shadow.querySelector('.tb');
    TB.wrap = TB.shadow.querySelector('.wrap');
    TB.panel = TB.shadow.querySelector('.cpanel');

    /* colors on the left — one click highlights AND remembers the color */
    TB.swatches = [];
    for (const c of HL_PALETTE) {
      const b = document.createElement('button');
      b.className = 'sw';
      b.title = c.name + ' \u2014 highlight & set as default';
      b.style.background = c.swatch;
      b.setAttribute('data-color', c.id);
      b.addEventListener('click', () => {
        setActiveColor(c.id);
        const info = currentSelectionInfo();
        if (info) saveHighlightRange(info.range, c.id);
        dismissSelection();
      });
      TB.root.appendChild(b);
      TB.swatches.push(b);
    }

    const sep0 = document.createElement('span');
    sep0.className = 'sep';
    TB.root.appendChild(sep0);

    /* Highlight button on the right — always uses the last-used color,
       and its background shows that color */
    TB.hlBtn = document.createElement('button');
    TB.hlBtn.className = 'hlbtn';
    TB.hlBtn.title = 'Highlight with your current color';
    TB.hlBtn.innerHTML = SVG_PEN + '<span>Highlight</span>';
    TB.hlBtn.addEventListener('click', () => {
      const info = currentSelectionInfo();
      if (info) saveHighlightRange(info.range, settings.activeColor || HL_DEFAULT_COLOR);
      dismissSelection();
    });
    TB.root.appendChild(TB.hlBtn);

    /* custom color & intensity button */
    TB.customBtn = document.createElement('button');
    TB.customBtn.className = 'ib';
    TB.customBtn.title = 'Custom color & intensity';
    TB.customBtn.innerHTML = SVG_SLIDERS;
    TB.customBtn.addEventListener('click', () => toggleCustomPanel());
    TB.root.appendChild(TB.customBtn);

    const sep1 = document.createElement('span');
    sep1.className = 'sep';
    TB.root.appendChild(sep1);

    TB.copyBtn = document.createElement('button');
    TB.copyBtn.className = 'ib';
    TB.copyBtn.title = 'Copy selected text';
    TB.copyBtn.innerHTML = SVG_COPY;
    TB.copyBtn.addEventListener('click', async () => {
      const info = currentSelectionInfo();
      if (info) {
        const ok = await copyText(info.text);
        TB.copyBtn.title = ok ? 'Copied!' : 'Copy failed';
        setTimeout(() => { TB.copyBtn.title = 'Copy selected text'; }, 900);
      }
      hideToolbar();
    });
    TB.root.appendChild(TB.copyBtn);

    TB.removeBtn = document.createElement('button');
    TB.removeBtn.className = 'ib danger';
    TB.removeBtn.title = 'Remove highlights inside the selection';
    TB.removeBtn.innerHTML = SVG_TRASH;
    TB.removeBtn.addEventListener('click', () => {
      removeInSelection();
      hideToolbar();
    });
    TB.root.appendChild(TB.removeBtn);

    /* ---- custom color & intensity panel (attached to the toolbar wrap) ---- */
    const crow = document.createElement('div');
    crow.className = 'crow';
    TB.colorInput = document.createElement('input');
    TB.colorInput.type = 'color';
    TB.colorInput.className = 'cin';
    TB.colorInput.value = '#ffd94d';
    TB.preview = document.createElement('div');
    TB.preview.className = 'cprev';
    crow.appendChild(TB.colorInput);
    crow.appendChild(TB.preview);
    TB.panel.appendChild(crow);

    const clab = document.createElement('span');
    clab.className = 'clab';
    clab.textContent = 'Intensity (light \u2192 strong)';
    TB.panel.appendChild(clab);

    TB.range = document.createElement('input');
    TB.range.type = 'range';
    TB.range.className = 'crange';
    TB.range.min = '0.15';
    TB.range.max = '0.85';
    TB.range.step = '0.05';
    TB.range.value = '0.55';
    TB.panel.appendChild(TB.range);

    TB.applyBtn = document.createElement('button');
    TB.applyBtn.className = 'capply';
    TB.applyBtn.textContent = 'Apply to selection';
    TB.applyBtn.addEventListener('click', () => {
      const hex = normalizeHex(TB.colorInput.value);
      settings.intensity = clampIntensity(parseFloat(TB.range.value), 'light');
      if (hex) setActiveColor(hex);
      const info = currentSelectionInfo();
      if (info && hex) saveHighlightRange(info.range, hex);
      closeCustomPanel();
      dismissSelection();
    });
    TB.panel.appendChild(TB.applyBtn);

    const syncPreview = () => syncPreviewHex(TB.preview, TB.colorInput.value, parseFloat(TB.range.value));
    syncPreview();
    TB.colorInput.addEventListener('input', syncPreview);
    TB.range.addEventListener('input', syncPreview);
    /* keep the page selection alive, but let the color/range inputs work */
    TB.panel.addEventListener('mousedown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      e.preventDefault();
    }, true);

    /* ---- popover ---- */
    POP = makeHost();
    POP.shadow.innerHTML = '<style>' + POPOVER_CSS + '</style><div class="pop"></div>';
    POP.root = POP.shadow.querySelector('.pop');

    POP.head = document.createElement('div');
    POP.head.className = 'head';
    POP.dot = document.createElement('span');
    POP.dot.className = 'dot';
    POP.txt = document.createElement('span');
    POP.txt.className = 'txt';
    POP.head.appendChild(POP.dot);
    POP.head.appendChild(POP.txt);
    POP.root.appendChild(POP.head);

    POP.swrow = document.createElement('div');
    POP.swrow.className = 'swrow';
    POP.swatches = [];
    for (const c of HL_PALETTE) {
      const b = document.createElement('button');
      b.className = 'sw';
      b.title = c.name;
      b.style.background = c.swatch;
      b.setAttribute('data-color', c.id);
      b.addEventListener('click', () => {
        if (currentPopId) recolor(currentPopId, c.id);
        reflectPopoverColor(c.id);
      });
      POP.swrow.appendChild(b);
      POP.swatches.push(b);
    }
    POP.root.appendChild(POP.swrow);

    /* per-highlight intensity */
    POP.irow = document.createElement('div');
    POP.irow.className = 'irow';
    POP.ilab = document.createElement('div');
    POP.ilab.className = 'ilab';
    const ilabL = document.createElement('span');
    ilabL.textContent = 'Intensity';
    POP.ival = document.createElement('b');
    POP.ival.textContent = '55%';
    POP.ilab.appendChild(ilabL);
    POP.ilab.appendChild(POP.ival);
    POP.irange = document.createElement('input');
    POP.irange.type = 'range';
    POP.irange.className = 'irange';
    POP.irange.min = '0.15';
    POP.irange.max = '0.85';
    POP.irange.step = '0.05';
    POP.irange.addEventListener('input', () => {
      if (!currentPopId) return;
      const v = parseFloat(POP.irange.value);
      POP.ival.textContent = Math.round(v * 100) + '%';
      recolor(currentPopId, null, v, true); /* live update, no persist yet */
    });
    POP.irange.addEventListener('change', () => {
      if (!currentPopId) return;
      recolor(currentPopId, null, parseFloat(POP.irange.value)); /* persist */
    });
    POP.irow.appendChild(POP.ilab);
    POP.irow.appendChild(POP.irange);
    POP.root.appendChild(POP.irow);

    POP.note = document.createElement('textarea');
    POP.note.className = 'note';
    POP.note.placeholder = 'Add a note… (saved automatically)';
    POP.note.addEventListener('input', debounce(saveCurrentNote, 450));
    POP.note.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { closePopover(); }
    });
    POP.root.appendChild(POP.note);

    const acts = document.createElement('div');
    acts.className = 'acts';
    const copyB = document.createElement('button');
    copyB.innerHTML = SVG_COPY + '<span>Copy</span>';
    copyB.addEventListener('click', () => {
      const rec = records.find((r) => r.id === currentPopId);
      if (rec) copyText(rec.text);
    });
    const delB = document.createElement('button');
    delB.className = 'danger';
    delB.innerHTML = SVG_TRASH + '<span>Delete</span>';
    delB.addEventListener('click', () => {
      if (currentPopId) removeHighlight(currentPopId);
      closePopover();
    });
    acts.appendChild(copyB);
    acts.appendChild(delB);
    POP.root.appendChild(acts);

    /* ---- undo toast (bottom of the page, after a removal) ---- */
    TOAST = makeHost();
    TOAST.host.style.cssText = 'position:fixed;left:0;right:0;bottom:0;display:none;pointer-events:none;';
    TOAST.shadow.innerHTML = '<style>' + TOAST_CSS + '</style><div class="utoast"><span class="txt"></span><button type="button">Undo</button></div>';
    TOAST.root = TOAST.shadow.querySelector('.utoast');
    TOAST.txt = TOAST.shadow.querySelector('.txt');
    TOAST.btn = TOAST.shadow.querySelector('button');
    TOAST.recs = null;
    TOAST.btn.addEventListener('click', undoLastRemoval);
    TOAST.root.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
    TOAST.root.addEventListener('click', (e) => e.stopPropagation(), true);

    /* Keep the page selection alive while interacting with our UI
       (but never block the note textarea). preventDefault on mousedown
       must run in the CAPTURE phase, before the browser clears the
       selection. NOTE: we must NOT stopPropagation for click/keydown
       in the capture phase on the root — that would swallow every
       event before it reaches our own buttons. Isolation from page
       scripts happens in the BUBBLE phase on the host instead. */
    for (const ui of [TB, POP, TOAST]) {
      ui.root.addEventListener('mousedown', (e) => {
        const t = e.target;
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
        e.preventDefault();
      }, true);
      ui.host.addEventListener('mousedown', (e) => e.stopPropagation(), false);
      ui.host.addEventListener('click', (e) => e.stopPropagation(), false);
      ui.host.addEventListener('keydown', (e) => e.stopPropagation(), false);
      ui.host.addEventListener('keyup', (e) => e.stopPropagation(), false);
    }
  }

  function dismissSelection() {
    try { window.getSelection().removeAllRanges(); } catch (e) { /* noop */ }
    hideToolbar();
  }

  function hideToolbar() {
    if (!TB) return;
    closeCustomPanel();
    TB.host.style.display = 'none';
  }

  function toggleCustomPanel() {
    if (!TB || !TB.panel) return;
    const open = TB.panel.classList.toggle('open');
    if (open) {
      /* initialize from the current active color & intensity */
      const active = settings.activeColor || HL_DEFAULT_COLOR;
      const pal = hlColor(active);
      TB.colorInput.value = pal ? pal.swatch : (normalizeHex(active) || '#ffd94d');
      TB.range.value = String(clampIntensity(
        (typeof settings.intensity === 'number' && !isNaN(settings.intensity)) ? settings.intensity : 0.55, 'light'));
      syncPreviewHex(TB.preview, TB.colorInput.value, parseFloat(TB.range.value));
    }
  }

  function closeCustomPanel() {
    if (TB && TB.panel) TB.panel.classList.remove('open');
  }

  function showToolbar(info) {
    if (!TB) return;
    updateAutoChip();
    const hasMarks = marksInRange(info.range).length > 0;
    TB.removeBtn.style.display = hasMarks ? '' : 'none';
    placeByRect(TB, info.rect, true);
  }

  function updateAutoChip() {
    if (!TB) return;
    const activeId = settings.activeColor || HL_DEFAULT_COLOR;
    for (const s of TB.swatches) s.classList.toggle('active', s.getAttribute('data-color') === activeId);
    /* the big button always shows the color it will use */
    if (TB.hlBtn) {
      const base = colorBase(activeId) || colorBase(HL_DEFAULT_COLOR);
      const hex = baseToHex(base);
      TB.hlBtn.style.background = hex;
      TB.hlBtn.style.color = contrastTextFor(hex);
      const pal = hlColor(activeId);
      TB.hlBtn.title = 'Highlight in ' + (pal ? pal.name : 'your custom color') + ' (last-used)';
      TB.hlBtn.classList.toggle('auto', !!settings.autoHighlight);
    }
  }

  /* Remember the last color used; the Highlight button and auto mode use it. */
  function setActiveColor(colorId) {
    if (!isValidColor(colorId)) return;
    settings.activeColor = colorId;
    saveSettings();
    updateAutoChip();
  }

  /* ---- color math: palette ids OR arbitrary #rrggbb, plus intensity ---- */

  function isValidColor(v) {
    if (hlColor(v)) return true;
    return /^#[0-9a-f]{6}$/i.test(String(v || '').trim());
  }

  function normalizeHex(v) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim());
    return m ? '#' + m[1].toLowerCase() : null;
  }

  /* sets a preview box from '#rrggbb' + alpha */
  function syncPreviewHex(el, hex, alpha) {
    if (!el) return;
    const h = normalizeHex(hex) || '#ffd94d';
    const a = clampIntensity(alpha, 'light');
    el.style.background = 'rgba(' + parseInt(h.slice(1, 3), 16) + ', ' + parseInt(h.slice(3, 5), 16) + ', ' + parseInt(h.slice(5, 7), 16) + ', ' + a + ')';
  }

  function colorBase(colorValue) {
    const pal = hlColor(colorValue);
    const hex = pal ? pal.swatch : String(colorValue || '');
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const v = m[1];
    return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
  }

  function baseToHex(base) {
    return '#' + [base.r, base.g, base.b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
  }

  function clampIntensity(v, scheme) {
    if (typeof v !== 'number' || isNaN(v)) return scheme === 'dark' ? 0.32 : 0.55;
    return Math.max(0.08, Math.min(0.92, v));
  }

  /* Final background color for a mark: base color x scheme x intensity. */
  function computeMarkBg(colorValue, scheme, intensity) {
    const base = colorBase(colorValue) || colorBase(HL_DEFAULT_COLOR);
    let r = base.r, g = base.g, b = base.b;
    let a = clampIntensity(intensity, scheme);
    if (scheme === 'dark') {
      r = Math.round(r + (255 - r) * 0.18);
      g = Math.round(g + (255 - g) * 0.18);
      b = Math.round(b + (255 - b) * 0.18);
      a = a * 0.9;
    }
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (Math.round(a * 100) / 100) + ')';
  }

  /* Style a mark element from its record (inline style wins over site CSS). */
  function applyMarkStyle(mark, rec) {
    const parent = mark.parentElement || mark.parentNode;
    const scheme = parent ? detectScheme(parent) : 'light';
    mark.setAttribute('data-pm-color', rec.color || HL_DEFAULT_COLOR);
    mark.setAttribute('data-pm-scheme', scheme);
    mark.style.setProperty('background-color', computeMarkBg(rec.color, scheme, rec.intensity), 'important');
  }

  function contrastTextFor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#1d2333';
    const v = m[1];
    const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
    return luminance(r, g, b) > 0.5 ? '#1d2333' : '#ffffff';
  }

  function toggleAuto() {
    settings.autoHighlight = !settings.autoHighlight;
    saveSettings();
    updateAutoChip();
  }

  function reflectPopoverColor(colorId) {
    if (!POP) return;
    const base = colorBase(colorId) || colorBase(HL_DEFAULT_COLOR);
    POP.dot.style.background = baseToHex(base);
    for (const s of POP.swatches) s.classList.toggle('active', s.getAttribute('data-color') === colorId);
  }

  function openPopoverForMark(mark) {
    const id = mark.getAttribute('data-pm-id');
    const rec = records.find((r) => r.id === id);
    if (!rec) return;
    currentPopId = id;
    hideToolbar();
    POP.txt.textContent = rec.text.length > 70 ? rec.text.slice(0, 70) + '…' : rec.text;
    POP.note.value = rec.note || '';
    const inten = clampIntensity(rec.intensity, 'light');
    POP.irange.value = String(inten);
    POP.ival.textContent = Math.round(inten * 100) + '%';
    reflectPopoverColor(rec.color);
    const rect = mark.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    placeByRect(POP, rect, true);
  }

  function closePopover() {
    if (POP) POP.host.style.display = 'none';
    currentPopId = null;
  }

  function saveCurrentNote() {
    if (!currentPopId) return;
    const rec = records.find((r) => r.id === currentPopId);
    if (!rec) return;
    rec.note = (POP.note.value || '').slice(0, 1000);
    rec.updatedAt = Date.now();
    for (const m of marksFor(rec.id)) {
      if (rec.note) m.setAttribute('title', rec.note);
      else m.removeAttribute('title');
    }
    persistRecords();
  }

  /* ---------- undo toast ---------- */

  let undoTimer = null;

  function queueUndo(recs) {
    if (!IS_TOP || !TOAST || !recs.length) return;
    TOAST.recs = recs;
    TOAST.txt.textContent = recs.length === 1 ? 'Highlight removed' : recs.length + ' highlights removed';
    TOAST.host.style.display = 'block';
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
      TOAST.host.style.display = 'none';
      TOAST.recs = null;
      undoTimer = null;
    }, 6000);
  }

  function undoLastRemoval() {
    const recs = (TOAST && TOAST.recs) || [];
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
    if (TOAST) { TOAST.host.style.display = 'none'; TOAST.recs = null; }
    if (!recs.length) return;
    for (const rec of recs) {
      if (!records.some((r) => r.id === rec.id)) records.push(rec);
    }
    for (const rec of recs) applyRecord(rec, buildTextIndex());
    persistRecords();
    sendCount();
  }

  /* ======================================================================
   * 9. Events & watchers
   * ==================================================================== */

  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;

    document.addEventListener('pointerup', (e) => {
      if (!armed) return;
      if (!settings.toolbarEnabled && !settings.autoHighlight) return;
      if (e.target && e.target.closest && e.target.closest('.pm-host')) return;
      setTimeout(() => {
        const info = currentSelectionInfo();
        if (!info) { hideToolbar(); return; }
        if (settings.autoHighlight) {
          saveHighlightRange(info.range, settings.activeColor || HL_DEFAULT_COLOR);
        }
        if (settings.toolbarEnabled) showToolbar(info);
        else hideToolbar();
      }, 10);
    });

    document.addEventListener('keyup', (e) => {
      if (!armed || !settings.toolbarEnabled) return;
      if (e.shiftKey || e.key === 'Shift') {
        setTimeout(() => {
          const info = currentSelectionInfo();
          if (info) showToolbar(info);
        }, 10);
      }
    });

    document.addEventListener('selectionchange', debounce(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString() || !sel.toString().trim()) hideToolbar();
    }, 200));

    window.addEventListener('scroll', () => { hideToolbar(); closePopover(); }, { passive: true, capture: true });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { hideToolbar(); closePopover(); }
    }, true);

    /* Click on a highlight -> popover (recolor / note / copy / delete) */
    document.addEventListener('click', (e) => {
      if (!armed) return;
      let inOurUi = false;
      if (e.target && e.target.closest && e.target.closest('.pm-host')) inOurUi = true;
      if (inOurUi) return;
      const mark = e.target && e.target.closest ? e.target.closest('span.pm-hl[data-pm-id]') : null;
      if (mark) {
        e.preventDefault();
        e.stopPropagation();
        openPopoverForMark(mark);
      }
    }, true);

    /* Click outside our UI closes the popover */
    document.addEventListener('mousedown', (e) => {
      if (e.target && e.target.closest && e.target.closest('.pm-host')) return;
      closePopover();
    }, true);
  }

  function startWatchers() {
    if (watchersStarted) return;
    watchersStarted = true;

    /* SPA navigation (pushState / replaceState) */
    setInterval(() => {
      if (!armed) return;
      if (location.href !== lastHref) {
        lastHref = location.href;
        onUrlChanged();
      }
    }, 800);

    /* Dynamic content: retry pending highlights when the DOM changes */
    const mo = new MutationObserver(() => {
      if (armed && pendingRecords.length) debouncedApplyPending();
    });
    if (document.documentElement) {
      mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && armed && pendingRecords.length) applyPending();
    });

    window.addEventListener('pageshow', (e) => {
      if (e.persisted && armed) applyPending();
    });

    /* Live sync with popup / options / other devices */
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['pm:settings']) {
        const prevSync = settings.syncEnabled;
        settings = Object.assign({}, HL_DEFAULT_SETTINGS, changes['pm:settings'].newValue || {});
        onSettingsChanged(prevSync);
      }
      if (changes['pm:page:' + urlKey]) debouncedReconcile();
    });
  }

  function onSettingsChanged(prevSync) {
    if (!canArm()) {
      if (armed) {
        armed = false;
        hideToolbar();
        closePopover();
        unwrapAllMarks();
        applied.clear();
        records = [];
        pendingRecords = [];
      }
      return;
    }
    if (!armed) {
      boot();
      return;
    }
    /* still armed – just refresh live state */
    hideToolbar();
    closePopover();
    updateAutoChip();
    if (prevSync !== settings.syncEnabled) {
      loadRecords().then(() => reconcile());
    }
  }

  async function onUrlChanged() {
    hideToolbar();
    closePopover();
    unwrapAllMarks();
    applied.clear();
    pendingRecords = [];
    retries = 0;
    pageBootAt = Date.now();
    records = [];
    urlKey = computeUrlKey();
    await loadRecords();
    applyPage();
  }

  /* ======================================================================
   * 10. Messaging (popup / background)
   * ==================================================================== */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    try {
      switch (msg.type) {
        case 'PM_HIGHLIGHT':
          highlightSelection(msg.color);
          break;
        case 'PM_REMOVE':
          if (msg.id) removeHighlight(msg.id);
          break;
        case 'PM_REMOVE_IN_SELECTION':
          removeInSelection();
          break;
        case 'PM_CLEAR_PAGE':
          clearPage();
          break;
        case 'PM_TOGGLE_AUTO':
          toggleAuto();
          break;
        case 'PM_JUMP':
          /* Respond only when this frame actually handled the jump, so the
             frame that owns the highlight always wins the response race. */
          if (handleJump(msg.id)) sendResponse({ ok: true });
          break;
      }
    } catch (e) { /* noop */ }
    return false; // synchronous / fire-and-forget
  });

  function handleJump(id) {
    let marks = marksFor(id);
    if (!marks.length) {
      const rec = records.find((r) => r.id === id);
      if (rec) {
        applyRecord(rec, buildTextIndex());
        marks = marksFor(id);
      }
    }
    if (marks.length) {
      try { marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* noop */ }
      for (const m of marks) {
        m.classList.remove('pm-flash');
        void m.offsetWidth;
        m.classList.add('pm-flash');
      }
      setTimeout(() => marks.forEach((m) => m.classList.remove('pm-flash')), 2300);
      return true;
    }
    return false;
  }

  /* ======================================================================
   * 11. Boot
   * ==================================================================== */

  async function boot() {
    await loadSettings();
    if (!canArm()) return;
    armed = true;
    pageBootAt = Date.now();
    urlKey = computeUrlKey();
    lastHref = location.href;
    buildUi();
    attachListeners();
    startWatchers();
    await loadRecords();
    applyPage();
  }

  boot();
})();
