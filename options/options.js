/* PersistMark – options page logic */

(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  const SETTINGS_KEY = 'pm:settings';
  const TOGGLE_IDS = ['enabled', 'toolbarEnabled', 'autoHighlight', 'iframeEnabled', 'allowEditable', 'syncEnabled'];

  let settings = Object.assign({}, HL_DEFAULT_SETTINGS);
  let suppressSyncMigration = false;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      settings = Object.assign({}, HL_DEFAULT_SETTINGS, (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {});
    } catch (e) { /* defaults */ }

    for (const id of TOGGLE_IDS) {
      const el = document.getElementById(id);
      if (el) el.checked = !!settings[id];
      el.addEventListener('change', () => onToggleChanged(id, el.checked));
    }

    renderSwatches();
    reflectIntensity();
    renderBlocklist();
    renderDataStats();
    bindDataButtons();
  }

  function reflectIntensity() {
    const v = (typeof settings.intensity === 'number' && !isNaN(settings.intensity)) ? settings.intensity : 0.55;
    const el = document.getElementById('intensityRange');
    el.value = String(v);
    document.getElementById('intensityVal').textContent = Math.round(v * 100) + '%';
    const hex = (hlColor(settings.activeColor || HL_DEFAULT_COLOR) || { swatch: '#ffd94d' }).swatch;
    const pv = document.getElementById('intensityPreview');
    pv.style.background = 'rgba(' + parseInt(hex.slice(1, 3), 16) + ', ' + parseInt(hex.slice(3, 5), 16) + ', ' + parseInt(hex.slice(5, 7), 16) + ', ' + v + ')';
  }

  async function persistSettings() {
    try { await chrome.storage.local.set({ [SETTINGS_KEY]: settings }); }
    catch (e) { showStatus('#importStatus', 'Could not save settings.', 'err'); }
  }

  async function onToggleChanged(id, value) {
    settings[id] = value;

    if (id === 'syncEnabled' && !suppressSyncMigration) {
      const ok = await handleSyncToggle(value);
      if (!ok) {
        // revert on failure
        suppressSyncMigration = true;
        settings.syncEnabled = !value;
        document.getElementById('syncEnabled').checked = !value;
        suppressSyncMigration = false;
        await persistSettings();
        return;
      }
    }

    await persistSettings();
    renderDataStats();
  }

  /* ------------------------------------------------------------------ */
  /* Active color                                                        */
  /* ------------------------------------------------------------------ */

  function renderSwatches() {
    const wrap = $('#swatches');
    wrap.innerHTML = '';
    for (const c of HL_PALETTE) {
      const b = document.createElement('button');
      b.style.background = c.swatch;
      b.title = c.name;
      b.setAttribute('data-color', c.id);
      b.classList.toggle('active', (settings.activeColor || HL_DEFAULT_COLOR) === c.id);
      b.addEventListener('click', async () => {
        settings.activeColor = c.id;
        await persistSettings();
        renderSwatches();
        reflectIntensity();
      });
      wrap.appendChild(b);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sync migration                                                      */
  /* ------------------------------------------------------------------ */

  async function handleSyncToggle(enable) {
    const statusEl = $('#syncStatus');
    statusEl.hidden = false;
    statusEl.className = 'status';
    statusEl.textContent = enable ? 'Copying your highlights into sync storage…' : 'Copying highlights back to local storage…';

    const src = enable ? chrome.storage.local : chrome.storage.sync;
    const dst = enable ? chrome.storage.sync : chrome.storage.local;

    let all = {};
    try { all = await src.get(null); } catch (e) {
      showStatus(statusEl, 'Could not read source storage.', 'err');
      return false;
    }

    let moved = 0, failed = 0;
    for (const k of Object.keys(all)) {
      if (k.indexOf('pm:page:') !== 0 && k !== 'pm:pages') continue;
      try { await dst.set({ [k]: all[k] }); moved++; }
      catch (e) { failed++; }
    }

    if (failed > 0) {
      showStatus(statusEl,
        'Sync storage limit reached — ' + moved + ' page(s) copied, ' + failed + ' could not fit. ' +
        'The overflow was kept in local storage (it will still be used as a fallback).', 'warn');
      return true; // keep sync enabled; loadRecords falls back to local
    }

    showStatus(statusEl,
      enable
        ? 'Done — ' + moved + ' item(s) now sync across devices signed into this Chrome profile.'
        : 'Done — ' + moved + ' item(s) copied back to this computer.', 'ok');
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Blocklist                                                           */
  /* ------------------------------------------------------------------ */

  function renderBlocklist() {
    const ul = $('#blockList');
    ul.innerHTML = '';
    const list = settings.blocklist || [];
    if (!list.length) {
      const li = document.createElement('li');
      li.textContent = 'No exceptions — active on every site';
      li.style.background = 'transparent';
      li.style.color = '#8d93ab';
      ul.appendChild(li);
      return;
    }
    for (const domain of list) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = domain;
      const btn = document.createElement('button');
      btn.textContent = '✕';
      btn.title = 'Remove ' + domain;
      btn.addEventListener('click', async () => {
        settings.blocklist = settings.blocklist.filter((d) => d !== domain);
        await persistSettings();
        renderBlocklist();
      });
      li.appendChild(span);
      li.appendChild(btn);
      ul.appendChild(li);
    }
  }

  function bindBlocklist() {
    const input = $('#blockInput');
    const add = () => {
      let v = input.value.trim().toLowerCase()
        .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      if (!v || !/^[a-z0-9.\-*_-]+$/.test(v)) { input.focus(); return; }
      if (!settings.blocklist) settings.blocklist = [];
      if (settings.blocklist.indexOf(v) === -1) settings.blocklist.push(v);
      input.value = '';
      persistSettings().then(renderBlocklist);
    };
    $('#blockAdd').addEventListener('click', add);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  }

  /* ------------------------------------------------------------------ */
  /* Data management                                                     */
  /* ------------------------------------------------------------------ */

  async function renderDataStats() {
    let pages = 0, highlights = 0;
    for (const store of [chrome.storage.local, chrome.storage.sync]) {
      let all = {};
      try { all = await store.get(null); } catch (e) { continue; }
      for (const k of Object.keys(all)) {
        if (k.indexOf('pm:page:') !== 0) continue;
        if (Array.isArray(all[k]) && all[k].length) { pages++; highlights += all[k].length; }
      }
    }
    $('#dataStats').textContent =
      pages === 0
        ? 'No highlights saved yet.'
        : highlights + ' highlight(s) across ' + pages + ' page(s).';
  }

  function bindDataButtons() {
    bindBlocklist();

    document.getElementById('intensityRange').addEventListener('input', async (e) => {
      settings.intensity = parseFloat(e.target.value);
      document.getElementById('intensityVal').textContent = Math.round(settings.intensity * 100) + '%';
      const hex = (hlColor(settings.activeColor || HL_DEFAULT_COLOR) || { swatch: '#ffd94d' }).swatch;
      document.getElementById('intensityPreview').style.background =
        'rgba(' + parseInt(hex.slice(1, 3), 16) + ', ' + parseInt(hex.slice(3, 5), 16) + ', ' + parseInt(hex.slice(5, 7), 16) + ', ' + settings.intensity + ')';
      await persistSettings();
    });

    $('#btnExport').addEventListener('click', exportAll);

    $('#importFile').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importFile(file, $('#importMode').value);
      e.target.value = '';
    });

    $('#btnClearAll').addEventListener('click', async () => {
      if (!confirm('This deletes ALL highlights on ALL pages, on this device and in sync storage. Continue?')) return;
      for (const store of [chrome.storage.local, chrome.storage.sync]) {
        try {
          const all = await store.get(null);
          const keys = Object.keys(all).filter((k) => k.indexOf('pm:page:') === 0 || k === 'pm:pages' || k === 'pm:syncwarn');
          if (keys.length) await store.remove(keys);
        } catch (e) { /* noop */ }
      }
      showStatus('#importStatus', 'All highlight data deleted.', 'ok');
      renderDataStats();
    });
  }

  async function exportAll() {
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
    const blob = new Blob([JSON.stringify({ app: 'persistmark', version: 1, exportedAt: new Date().toISOString(), pages: out }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'persistmark-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showStatus('#importStatus', 'Backup downloaded.', 'ok');
  }

  async function importFile(file, mode) {
    const statusEl = '#importStatus';
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { showStatus(statusEl, 'That file is not valid JSON.', 'err'); return; }

    if (!data || data.app !== 'persistmark' || !data.pages || typeof data.pages !== 'object') {
      showStatus(statusEl, 'That file is not a PersistMark backup.', 'err');
      return;
    }

    const dst = settings.syncEnabled ? chrome.storage.sync : chrome.storage.local;

    if (mode === 'replace') {
      if (!confirm('Replace ALL existing highlights with the backup?')) return;
      for (const store of [chrome.storage.local, chrome.storage.sync]) {
        try {
          const all = await store.get(null);
          const keys = Object.keys(all).filter((k) => k.indexOf('pm:page:') === 0 || k === 'pm:pages');
          if (keys.length) await store.remove(keys);
        } catch (e) { /* noop */ }
      }
    }

    let imported = 0, skipped = 0;
    const newPagesIndex = {};

    for (const key of Object.keys(data.pages)) {
      if (key.indexOf('pm:page:') !== 0) continue;
      const incoming = Array.isArray(data.pages[key]) ? data.pages[key] : [];
      let final = incoming.filter((r) => r && r.id && typeof r.text === 'string');

      if (mode === 'merge') {
        let existing = [];
        try { existing = (await dst.get(key))[key] || []; } catch (e) { /* noop */ }
        if (!Array.isArray(existing)) existing = [];
        const ids = new Set(final.map((r) => r.id));
        const merged = final.concat(existing.filter((r) => !ids.has(r.id)));
        final = merged;
      }

      try {
        await dst.set({ [key]: final });
        imported += final.length;
        if (final.length) {
          newPagesIndex[key] = {
            url: final[0].url || ('https://' + key.slice(8)),
            title: final[0].title || '',
            count: final.length,
            updatedAt: Date.now()
          };
        }
      } catch (e) {
        try { await chrome.storage.local.set({ [key]: final }); imported += final.length; }
        catch (e2) { skipped++; }
      }
    }

    // rebuild the page index for imported keys
    try {
      const pages = (await dst.get('pm:pages'))['pm:pages'] || {};
      for (const k of Object.keys(newPagesIndex)) {
        if (mode === 'replace' || !pages[k]) pages[k] = newPagesIndex[k];
        else pages[k] = Object.assign({}, pages[k], { count: newPagesIndex[k].count, updatedAt: Date.now() });
      }
      await dst.set({ 'pm:pages': pages });
    } catch (e) { /* non-fatal */ }

    showStatus(statusEl, 'Imported ' + imported + ' highlight(s)' + (skipped ? ' — ' + skipped + ' page(s) skipped (storage full).' : '.'), skipped ? 'warn' : 'ok');
    renderDataStats();
  }

  function showStatus(sel, msg, kind) {
    const el = $(sel);
    el.hidden = false;
    el.className = 'status ' + (kind || '');
    el.textContent = msg;
  }
})();
