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

  const $ = (s) => document.querySelector(s);

  const SVG_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const SVG_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

  let tab = null;
  let urlKey = null;
  let restricted = false;
  let records = [];
  let settings = Object.assign({}, HL_DEFAULT_SETTINGS);

  /* ------------------------------------------------------------------ */

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = (tab && tab.url) || '';

    try {
      settings = Object.assign({}, HL_DEFAULT_SETTINGS, (await chrome.storage.local.get('pm:settings'))['pm:settings'] || {});
    } catch (e) { /* defaults */ }

    if (/^(chrome|edge|about|chrome-extension|devtools|view-source|https:\/\/chrome\.google\.com\/webstore)/i.test(url)) {
      restricted = true;
      $('#restricted').hidden = false;
      $('#list').style.display = 'none';
      $('.searchwrap').style.display = 'none';
      $('#stats').textContent = '';
      $('#btnClear').style.display = 'none';
      $('#btnExport').style.display = '';
      $('#pageHost').textContent = 'restricted page';
      bindStatic();
      return;
    }

    let u = null;
    try { u = new URL(url); } catch (e) { u = null; }
    if (!u || !/^(https?|file):$/.test(u.protocol)) {
      restricted = true;
      $('#restricted').hidden = false;
      $('#list').style.display = 'none';
      $('.searchwrap').style.display = 'none';
      $('#pageHost').textContent = 'unsupported page';
      bindStatic();
      return;
    }

    urlKey = u.origin + u.pathname + u.search;
    let host = u.hostname || u.pathname || url;
    $('#pageHost').textContent = host.length > 34 ? host.slice(0, 34) + '…' : host;
    if (u.protocol === 'file:') $('#pageHost').title = 'If highlighting does not work on local files, enable "Allow access to file URLs" for PersistMark in chrome://extensions';

    await loadRecords();
    renderSwatches();
    reflectSettings();
    renderList();
    renderStats();
    bindEvents();
    checkSyncWarning();
  }

  function bindStatic() {
    $('#btnOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
    $('#btnExport').addEventListener('click', exportAll);
  }

  /* ------------------------------------------------------------------ */

  async function loadRecords() {
    if (!urlKey) return;
    const key = 'pm:page:' + urlKey;
    let s = null, l = null;
    try { s = (await chrome.storage.sync.get(key))[key]; } catch (e) { /* noop */ }
    try { l = (await chrome.storage.local.get(key))[key]; } catch (e) { /* noop */ }
    let r = settings.syncEnabled ? (s || l) : (l || s);
    if (!Array.isArray(r)) r = [];
    records = r.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function renderSwatches() {
    const wrap = $('#swatches');
    wrap.innerHTML = '';
    for (const c of HL_PALETTE) {
      const b = document.createElement('button');
      b.style.background = c.swatch;
      b.title = c.name;
      b.setAttribute('data-color', c.id);
      b.addEventListener('click', async () => {
        settings.activeColor = c.id;
        try { await chrome.storage.local.set({ 'pm:settings': settings }); } catch (e) { /* noop */ }
        reflectSettings();
        toast('Active color: ' + c.name);
      });
      wrap.appendChild(b);
    }
  }

  function reflectSettings() {
    $('#autoToggle').checked = !!settings.autoHighlight;
    const active = settings.activeColor || HL_DEFAULT_COLOR;
    let matched = false;
    document.querySelectorAll('#swatches button').forEach((b) => {
      const on = b.getAttribute('data-color') === active;
      b.classList.toggle('active', on);
      if (on) matched = true;
    });
    /* custom hex active color -> show it as an extra chip */
    let custom = document.querySelector('#swatches button[data-custom]');
    if (!matched && /^#[0-9a-f]{6}$/i.test(active)) {
      if (!custom) {
        custom = document.createElement('button');
        custom.setAttribute('data-custom', '1');
        custom.title = 'Custom color';
        $('#swatches').appendChild(custom);
      }
      custom.style.background = active;
      custom.classList.add('active');
    } else if (custom) {
      custom.remove();
    }
    const inten = (typeof settings.intensity === 'number' && !isNaN(settings.intensity)) ? settings.intensity : 0.55;
    $('#intensityRange').value = String(inten);
    $('#intensityVal').textContent = Math.round(inten * 100) + '%';
  }

  function renderList() {
    const list = $('#list');
    list.innerHTML = '';
    const q = normWs($('#search').value).toLowerCase();

    const filtered = q
      ? records.filter((r) => ((r.text || '') + ' ' + (r.note || '')).toLowerCase().includes(q))
      : records;

    $('#empty').hidden = filtered.length > 0 || records.length > 0;

    for (const rec of filtered) {
      list.appendChild(itemEl(rec));
    }

    if (records.length && !filtered.length) {
      const d = document.createElement('div');
      d.className = 'muted';
      d.style.cssText = 'text-align:center;padding:22px 10px;font-size:12px;';
      d.textContent = 'No highlights match your search.';
      list.appendChild(d);
    }
  }

  function itemEl(rec) {
    const color = hlColor(rec.color);
    const item = document.createElement('div');
    item.className = 'item';

    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.background = color ? color.swatch : '#b7bccf';

    const body = document.createElement('div');
    body.className = 'body';

    const txt = document.createElement('div');
    txt.className = 'txt';
    txt.textContent = rec.text || '';
    txt.title = rec.text || '';
    body.appendChild(txt);

    if (rec.note) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = '📝 ' + rec.note;
      body.appendChild(note);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = fmtDate(rec.createdAt) + (rec.frame === 'sub' ? ' · in frame' : '');
    body.appendChild(meta);

    const acts = document.createElement('div');
    acts.className = 'acts';

    const copyB = document.createElement('button');
    copyB.title = 'Copy text';
    copyB.innerHTML = SVG_COPY;
    copyB.addEventListener('click', async (e) => {
      e.stopPropagation();
      await copyText(rec.text || '');
      toast('Copied');
    });

    const delB = document.createElement('button');
    delB.className = 'del';
    delB.title = 'Delete highlight';
    delB.innerHTML = SVG_TRASH;
    delB.addEventListener('click', async (e) => {
      e.stopPropagation();
      await del(rec.id);
    });

    acts.appendChild(copyB);
    acts.appendChild(delB);

    item.appendChild(bar);
    item.appendChild(body);
    item.appendChild(acts);
    item.addEventListener('click', () => jump(rec.id));
    return item;
  }

  function renderStats() {
    const n = records.length;
    let version = '';
    try { version = ' · v' + chrome.runtime.getManifest().version; } catch (e) { /* noop */ }
    $('#stats').textContent = (n === 1 ? '1 highlight on this page' : n + ' highlights on this page') + version;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function normWs(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ */

  function bindEvents() {
    bindStatic();

    $('#autoToggle').addEventListener('change', async (e) => {
      settings.autoHighlight = e.target.checked;
      try { await chrome.storage.local.set({ 'pm:settings': settings }); } catch (err) { /* noop */ }
    });

    $('#search').addEventListener('input', renderList);

    $('#intensityRange').addEventListener('input', async (e) => {
      settings.intensity = parseFloat(e.target.value);
      $('#intensityVal').textContent = Math.round(settings.intensity * 100) + '%';
      try { await chrome.storage.local.set({ 'pm:settings': settings }); } catch (err) { /* noop */ }
    });

    $('#btnClear').addEventListener('click', async () => {
      if (!records.length) { toast('Nothing to clear'); return; }
      if (!confirm('Delete all highlights on this page?')) return;
      try { await chrome.tabs.sendMessage(tab.id, { type: 'PM_CLEAR_PAGE' }); } catch (e) { /* noop */ }
      await clearPageInStorage();
      records = [];
      renderList();
      renderStats();
      toast('Page cleared');
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (urlKey && changes['pm:page:' + urlKey]) {
        loadRecords().then(() => { renderList(); renderStats(); });
      }
      if (area === 'local' && changes['pm:settings']) {
        settings = Object.assign({}, HL_DEFAULT_SETTINGS, changes['pm:settings'].newValue || {});
        reflectSettings();
      }
    });
  }

  async function clearPageInStorage() {
    const key = 'pm:page:' + urlKey;
    for (const store of [chrome.storage.local, chrome.storage.sync]) {
      try { await store.remove(key); } catch (e) { /* noop */ }
      try {
        const pages = (await store.get('pm:pages'))['pm:pages'] || {};
        if (pages[urlKey]) { delete pages[urlKey]; await store.set({ 'pm:pages': pages }); }
      } catch (e) { /* noop */ }
    }
  }

  async function jump(id) {
    /* Sent to all frames; only the frame that owns the highlight responds. */
    let ok = false;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'PM_JUMP', id });
      ok = !!(res && res.ok);
    } catch (e) {
      ok = false;
    }
    if (!ok) toast('Highlight not reachable — try reloading the page');
    setTimeout(() => window.close(), 350);
  }

  async function del(id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'PM_REMOVE', id });
    } catch (e) {
      await removeFromStorage(id); // fallback when the content script is absent
    }
    records = records.filter((r) => r.id !== id);
    renderList();
    renderStats();
    toast('Highlight removed');
  }

  async function removeFromStorage(id) {
    if (!urlKey) return;
    const key = 'pm:page:' + urlKey;
    for (const store of [chrome.storage.local, chrome.storage.sync]) {
      try {
        const cur = (await store.get(key))[key];
        if (Array.isArray(cur)) await store.set({ [key]: cur.filter((r) => r.id !== id) });
      } catch (e) { /* noop */ }
    }
  }

  /* ------------------------------------------------------------------ */

  async function gatherAllPages() {
    const out = {};
    for (const store of [chrome.storage.local, chrome.storage.sync]) {
      let all = {};
      try { all = await store.get(null); } catch (e) { continue; }
      for (const k of Object.keys(all)) {
        if (k.indexOf('pm:page:') !== 0) continue;
        const arr = Array.isArray(all[k]) ? all[k] : [];
        const merged = out[k] || [];
        const ids = new Set(merged.map((r) => r.id));
        for (const r of arr) if (!ids.has(r.id)) merged.push(r);
        out[k] = merged;
      }
    }
    return out;
  }

  async function exportAll() {
    try {
      const pages = await gatherAllPages();
      const blob = new Blob([JSON.stringify({ app: 'persistmark', version: 1, exportedAt: new Date().toISOString(), pages }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'persistmark-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('Backup downloaded');
    } catch (e) {
      toast('Export failed');
    }
  }

  async function checkSyncWarning() {
    try {
      const w = (await chrome.storage.local.get('pm:syncwarn'))['pm:syncwarn'];
      if (w && Date.now() - w < 86400000 && settings.syncEnabled) {
        toast('Sync storage full — some data was saved locally');
      }
    } catch (e) { /* noop */ }
  }

  /* ------------------------------------------------------------------ */

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }
})();
