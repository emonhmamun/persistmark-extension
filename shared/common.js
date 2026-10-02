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
const HL_PALETTE = [
  { id: 'yellow', name: 'Yellow',  swatch: '#ffd94d', light: 'rgba(255, 224, 102, 0.55)', dark: 'rgba(255, 213, 79, 0.30)' },
  { id: 'green',  name: 'Green',   swatch: '#7de08a', light: 'rgba(140, 235, 150, 0.50)', dark: 'rgba(105, 240, 175, 0.26)' },
  { id: 'blue',   name: 'Blue',    swatch: '#7ab5ff', light: 'rgba(140, 200, 255, 0.50)', dark: 'rgba(120, 170, 255, 0.28)' },
  { id: 'pink',   name: 'Pink',    swatch: '#ff8fbe', light: 'rgba(255, 170, 205, 0.50)', dark: 'rgba(255, 138, 190, 0.28)' },
  { id: 'orange', name: 'Orange',  swatch: '#ff9d5c', light: 'rgba(255, 190, 130, 0.50)', dark: 'rgba(255, 160, 105, 0.28)' },
  { id: 'purple', name: 'Purple',  swatch: '#c493ff', light: 'rgba(205, 170, 255, 0.50)', dark: 'rgba(197, 150, 255, 0.30)' },
  { id: 'red',    name: 'Red',     swatch: '#ff8f8f', light: 'rgba(255, 150, 150, 0.50)', dark: 'rgba(255, 120, 120, 0.28)' },
  { id: 'teal',   name: 'Teal',    swatch: '#6fe0d3', light: 'rgba(130, 230, 220, 0.50)', dark: 'rgba(90, 220, 205, 0.26)' }
];

const HL_DEFAULT_COLOR = 'yellow';

function hlColor(colorId) {
  return HL_PALETTE.find(function (c) { return c.id === colorId; }) || null;
}

const HL_DEFAULT_SETTINGS = {
  enabled: true,          // master switch
  toolbarEnabled: true,   // show the floating toolbar when text is selected
  autoHighlight: false,   // highlighter mode: instantly highlight every selection (opt-in)
  activeColor: HL_DEFAULT_COLOR,
  intensity: 0.55,        // default highlight strength for new highlights (0.15 - 0.85)
  iframeEnabled: true,    // also work inside iframes
  allowEditable: false,   // allow highlighting inside contenteditable areas
  syncEnabled: false,     // store highlights in chrome.storage.sync (opt-in)
  blocklist: []           // domains where the extension stays inactive
};

/* ======================================================================
 * Import sanitization (used by the options page, tested by engine tests)
 * Backups are JSON files that may come from untrusted sources — every
 * field is validated and rebuilt into a fresh, bounded record.
 * ====================================================================== */

const HL_IMPORT_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,   // 25 MB
  maxRecordsPerPage: 2000,
  maxTotalRecords: 50000,
  maxTextLen: 20000,      // matches MAX_TEXT in the content script
  maxContextLen: 200,     // prefix/suffix (~40 chars in practice)
  maxNoteLen: 1000,
  maxTitleLen: 500,
  maxUrlLen: 2048,
  maxXPathLen: 2000,
  maxIdLen: 64,
  maxKeyLen: 2100
};

function hlSanitizeRecord(r, L) {
  L = L || HL_IMPORT_LIMITS;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  if (typeof r.id !== 'string' || !r.id.trim() || r.id.length > L.maxIdLen) return null;
  if (typeof r.text !== 'string' || !r.text.trim() || r.text.length > L.maxTextLen) return null;

  const str = (v, max, fallback) => (typeof v === 'string' && v.length ? v.slice(0, max) : (fallback || ''));
  const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1000000 ? Math.floor(v) : 0);

  let color = typeof r.color === 'string' ? r.color.slice(0, 32) : HL_DEFAULT_COLOR;
  if (!hlColor(color) && !/^#[0-9a-f]{6}$/i.test(color)) color = HL_DEFAULT_COLOR;

  let intensity = null;
  if (typeof r.intensity === 'number' && isFinite(r.intensity)) {
    intensity = Math.min(0.85, Math.max(0.15, r.intensity));
  }

  let xpath = null;
  if (r.xpath && typeof r.xpath === 'object' && !Array.isArray(r.xpath) &&
      typeof r.xpath.start === 'string' && typeof r.xpath.end === 'string' &&
      r.xpath.start.length && r.xpath.end.length) {
    xpath = {
      start: r.xpath.start.slice(0, L.maxXPathLen),
      startOffset: num(r.xpath.startOffset),
      end: r.xpath.end.slice(0, L.maxXPathLen),
      endOffset: num(r.xpath.endOffset)
    };
  }

  return {
    id: r.id,
    url: str(r.url, L.maxUrlLen),
    urlKey: str(r.urlKey, L.maxUrlLen),
    title: str(r.title, L.maxTitleLen),
    frame: (r.frame === 'sub') ? 'sub' : 'top',
    color: color,
    intensity: intensity,
    note: str(r.note, L.maxNoteLen),
    text: r.text,
    prefix: str(r.prefix, L.maxContextLen),
    suffix: str(r.suffix, L.maxContextLen),
    occurrenceFull: num(r.occurrenceFull),
    occurrenceText: num(r.occurrenceText),
    xpath: xpath,
    createdAt: (typeof r.createdAt === 'number' && isFinite(r.createdAt) && r.createdAt > 0) ? r.createdAt : Date.now(),
    updatedAt: (typeof r.updatedAt === 'number' && isFinite(r.updatedAt) && r.updatedAt > 0) ? r.updatedAt : Date.now()
  };
}

/* Validates a parsed backup object. Returns null when invalid, otherwise
   { pages: { 'pm:page:<url>': [records] }, records: <count> }. */
function hlSanitizeBackup(data, L) {
  L = L || HL_IMPORT_LIMITS;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.app !== 'persistmark') return null;
  if (!data.pages || typeof data.pages !== 'object' || Array.isArray(data.pages)) return null;

  const pages = {};
  let total = 0;
  for (const key of Object.keys(data.pages)) {
    if (key.indexOf('pm:page:') !== 0 || key.length > L.maxKeyLen) continue;
    const arr = data.pages[key];
    if (!Array.isArray(arr)) continue;
    const out = [];
    for (let i = 0; i < arr.length && out.length < L.maxRecordsPerPage; i++) {
      const rec = hlSanitizeRecord(arr[i], L);
      if (rec) { out.push(rec); total++; }
      if (total >= L.maxTotalRecords) break;
    }
    if (out.length) pages[key] = out;
    if (total >= L.maxTotalRecords) break;
  }
  return { pages: pages, records: total };
}
