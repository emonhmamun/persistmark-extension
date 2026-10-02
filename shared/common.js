/*
 * PersistMark – shared constants
 * Plain script: loaded by the content script (via manifest), by the popup and
 * options pages (via <script src>), and by the service worker (importScripts).
 * Must stay side-effect free.
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
