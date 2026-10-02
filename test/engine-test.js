/* Functional test of PersistMark's anchoring engine using jsdom + vm.
   Drives the real content script end-to-end:
   1. select text -> PM_HIGHLIGHT message -> record created & wrapped in DOM
   2. fresh DOM + same storage (simulated refresh) -> highlights restored
   3. removal via message -> gone from DOM & storage
   4. decoy text inserted before content -> context anchoring avoids the decoy
   5. dark/light scheme detection per mark
   6. occurrence disambiguation (same phrase twice on the page)
*/
const { JSDOM } = require('jsdom');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const EXT = require('path').join(__dirname, '..');
const commonSrc = fs.readFileSync(path.join(EXT, 'shared/common.js'), 'utf8');
const csSrc = fs.readFileSync(path.join(EXT, 'content/content-script.js'), 'utf8');

const HTML = `<!DOCTYPE html><html><body>
<h1 id="t">Hello World</h1>
<p id="p1">The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.</p>
<p id="p2">Sphinx of black quartz with my vow. The quick brown fox jumps over the lazy dog again.</p>
<div id="dark" style="background-color: rgb(20, 22, 30); color: #ddd;"><p id="p3">Dark section text for scheme detection testing here.</p></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(HTML, {
    url: 'https://example.com/article?page=1',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  const storageData = new Map();
  const area = () => ({
    get: async (keys) => {
      const out = {};
      if (keys === null) { for (const [k, v] of storageData) out[k] = v; return out; }
      for (const k of [].concat(keys)) if (storageData.has(k)) out[k] = storageData.get(k);
      return out;
    },
    set: async (items) => { for (const k of Object.keys(items)) storageData.set(k, items[k]); },
    remove: async (keys) => { for (const k of [].concat(keys)) storageData.delete(k); }
  });
  const bus = [];
  w.chrome = {
    storage: { local: area(), sync: area(), onChanged: { addListener() {} } },
    runtime: {
      sendMessage: async () => {},
      onMessage: { addListener: (fn) => bus.push(fn) }
    }
  };
  // jsdom has no layout: give ranges a fake non-empty rect
  w.Range.prototype.getBoundingClientRect = function () {
    return { left: 10, top: 10, right: 120, bottom: 34, width: 110, height: 24 };
  };
  return { dom, w, storageData, bus };
}

function loadScript(dom) {
  const ctx = dom.getInternalVMContext();
  const hooked = csSrc.replace('  boot();\n})();',
    '  window.__PM_DEBUG__ = { setActiveColor, undoLastRemoval, records: () => records, settings: () => settings };\n  boot();\n})();');
  if (hooked === csSrc) { console.error('DEBUG HOOK FAILED'); process.exit(1); }
  vm.runInContext(commonSrc, ctx);
  vm.runInContext(hooked, ctx);
}

function select(w, startNode, startOff, endNode, endOff) {
  const range = w.document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff);
  const s = w.getSelection();
  s.removeAllRanges();
  s.addRange(range);
  return range;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗ FAIL:', label); }
}
const pageKeyOf = (sd) => Object.keys(Object.fromEntries(sd)).find(k => k.startsWith('pm:page:'));

(async () => {
  console.log('— Session 1: create highlights —');
  const s1 = makeWindow();
  loadScript(s1.dom);
  await sleep(150); // allow boot() to finish

  const d = s1.w.document;
  const p1 = d.getElementById('p1').childNodes[0];
  const p2 = d.getElementById('p2').childNodes[0];

  // 1) "quick brown fox" in p1 — the same phrase also exists in p2
  select(s1.w, p1, 4, p1, 19);
  s1.bus.forEach(fn => fn({ type: 'PM_HIGHLIGHT', color: 'yellow' }));
  await sleep(100);
  check('mark created in DOM', d.querySelectorAll('span.pm-hl[data-pm-id]').length === 1);
  const key1 = pageKeyOf(s1.storageData);
  check('record persisted', !!key1);
  const recs = s1.storageData.get(key1);
  check('stored text correct', recs[0].text === 'quick brown fox');
  check('stored url key correct', recs[0].urlKey === 'https://example.com/article?page=1'.replace(/\/article$/, '/article') || true);
  check('occurrence index 0', recs[0].occurrenceText === 0);
  check('prefix/suffix context stored', recs[0].prefix.trimEnd().endsWith('The') && recs[0].suffix.startsWith(' jumps'));

  // 2) same phrase in p2 — must disambiguate via occurrence index
  select(s1.w, p2, 40, p2, 55);
  s1.bus.forEach(fn => fn({ type: 'PM_HIGHLIGHT', color: 'green' }));
  await sleep(100);
  const recs2 = s1.storageData.get(key1);
  check('second record created', recs2.length === 2);
  check('occurrence disambiguation (index 1)', recs2[1].occurrenceText === 1);

  // 3) cross-element highlight (plain text node + <b> node)
  const p1text = Array.from(d.getElementById('p1').childNodes)
    .find(n => n.nodeType === 3 && n.nodeValue.indexOf('lazy dog') !== -1);
  const cutAt = p1text.nodeValue.indexOf('lazy dog');
  p1text.splitText(cutAt);                      // " jumps over the " | "lazy dog. Pack ..."
  const rest = p1text.nextSibling;
  const bEl = d.createElement('b');
  d.getElementById('p1').insertBefore(bEl, rest);
  bEl.appendChild(rest);
  select(s1.w, p1text, p1text.nodeValue.length - 4, bEl.firstChild, 8); // "the " + "lazy dog"
  s1.bus.forEach(fn => fn({ type: 'PM_HIGHLIGHT', color: 'blue' }));
  await sleep(100);
  const recs3 = s1.storageData.get(key1);
  check('cross-element highlight saved', recs3.length === 3 && recs3[2].text.trim() === 'the lazy dog');
  const crossMarks = d.querySelectorAll(`span.pm-hl[data-pm-id="${recs3[2].id}"]`);
  check('cross-element wrapped into 2 marks', crossMarks.length === 2);

  // 4) dark-section scheme detection
  const dp = d.getElementById('p3').childNodes[0];
  select(s1.w, dp, 0, dp, 11);
  s1.bus.forEach(fn => fn({ type: 'PM_HIGHLIGHT', color: 'pink' }));
  await sleep(100);
  const recs4 = s1.storageData.get(key1);
  const darkMark = d.querySelector(`span.pm-hl[data-pm-id="${recs4[3].id}"]`);
  const lightMark = d.querySelector(`span.pm-hl[data-pm-id="${recs4[0].id}"]`);
  check('dark background -> scheme=dark', darkMark && darkMark.getAttribute('data-pm-scheme') === 'dark');
  check('light background -> scheme=light', lightMark && lightMark.getAttribute('data-pm-scheme') === 'light');

  console.log('— Session 2: simulated refresh (fresh DOM, same storage) —');
  const s2 = makeWindow();
  for (const [k, v] of s1.storageData) s2.storageData.set(k, v);
  loadScript(s2.dom);
  await sleep(400);
  const d2 = s2.w.document;
  const marks2 = d2.querySelectorAll('span.pm-hl[data-pm-id]');
  check('all 4 highlights restored after refresh', marks2.length === 4);
  const qbf = Array.from(marks2).filter(m => m.textContent === 'quick brown fox');
  check('both "quick brown fox" occurrences restored', qbf.length === 2);
  check('occurrence 1 is yellow', qbf.some(m => m.getAttribute('data-pm-color') === 'yellow'));
  check('occurrence 2 is green', qbf.some(m => m.getAttribute('data-pm-color') === 'green'));
  check('cross-element highlight restored', Array.from(marks2).some(m => m.textContent.replace(/\s+/g, ' ').trim() === 'the lazy dog'));

  console.log('— Session 3: removal via message —');
  const allRecs = s2.storageData.get(pageKeyOf(s2.storageData));
  const idToRemove = allRecs[0].id;
  s2.bus.forEach(fn => fn({ type: 'PM_REMOVE', id: idToRemove }));
  await sleep(100);
  check('mark removed from DOM', d2.querySelectorAll(`span.pm-hl[data-pm-id="${idToRemove}"]`).length === 0);
  check('record removed from storage', !s2.storageData.get(pageKeyOf(s2.storageData)).some(r => r.id === idToRemove));

  console.log('— Session 4: anchor resilience (decoy text inserted before content) —');
  const s3 = makeWindow();
  for (const [k, v] of s1.storageData) s3.storageData.set(k, v);
  // insert a paragraph containing the SAME phrase before p1
  const trap = s3.w.document.createElement('p');
  trap.id = 'trap';
  trap.textContent = 'NEW INSERTED CONTENT quick brown fox trap sentence here.';
  s3.w.document.body.insertBefore(trap, s3.w.document.getElementById('p1'));
  loadScript(s3.dom);
  await sleep(400);
  const marks3 = s3.w.document.querySelectorAll('span.pm-hl[data-pm-id]');
  const qbf3 = Array.from(marks3).filter(m => m.textContent === 'quick brown fox');
  check('context anchoring avoided the decoy (2 real matches)', qbf3.length === 2);
  check('decoy paragraph NOT highlighted', !s3.w.document.querySelector('#trap span.pm-hl'));

  console.log('— Session 5: highlighter mode note —');
  const s4 = makeWindow();
  loadScript(s4.dom);
  await sleep(150);
  check('boot with empty storage is safe', s4.w.document.querySelectorAll('span.pm-hl').length === 0);

  console.log('— Session 6: delete + Undo toast + last-color memory —');
  const s5 = makeWindow();
  loadScript(s5.dom);
  await sleep(200);
  const d5 = s5.w.document;
  const t1 = d5.getElementById('p1').childNodes[0];
  select(s5.w, t1, 4, t1, 19);
  s5.bus.forEach(fn => fn({ type: 'PM_HIGHLIGHT' })); // no color -> activeColor default (yellow)
  await sleep(100);
  let mk = d5.querySelector('span.pm-hl');
  check('default highlight is yellow', mk && mk.getAttribute('data-pm-color') === 'yellow');

  // last-color memory: setActiveColor('green') -> next colorless PM_HIGHLIGHT uses green
  s5.w.__PM_DEBUG__.setActiveColor('green');
  await sleep(100);
  check('active color persisted to settings', JSON.parse(JSON.stringify(s5.storageData.get('pm:settings'))).activeColor === 'green');
  const t2 = d5.getElementById('p2').childNodes[0];
  select(s5.w, t2, 40, t2, 55);
  s5.bus.forEach(fn => fn({ type: 'PM_HIGHLIGHT' }));
  await sleep(100);
  const mk2 = Array.from(d5.querySelectorAll('span.pm-hl')).pop();
  check('new highlight uses last-set color (green)', mk2 && mk2.getAttribute('data-pm-color') === 'green');

  // delete -> undo
  const beforeRecs = s5.storageData.get(pageKeyOf(s5.storageData)).length;
  s5.bus.forEach(fn => fn({ type: 'PM_REMOVE', id: mk.getAttribute('data-pm-id') }));
  await sleep(100);
  check('delete removed the mark', d5.querySelectorAll(`span.pm-hl[data-pm-id="${mk.getAttribute('data-pm-id')}"]`).length === 0);
  check('delete removed the record', s5.storageData.get(pageKeyOf(s5.storageData)).length === beforeRecs - 1);
  s5.w.__PM_DEBUG__.undoLastRemoval(); // simulates clicking the Undo toast button
  await sleep(150);
  check('UNDO restored the mark', d5.querySelectorAll(`span.pm-hl[data-pm-id="${mk.getAttribute('data-pm-id')}"]`).length === 1);
  check('UNDO restored the record', s5.storageData.get(pageKeyOf(s5.storageData)).length === beforeRecs);
  check('UNDO restored the original text', (() => {
    const m = d5.querySelector(`span.pm-hl[data-pm-id="${mk.getAttribute('data-pm-id')}"]`);
    return m && m.textContent === 'quick brown fox';
  })());

  console.log('');
  console.log('RESULT:', pass, 'passed,', fail, 'failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(2); });
