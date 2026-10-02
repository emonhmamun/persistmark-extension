/* E2E: real extension, real Chromium, real mouse events. */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EXT_SRC = require('path').join(__dirname, '..');
const EXT_TEST = '/tmp/pm-ext-test';

const HOOK = `
  /* ---- TEST BRIDGE (test builds only) ---- */
  let bridgeLog = [];
  try {
    const _csi = currentSelectionInfo;
    currentSelectionInfo = function() {
      const r = _csi.apply(this, arguments);
      try { const sel = window.getSelection(); bridgeLog.push({ fn: 'csi', ok: !!r, rc: sel.rangeCount, coll: sel.isCollapsed, txt: (sel.toString() || '').slice(0, 30) }); } catch (e) {}
      return r;
    };
    const _shr = saveHighlightRange;
    saveHighlightRange = function(range, color) {
      let r = null;
      try { r = _shr.apply(this, arguments); } catch (e) { bridgeLog.push({ fn: 'shr', err: String(e) }); throw e; }
      bridgeLog.push({ fn: 'shr', color: color, ok: !!(r && (r.rec || r.recolored)) });
      return r;
    };
    const bridge = document.createElement('div');
    bridge.id = 'pm-test-bridge';
    bridge.style.display = 'none';
    (document.documentElement || document.body).appendChild(bridge);
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 }; };
    bridge.addEventListener('pm-cmd', () => {
      let result = null;
      try {
        const cmd = bridge.getAttribute('data-cmd');
        const argRaw = bridge.getAttribute('data-arg');
        const arg = argRaw ? JSON.parse(argRaw) : null;
        const t = TB, p = POP;
        switch (cmd) {
          case 'state':
            result = { armed, settings: settings, recordIds: records.map(r => r.id), toolbarVisible: !!(t && t.host.style.display !== 'none'), popVisible: !!(p && p.host.style.display !== 'none'), toastVisible: !!(TOAST && TOAST.host.style.display !== 'none'), panelOpen: !!(t && t.panel && t.panel.classList.contains('open')) };
            break;
          case 'box':
            if (arg.target === 'hlBtn') result = box(t && t.hlBtn);
            else if (arg.target === 'removeBtn') result = box(t && t.removeBtn);
            else if (arg.target === 'copyBtn') result = box(t && t.copyBtn);
            else if (arg.target === 'customBtn') result = box(t && t.customBtn);
            else if (arg.target === 'toolbar') result = box(t && t.host);
            else if (arg.target === 'popover') result = box(p && p.host);
            else if (arg.target === 'popDelete') {
              const b = p && Array.from(p.root.querySelectorAll('button')).find(b => /delete/i.test(b.textContent || ''));
              result = box(b);
            } else if (arg.target === 'panelApply') result = box(t && t.applyBtn);
            else if (arg.target === 'panelColor') result = box(t && t.colorInput);
            else if (arg.target === 'panelRange') result = box(t && t.range);
            else if (arg.target === 'popRange') result = box(p && p.irange);
            else if (arg.target.indexOf('swatch:') === 0) {
              const id = arg.target.slice(7);
              result = box(t && t.swatches.find(s => s.getAttribute('data-color') === id));
            } else if (arg.target.indexOf('popSwatch:') === 0) {
              const id = arg.target.slice(10);
              result = box(p && p.swatches.find(s => s.getAttribute('data-color') === id));
            }
            break;
          case 'setPanel':
            if (t && t.colorInput) {
              if (arg.hex) { t.colorInput.value = arg.hex; t.colorInput.dispatchEvent(new Event('input', { bubbles: true })); }
              if (arg.intensity != null) { t.range.value = String(arg.intensity); t.range.dispatchEvent(new Event('input', { bubbles: true })); }
              result = { hex: t.colorInput.value, intensity: t.range.value };
            }
            break;
          case 'setPopRange':
            if (p && p.irange) {
              p.irange.value = String(arg);
              p.irange.dispatchEvent(new Event('input', { bubbles: true }));
              p.irange.dispatchEvent(new Event('change', { bubbles: true }));
              result = { v: p.irange.value };
            }
            break;
          case 'records':
            result = records;
            break;
          case 'logs':
            result = bridgeLog; bridgeLog = [];
            break;
        }
      } catch (e) { result = { error: String(e && e.stack || e) }; }
      bridge.setAttribute('data-result', JSON.stringify(result));
    });
  } catch (e) { /* bridge optional */ }
`;

function buildTestExtension() {
  fs.rmSync(EXT_TEST, { recursive: true, force: true });
  fs.cpSync(EXT_SRC, EXT_TEST, { recursive: true });
  let cs = fs.readFileSync(path.join(EXT_TEST, 'content/content-script.js'), 'utf8');
  cs = cs.replace('  boot();\n})();', HOOK + '  boot();\n})();');
  if (!cs.includes('pm-test-bridge')) throw new Error('bridge injection failed');
  fs.writeFileSync(path.join(EXT_TEST, 'content/content-script.js'), cs);
}

const PAGE_HTML = `<!DOCTYPE html><html><head><style>
body { font-family: sans-serif; font-size: 18px; line-height: 1.8; padding: 60px 80px; }
.dark { background: #171a26; color: #d6d9e8; padding: 20px; border-radius: 10px; }
</style></head><body>
<h1>Test Article</h1>
<p id="p1">The quick brown fox jumps over the lazy dog near the river bank.</p>
<p id="p2">A second paragraph with different words for selection testing today.</p>
<div class="dark"><p id="p3">Dark section with some sample text inside it here.</p></div>
</body></html>`;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗ FAIL:', label, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}

async function pmCmd(page, cmd, arg) {
  return page.evaluate(([c, a]) => new Promise((resolve, reject) => {
    const b = document.getElementById('pm-test-bridge');
    if (!b) return reject(new Error('no bridge'));
    b.setAttribute('data-result', '');
    b.setAttribute('data-cmd', c);
    if (a !== undefined) b.setAttribute('data-arg', JSON.stringify(a)); else b.removeAttribute('data-arg');
    b.dispatchEvent(new CustomEvent('pm-cmd'));
    let tries = 0;
    const iv = setInterval(() => {
      const r = b.getAttribute('data-result');
      if (r) { clearInterval(iv); resolve(JSON.parse(r)); }
      else if (++tries > 150) { clearInterval(iv); reject(new Error('timeout ' + c)); }
    }, 20);
  }), [cmd, arg]);
}

async function clickBox(page, box, label) {
  if (!box || !box.visible) { check(label + ' (visible)', false, box); return false; }
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  return true;
}

async function rangeBoxByText(page, sel, sub) {
  return page.evaluate(([s, t]) => {
    const el = document.querySelector(s);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement && n.parentElement.classList.contains('pm-hl')) continue;
      const i = n.nodeValue.indexOf(t);
      if (i !== -1) {
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + t.length);
        const rect = r.getBoundingClientRect();
        return { left: rect.left, right: rect.right, cy: rect.top + rect.height / 2 };
      }
    }
    return null;
  }, [sel, sub]);
}

async function dragSelect(page, box) {
  await page.mouse.move(box.left + 2, box.cy);
  await page.mouse.down();
  await page.mouse.move((box.left + box.right) / 2, box.cy, { steps: 4 });
  await page.mouse.move(box.right - 2, box.cy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  return page.evaluate(() => getSelection().toString());
}

async function dragSelectText(page, sel, sub) {
  const b = await rangeBoxByText(page, sel, sub);
  if (!b) throw new Error('text not found for drag: ' + sel + ' / ' + sub);
  return dragSelect(page, b);
}

(async () => {
  buildTestExtension();
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE_HTML); });
  await new Promise(r => server.listen(8931, r));

  const context = await chromium.launchPersistentContext('/tmp/pm-profile', {
    headless: true, channel: 'chromium',
    viewport: { width: 1280, height: 900 },
    args: ['--disable-extensions-except=' + EXT_TEST, '--load-extension=' + EXT_TEST, '--no-sandbox']
  });
  await new Promise(r => setTimeout(r, 800));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8931/', { waitUntil: 'load' });
  await page.waitForTimeout(800);

  check('content script running', await page.evaluate(() => !!document.getElementById('pm-test-bridge')));

  /* ===== T1: selection -> toolbar, no auto-highlight ===== */
  console.log('— T1: selection shows toolbar, no auto-highlight —');
  const sel1 = await dragSelectText(page, '#p1', 'quick brown fox');
  let st = await pmCmd(page, 'state');
  check('selection made', sel1.includes('quick brown'), sel1);
  check('toolbar visible', st.toolbarVisible, st);
  check('auto OFF by default', st.settings.autoHighlight === false);
  check('no mark yet', await page.evaluate(() => document.querySelectorAll('span.pm-hl[data-pm-id]').length === 0));

  /* ===== T2: Highlight button -> yellow ===== */
  console.log('— T2: Highlight button (THE propagation fix) —');
  if (await clickBox(page, await pmCmd(page, 'box', { target: 'hlBtn' }), 'hlBtn')) {
    await page.waitForTimeout(400);
    const mi = await page.evaluate(() => {
      const m = document.querySelector('span.pm-hl[data-pm-id]');
      return m && { color: m.getAttribute('data-pm-color'), scheme: m.getAttribute('data-pm-scheme'), bg: getComputedStyle(m).backgroundColor, text: m.textContent };
    });
    check('mark created by button click', !!mi, mi);
    check('default color yellow', mi && mi.color === 'yellow', mi);
    check('computed bg yellow w/ intensity alpha', mi && /^rgba\(255,\s*217,\s*77,\s*0\.5/.test(mi.bg || ''), mi);
  }

  /* ===== T3: green swatch on new selection ===== */
  console.log('— T3: green swatch (yellow-lock fix) —');
  const sel3 = await dragSelectText(page, '#p2', 'cond paragraph');
  st = await pmCmd(page, 'state');
  check('toolbar visible for 2nd selection', st.toolbarVisible, st);
  if (await clickBox(page, await pmCmd(page, 'box', { target: 'swatch:green' }), 'green swatch')) {
    await page.waitForTimeout(400);
    const marks = await page.evaluate(() => Array.from(document.querySelectorAll('span.pm-hl[data-pm-id]')).map(m => ({
      color: m.getAttribute('data-pm-color'), bg: getComputedStyle(m).backgroundColor, text: m.textContent
    })));
    check('two marks now', marks.length === 2, marks);
    const g = marks.find(m => m.text.includes('cond paragraph'));
    check('GREEN applied (yellow-lock fixed)', g && g.color === 'green', g);
    check('green computed bg (green-ish, not yellow)', g && (() => { const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(g.bg || ''); return m && +m[1] < 200 && +m[2] > 200 && +m[3] < 200; })(), g);
  }

  /* ===== T4: last color memory ===== */
  console.log('— T4: last-color memory —');
  st = await pmCmd(page, 'state');
  check('active color remembered green', st.settings.activeColor === 'green', st.settings.activeColor);

  /* ===== T5: custom color + intensity via panel ===== */
  console.log('— T5: custom color & intensity panel —');
  const sel5 = await dragSelectText(page, '#p1', 'near the river');
  if (await clickBox(page, await pmCmd(page, 'box', { target: 'customBtn' }), 'customBtn')) {
    await page.waitForTimeout(150);
    st = await pmCmd(page, 'state');
    check('custom panel opens', st.panelOpen, st);
    await pmCmd(page, 'setPanel', { hex: '#ff6600', intensity: 0.85 });
    if (await clickBox(page, await pmCmd(page, 'box', { target: 'panelApply' }), 'panelApply')) {
      await page.waitForTimeout(400);
      const marks = await page.evaluate(() => Array.from(document.querySelectorAll('span.pm-hl[data-pm-id]')).map(m => ({
        color: m.getAttribute('data-pm-color'), bg: getComputedStyle(m).backgroundColor, text: m.textContent
      })));
      const c = marks.find(m => /river|near/.test(m.text));
      check('custom color applied', c && c.color === '#ff6600', c);
      check('custom bg rgba(255,102,0,0.85)', c && /rgba\(255,\s*102,\s*0,\s*0\.85\)/.test(c.bg || ''), c);
      st = await pmCmd(page, 'state');
      check('active color now custom hex', st.settings.activeColor === '#ff6600', st.settings.activeColor);
      check('settings.intensity saved', Math.abs(st.settings.intensity - 0.85) < 0.01, st.settings.intensity);
    }
  }

  /* ===== T6: popover recolor ===== */
  console.log('— T6: popover recolor to blue —');
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.waitForTimeout(250);
  const markBox = await page.evaluate(() => {
    const m = document.querySelector('span.pm-hl[data-pm-id]');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  check('mark exists to click', !!markBox);
  if (markBox) {
    await page.mouse.click(markBox.x, markBox.y);
    await page.waitForTimeout(350);
    st = await pmCmd(page, 'state');
    check('popover opened', st.popVisible, st);
    if (await clickBox(page, await pmCmd(page, 'box', { target: 'popSwatch:blue' }), 'popover blue')) {
      await page.waitForTimeout(350);
      const c = await page.evaluate(() => document.querySelector('span.pm-hl[data-pm-id]').getAttribute('data-pm-color'));
      check('recolored to blue', c === 'blue', c);
    }
    /* ===== T7: popover intensity slider ===== */
    console.log('— T7: popover intensity —');
    st = await pmCmd(page, 'state');
    if (st.popVisible) {
      await pmCmd(page, 'setPopRange', 0.2);
      await page.waitForTimeout(300);
      const bg = await page.evaluate(() => getComputedStyle(document.querySelector('span.pm-hl[data-pm-id]')).backgroundColor);
      check('intensity 20% applied live', /0\.2/.test(bg), bg);
    } else {
      check('popover still open for intensity test', false, st);
    }
    /* ===== T8: popover DELETE (the delete bug) ===== */
    console.log('— T8: popover delete —');
    if (await clickBox(page, await pmCmd(page, 'box', { target: 'popDelete' }), 'popover delete')) {
      await page.waitForTimeout(500);
      let cnt = await page.evaluate(() => document.querySelectorAll('span.pm-hl[data-pm-id]').length);
      check('mark deleted from DOM', cnt === 2, cnt);
      st = await pmCmd(page, 'state');
      check('record deleted', st.recordIds.length === 2, st.recordIds);
      await page.waitForTimeout(1500);
      cnt = await page.evaluate(() => document.querySelectorAll('span.pm-hl[data-pm-id]').length);
      st = await pmCmd(page, 'state');
      check('stays deleted (no resurrect)', cnt === 2 && st.recordIds.length === 2, { cnt, ids: st.recordIds });
      check('undo toast appeared', st.toastVisible === true, st);
    }
  }

  /* ===== T9: delete via toolbar trash ===== */
  console.log('— T9: toolbar trash delete —');
  const marked = await page.evaluate(() => {
    const m = document.querySelector('span.pm-hl[data-pm-id]');
    return m ? m.textContent : null;
  });
  check('highlight exists to trash', !!marked, marked);
  if (marked) {
    const mbox = await page.evaluate(() => {
      const m = document.querySelector('span.pm-hl[data-pm-id]');
      const r = m.getBoundingClientRect();
      return { left: r.left, right: r.right, cy: r.top + r.height / 2 };
    });
    const sel9 = await dragSelect(page, mbox);
    check('drag-selected the highlight', sel9.trim().length > 0, sel9);
    st = await pmCmd(page, 'state');
    check('toolbar visible w/ trash', st.toolbarVisible, st);
    if (await clickBox(page, await pmCmd(page, 'box', { target: 'removeBtn' }), 'toolbar trash')) {
      await page.waitForTimeout(600);
      let cnt = await page.evaluate(() => document.querySelectorAll('span.pm-hl[data-pm-id]').length);
      check('removed via trash', cnt === 1, cnt);
      await page.waitForTimeout(1200);
      cnt = await page.evaluate(() => document.querySelectorAll('span.pm-hl[data-pm-id]').length);
      check('stays removed', cnt === 1, cnt);
    }
  }

  /* ===== T10: reload persistence ===== */
  console.log('— T10: reload persistence —');
  await dragSelectText(page, '#p2', 'different words');
  await clickBox(page, await pmCmd(page, 'box', { target: 'hlBtn' }), 'hlBtn (green now)');
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const restored = await page.evaluate(() => Array.from(document.querySelectorAll('span.pm-hl[data-pm-id]')).map(m => ({
    color: m.getAttribute('data-pm-color'), bg: getComputedStyle(m).backgroundColor, text: m.textContent
  })));
  check('highlights restored after reload', restored.length === 2, restored);
  const greenRestored = restored.find(m => /cond paragraph|different words/.test(m.text));
  check('green restored with correct look', greenRestored && greenRestored.color === 'green' && (() => { const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(greenRestored.bg || ''); return m && +m[1] < 200 && +m[2] > 200 && +m[3] < 200; })(), greenRestored);

  /* ===== T11: double-click -> toolbar, NO auto highlight ===== */
  console.log('— T11: double-click —');
  const before = await page.evaluate(() => document.querySelectorAll('span.pm-hl[data-pm-id]').length);
  const p2box = await page.locator('#p2').boundingBox();
  await page.mouse.dblclick(p2box.x + 220, p2box.y + 14);
  await page.waitForTimeout(400);
  st = await pmCmd(page, 'state');
  const dblSel = await page.evaluate(() => getSelection().toString());
  check('double-click selected a word', dblSel.length > 0 && !dblSel.includes(' '), dblSel);
  check('toolbar shown after dblclick', st.toolbarVisible, st);
  const after = await page.evaluate(() => document.querySelectorAll('span.pm-hl[data-pm-id]').length);
  check('NO auto highlight on dblclick', after === before, { before, after });

  /* ===== T12: dark section custom scheme ===== */
  console.log('— T12: dark section —');
  const sel12 = await dragSelectText(page, '#p3', 'Dark section');
  check('dark selection made', sel12.includes('Dark'), sel12);
  await clickBox(page, await pmCmd(page, 'box', { target: 'hlBtn' }), 'hlBtn dark');
  await page.waitForTimeout(400);
  const darkInfo = await page.evaluate(() => {
    const marks = Array.from(document.querySelectorAll('span.pm-hl[data-pm-id]'));
    const m = marks.find(x => x.textContent.includes('Dark'));
    return m && { scheme: m.getAttribute('data-pm-scheme'), bg: getComputedStyle(m).backgroundColor };
  });
  check('dark scheme detected', darkInfo && darkInfo.scheme === 'dark', darkInfo);
  check('dark section: strong custom color w/ adjusted alpha', darkInfo && (() => { const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(darkInfo.bg || ''); return m && +m[1] > 200 && +m[1] > +m[2] && +m[2] > +m[3] && +m[4] > 0.5; })(), darkInfo);

  console.log('');
  console.log('E2E RESULT:', pass, 'passed,', fail, 'failed');
  if (errors.length) console.log('page errors:', errors.slice(0, 5));
  await context.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E CRASH:', e); process.exit(2); });
