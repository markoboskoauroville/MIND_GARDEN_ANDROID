#!/usr/bin/env node
// Mind Garden device test: one script, any Android device or emulator, no AI involved while it runs.
// Copied from kognius_app (v12) on 22.11.2026 and kept here: it needs the DEBUG variant (test/mindgarden-v<N>-debug.apk in the
// files repo), because the release cannot be attached over adb. Updated for the web home page (language row, version label in the hero).
// Needs only Node 22+ and adb. Drives the installed app through its WebView debugging port (real touch events)
// and writes a report (JSON + Markdown + screenshots).
//
//   node tests/device/run.js --serial <adb serial> --label <name> --apk <path> [--out reports] [--force] [--quick] [--keep]
//
// --force  run even if the Claude app is in front on that device (default: skip, so a chat is never interrupted)
// --quick  shorter run (skips the long practice and wrong-answer passes)
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const SERIAL = arg('serial'), LABEL = arg('label', SERIAL), APK = arg('apk'), OUT = path.join(arg('out', 'reports'), String(LABEL));
const FORCE = !!arg('force', false), QUICK = !!arg('quick', false);
const KEEP = !!arg('keep', false);   // --keep: the app is already installed with someone's data: no install, no pm clear; the test user is added beside the others and removed at the end
const ADB = process.env.ADB || 'adb';
const PKG = 'app.mindgarden';
if (!SERIAL || !APK) { console.error('usage: run.js --serial S --label L --apk file.apk'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const adb = (...a) => { try { return execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return 'ADBERR ' + (e.stdout || '') + (e.stderr || e.message); } };
const sh = (...a) => adb('shell', ...a).trim();

const report = { label: LABEL, serial: SERIAL, started: new Date().toISOString(), device: {}, tests: [], issues: [], jsErrors: [], status: 'running' };
const issue = (screen, kind, detail) => { if (!report.issues.some(i => i.kind === kind && i.detail === detail)) report.issues.push({ screen, kind, detail }); };
function finish(status, why) {
  report.status = status; if (why) report.why = why; report.finished = new Date().toISOString();
  const pass = report.tests.filter(t => t.ok).length, fail = report.tests.filter(t => !t.ok).length;
  report.summary = { pass, fail, issues: report.issues.length, jsErrors: report.jsErrors.length };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const d = report.device;
  let md = `# Mind Garden test report: ${LABEL}\n\n` +
    `- Status: **${status}**${why ? ' (' + why + ')' : ''}\n- Device: ${d.model || '?'}, Android ${d.android || '?'} (SDK ${d.sdk || '?'}), screen ${d.screen || '?'}, WebView ${d.webview || '?'}\n` +
    `- App version: ${d.appVersion || '?'}\n- Started ${report.started}, finished ${report.finished}\n- Tests: ${pass} passed, ${fail} failed. Screen issues: ${report.issues.length}. JavaScript errors: ${report.jsErrors.length}.\n\n` +
    `| # | Test | Result | Seconds | Detail |\n|---|---|---|---|---|\n` +
    report.tests.map((t, i) => `| ${i + 1} | ${t.name} | ${t.ok ? 'pass' : '**FAIL**'} | ${t.secs} | ${String(t.detail || '').replace(/\|/g, '/').slice(0, 300)} |`).join('\n') + '\n';
  if (report.issues.length) md += `\n## Screen issues\n` + report.issues.map(i => `- [${i.kind}] ${i.screen}: ${i.detail}`).join('\n') + '\n';
  if (report.jsErrors.length) md += `\n## JavaScript errors\n` + report.jsErrors.slice(0, 30).map(e => '- ' + e).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  console.log(`[${LABEL}] ${status}: ${pass} passed, ${fail} failed, ${report.issues.length} screen issues, ${report.jsErrors.length} JS errors -> ${OUT}/report.md`);
  process.exit(status === 'done' && fail === 0 ? 0 : 1);
}

// ---------- CDP over the WebView debugging socket ----------
let ws, msgId = 0; const pending = new Map();
let PORT = 9300 + Math.floor(Math.random() * 600);
async function connect() {
  let pid = '';
  for (let i = 0; i < 40 && !pid; i++) { pid = sh('pidof', PKG).split(' ')[0]; if (!pid) await sleep(500); }
  if (!pid || pid.startsWith('ADBERR')) throw new Error('app process not found');
  let sock = '';
  for (let i = 0; i < 40 && !sock; i++) { const m = sh('cat', '/proc/net/unix').match(new RegExp('webview_devtools_remote_' + pid)); sock = m ? m[0] : ''; if (!sock) await sleep(500); }
  if (!sock) throw new Error('WebView debugging socket not found (app must be built with debugging on)');
  adb('forward', 'tcp:' + PORT, 'localabstract:' + sock);
  let url = '';
  for (let i = 0; i < 40 && !url; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const p = j.find(x => x.type === 'page' && x.url.includes('index.html')); if (p) url = p.webSocketDebuggerUrl; } catch (e) { /* not yet */ }
    if (!url) await sleep(500);
  }
  if (!url) throw new Error('no page on the debugging port');
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket failed')); });
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') report.jsErrors.push((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text || '').slice(0, 300));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') report.jsErrors.push('console.error: ' + d.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 300));
  };
  await cdp('Runtime.enable'); await cdp('Page.enable');
}
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP timeout ' + method)); } }, 30000); });
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
}
async function waitFor(expr, ms = 8000, what) {
  const t0 = Date.now();
  for (;;) { const v = await ev(expr); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + (what || expr)); await sleep(150); }
}
// a real touch on the element's centre (scrolls it into view first)
async function tap(sel, delay = 620) {
  await sleep(delay);
  const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  if (!r) throw new Error('element not found: ' + sel);
  await sleep(120);
  const r2 = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r2.x, y: r2.y }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(180);
}
// like tap(), but does not wait for the page: used when the click opens a native dialog (confirm() blocks the page until answered)
async function tapDialog(sel, delay = 620) {
  await sleep(delay);
  const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  if (!r) throw new Error('element not found: ' + sel);
  await sleep(120);
  const r2 = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r2.x, y: r2.y }] });
  cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => { /* answered later or timed out: the dialog is what we test */ });
  await sleep(500);
}
let shotN = 0;
async function shot(name) {
  try { const r = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 55 }); fs.writeFileSync(path.join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.jpg`), Buffer.from(r.data, 'base64')); } catch (e) { /* screenshots are optional */ }
}
// what a person would notice: text cut off sideways, unreadable contrast, tiny buttons, broken text
const audited = new Set();
async function audit(screen) {
  if (audited.has(screen)) return; audited.add(screen);
  const r = await ev(`(()=>{
    const out={overflow: document.documentElement.scrollWidth > window.innerWidth + 2, low:[], small:[], bad:[], off:[]};
    const lum=c=>{const m=c.match(/[\\d.]+/g).map(Number); const f=v=>{v/=255; return v<=0.03928? v/12.92: Math.pow((v+0.055)/1.055,2.4)}; return {l:0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]), a: m.length>3? m[3]:1}};
    const bgOf=e=>{ for(let n=e;n;n=n.parentElement){ const s=getComputedStyle(n); if(s.backgroundImage && s.backgroundImage!=='none') return null; const b=lum(s.backgroundColor); if(b.a>0.9) return b.l; } return lum(getComputedStyle(document.body).backgroundColor).l; };
    for(const e of document.querySelectorAll('#app *')){
      if(e.namespaceURI==='http://www.w3.org/2000/svg') continue; // drawings carry their own colours
      const r=e.getBoundingClientRect(); if(r.width<2||r.height<2) continue;
      const own=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').trim();
      if(own){
        if(/undefined|NaN|\\[object/.test(own)) out.bad.push(own.slice(0,40));
        if(/[A-Za-z0-9čćšžđ]/.test(own)){ const bg=bgOf(e); if(bg!==null){ const fg=lum(getComputedStyle(e).color).l; const ratio=(Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05); if(ratio<3) out.low.push(own.slice(0,30)+' ('+ratio.toFixed(1)+')'); } }
        if(r.right>window.innerWidth+2||r.left<-2) out.off.push(own.slice(0,30));
      }
      if(e.tagName==='BUTTON' && (r.width<40||r.height<36)) out.small.push((e.innerText||e.className).trim().slice(0,20)+' '+Math.round(r.width)+'x'+Math.round(r.height));
    }
    for(const k of ['low','small','bad','off']) out[k]=[...new Set(out[k])].slice(0,6);
    return out; })()`);
  if (r.overflow) issue(screen, 'sideways-scroll', 'page is wider than the screen');
  r.low.forEach(x => issue(screen, 'hard-to-read', x));
  r.small.forEach(x => issue(screen, 'small-button', x));
  r.bad.forEach(x => issue(screen, 'broken-text', x));
  r.off.forEach(x => issue(screen, 'text-off-screen', x));
}

// another window on top (system pop-up, incoming call) pauses the app: bring it back before each test
let frontFn = null;
async function ensureFront() {
  if (!frontFn) return;
  let f = frontFn(); if (f === PKG) return;
  issue('device', 'interrupted', 'another window came to the front: ' + f);
  sh('input', 'keyevent', '4'); await sleep(700); sh('am', 'start', '-n', PKG + '/.MainActivity'); await sleep(1500);
}
async function test(name, fn) {
  await ensureFront();
  const t0 = Date.now(); let ok = true, detail = '';
  try { detail = await fn(); } catch (e) { ok = false; detail = e.message; await shot('FAIL-' + name.replace(/\W+/g, '-').slice(0, 30)); }
  report.tests.push({ name, ok, secs: Math.round((Date.now() - t0) / 1000), detail: detail || '' });
  console.log(`[${LABEL}] ${ok ? 'pass' : 'FAIL'}  ${name}  ${detail || ''}`);
  if (!ok) { try { await ev(`window.__mgApp.go('home')`); } catch (e) { /* app may be gone */ } }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---------- the new test engine (original + generated tests) ----------
async function playTest(slug, mode, opts = {}) {
  await ev(`window.__mgApp.go('home')`);
  await tap(`[data-test="${slug}"]`); await audit('intro ' + slug);
  await tap('#go');
  let right = 0, scored = 0, waited = 0, cards = 0;
  for (let guard = 0; guard < 150; guard++) {
    const st = await ev(`(()=>{const R=window.__mgTests.R; const s=R&&R.test.steps[R.i]; if(!s||document.querySelector('.scorebig')) return {done:true};
      return {i:R.i,type:s.type,ans:s.answer,ids:s.options?s.options.map(o=>o.id):[],kind:s.card&&s.card.kind,ms:s.config&&s.config.auto_advance_ms,ordered:!!s.ordered}})()`);
    if (st.done) break;
    await audit(`${slug} ${st.type}${st.kind ? ' ' + st.kind : ''}`);
    if (st.type === 'memory_card') {
      cards++;
      if (waited < (opts.waitCards || 0) || (opts.waitKinds || []).includes(st.kind)) {
        // let the card run out by itself, as Grandma would
        if (waited === 0) await shot(slug + '-card-' + st.kind);
        await waitFor(`window.__mgTests.R.i > ${st.i}`, (st.ms || 10000) + 4000, 'memory card to move on by itself');
        waited++; if (opts.waitKinds) opts.waitKinds = opts.waitKinds.filter(k => k !== st.kind);
      } else await tap('#skip');
      continue;
    }
    if (st.type !== 'info') {
      let pick;
      if (st.ans === undefined || st.ans === null) pick = [st.ids[Math.min(2, st.ids.length - 1)]];
      else {
        pick = Array.isArray(st.ans) ? st.ans.slice() : [st.ans];
        const wrong = mode === 'wrong' || (mode === 'mixed' && st.i % 3 === 0);
        scored++;
        if (wrong) pick = [st.ids.find(id => !pick.includes(id))]; else right++;
      }
      for (const id of pick) await tap(`.qe-opt[data-k="${st.ids.indexOf(id)}"]`);
      await waitFor(`!document.querySelector('#nx').disabled`, 4000, 'Next to become active after answering');
    }
    await tap('#nx');
  }
  await waitFor(`!!document.querySelector('.scorebig')`, 8000, 'results screen');
  await audit('results ' + slug); await shot(slug + '-results');
  const res = await ev(`({big: document.querySelector('.scorebig').innerText.trim(), line: (document.querySelector('.mg-card p')||{}).innerText||'', ok: document.querySelectorAll('.mg-card.rev.ok').length, no: document.querySelectorAll('.mg-card.rev.no').length})`);
  return { ...res, right, scored, waited, cards };
}

// ---------- the practice engine and games ----------
async function playPractice(cat, n = 10) {
  await ev(`window.__mgApp.go('home')`);
  await tap(`[data-cat="${cat}"]`);
  for (let i = 0; i < n; i++) {
    await waitFor(`!!document.querySelector('.opt') || !!document.querySelector('#ready')`, 6000, 'practice question');
    if (await ev(`!!document.querySelector('#ready')`)) { await audit('practice ' + cat + ' memory card'); await tap('#ready', 400); }
    await waitFor(`!!document.querySelector('.opt')`, 6000, 'practice options');
    await audit('practice ' + cat); if (i === 0) await shot('practice-' + cat);
    const k = await ev(`(()=>{const q=window.__mg.Q.q; const qq=q.kind==='memory'?q.question:q; return qq.options.findIndex(o=>o.correct)})()`);
    await tap(`.opt[data-k="${k}"]`, 300);
    await waitFor(`!!document.querySelector('#nx')`, 4000, 'Next after a practice answer');
    await tap('#nx', 300);
  }
  await waitFor(`!!document.querySelector('#again')`, 6000, 'practice result screen');
  await audit('practice results');
  return await ev(`(document.querySelector('.stars')||{}).innerText + ' level ' + window.__mg.S.levels[${JSON.stringify(cat)}]`);
}

(async () => {
  // ---------- device checks ----------
  const state = adb('get-state').trim();
  if (state !== 'device') return finish('skipped', 'device not reachable over adb: ' + state.slice(0, 80));
  const d = report.device;
  d.model = sh('getprop', 'ro.product.model'); d.android = sh('getprop', 'ro.build.version.release'); d.sdk = sh('getprop', 'ro.build.version.sdk');
  d.screen = (sh('wm', 'size').match(/(\d+x\d+)\s*$/) || [])[1]; d.abi = sh('getprop', 'ro.product.cpu.abi');
  d.webview = (sh('dumpsys', 'webviewupdate').match(/Current WebView package[^\n]*\((.*?)\)/) || [])[1] || '';
  if (+d.sdk < 26) return finish('skipped', 'Android older than 8 (SDK ' + d.sdk + ')');
  const front = () => (sh('dumpsys', 'window').match(/mCurrentFocus=.*? ([\w.]+)\//) || [])[1] || '';
  frontFn = front;
  if (!FORCE && /anthropic|claude/i.test(front())) return finish('skipped', 'the Claude app is in front on this device; run again when it is not, or with --force');
  sh('input', 'keyevent', 'KEYCODE_WAKEUP'); await sleep(800);
  if (/mWakefulness=(Asleep|Dozing)/.test(sh('dumpsys', 'power'))) return finish('skipped', 'screen is off');
  const locked = () => /mDreamingLockscreen=true|isKeyguardShowing=true|mShowingLockscreen=true|KeyguardShowing=true/i.test(sh('dumpsys', 'window'));
  if (locked()) { sh('wm', 'dismiss-keyguard'); sh('input', 'keyevent', '82'); await sleep(1200); }
  if (locked()) return finish('skipped', 'device is locked; unlock it and run again');

  // ---------- install and start ----------
  if (!KEEP) {
    let inst = adb('install', '-r', APK);
    if (!/Success/.test(inst)) { adb('uninstall', PKG); inst = adb('install', APK); }
    if (!/Success/.test(inst)) return finish('failed', 'install failed: ' + inst.slice(0, 200));
  }
  d.appVersion = (sh('dumpsys', 'package', PKG).match(/versionName=(\S+)/) || [])[1];
  if (!KEEP) sh('pm', 'clear', PKG);
  const launch = async () => { sh('am', 'start', '-n', PKG + '/.MainActivity'); await sleep(1500);
    // something else on top (a system pop-up) pauses the app: send Back once and start again
    if (front() !== PKG) { sh('input', 'keyevent', '4'); await sleep(800); sh('am', 'start', '-n', PKG + '/.MainActivity'); await sleep(1500); }
    if (front() !== PKG) throw new Error('another window stays in front: ' + front());
    await connect(); await waitFor(`!!document.querySelector('#app') && document.querySelector('#app').children.length > 0 && !!window.__mgApp && !!window.__mgApp.go`, 15000, 'the app to draw its first screen'); };
  try { await launch(); } catch (e) { return finish('failed', 'could not start or attach to the app: ' + e.message); }

  let SHARE = false;
  // ---------- tests ----------
  // language switch since v12: home chip -> language screen -> [data-l]
  const uidx = name => ev(`[...document.querySelectorAll('.uname')].findIndex(b=>b.innerText.trim()===${JSON.stringify(name)})`);
  const setLang = async L => { await ev(`window.__mgApp.go('home')`); await waitFor(`!!document.querySelector('[data-lb="${L}"]')`, 4000, 'language row'); if (!(await ev(`window.I18N.lang==='${L}'`))) await tap(`[data-lb="${L}"]`, 300); await waitFor(`window.I18N.lang==='${L}' && !!document.querySelector('[data-test]')`, 5000, L); };   // the language row on the home page (web v7+) replaced #langChip
  await test('First start: Who is playing, create a user, then the language', async () => {
    await waitFor(`!!document.querySelector('#uname')`, 6000, 'the "Who is playing?" screen'); await audit('who is playing'); await shot('users');
    await ev(`(()=>{const i=document.getElementById('uname'); i.value='Test A'; i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await tap('#uadd');
    await waitFor(`!!document.querySelector('[data-l="hr"]')`, 6000, 'language buttons'); await audit('language choice'); await shot('language');
    expect(await ev(`document.querySelectorAll('[data-l]').length`) === 6, 'the language screen does not show six languages');
    await tap('[data-l="hr"]');
    await waitFor(`!!document.querySelector('[data-test]')`, 6000, 'home screen with the tests');
    expect(await ev(`window.I18N.lang`) === 'hr', 'language is not Croatian after choosing Hrvatski');
    return 'Croatian chosen';
  });
  await test('Home shows the 5 tests, title not covered', async () => {
    await audit('home'); await shot('home');
    const r = await ev(`(()=>{const a=document.querySelector('.hero h1'), b=document.querySelector('.langsw'); const range=document.createRange(); range.selectNodeContents(a); const ra=range.getBoundingClientRect(), rb=b.getBoundingClientRect();
      return {tests: document.querySelectorAll('[data-test]').length, overlap: !(ra.right<=rb.left||ra.left>=rb.right||ra.bottom<=rb.top||ra.top>=rb.bottom), cats: document.querySelectorAll('[data-cat]').length, games: document.querySelectorAll('[data-game]').length}})()`);
    SHARE = await ev(`!window.ORIGINAL_TESTS`);
    expect(r.tests === (SHARE ? 2 : 5), 'expected ' + (SHARE ? 2 : 5) + ' tests on home, found ' + r.tests);
    if (SHARE) expect(await ev(`document.querySelectorAll('img').length`) === 0, 'share build still shows pictures from the original');
    expect(!r.overlap, 'the user and language chips cover the title');
    const ver = await ev(`(()=>{const e=document.getElementById('ver'), h=document.querySelector('.hero'); if(!e||!h) return null; const r=e.getBoundingClientRect(), q=h.getBoundingClientRect(); return {t:e.innerText, left:r.left-q.left, top:r.top-q.top}})()`);   // since the web's language row the label sits at the top left of the hero card, not of the screen
    expect(ver && ver.t === d.appVersion && ver.left < 60 && ver.top < 80, 'version label at the top left of the hero card should read ' + d.appVersion + ', found ' + JSON.stringify(ver));
    expect(r.cats === 7 && r.games === 3, `practice ${r.cats}/7, games ${r.games}/3`);
    return (SHARE ? 'share build: 2 own tests' : '5 tests') + ', 7 practice, 3 games';
  });
  if (!SHARE) await test('Original IQ test, all right answers', async () => {
    const r = await playTest('iq-test', 'right');
    expect(r.line.includes('25') && r.no === 0 && r.ok === 25, `expected 25 of 25, screen says "${r.line}" (${r.ok} right, ${r.no} wrong marks)`);
    return `score ${r.big}, ${r.line}`;
  });
  if (!SHARE) await test('Original memory test, first card runs out by itself', async () => {
    const r = await playTest('memory-test', 'right', { waitCards: 1 });
    expect(r.waited === 1, 'the card did not move on by itself');
    expect(r.ok === 18 && r.no === 0, `expected 18 of 18, got ${r.ok} right, ${r.no} wrong ("${r.line}")`);
    return `${r.big}, ${r.line}, ${r.cards} cards`;
  });
  if (!SHARE) await test('Mental age test gives an age', async () => {
    const r = await playTest('mental-age', 'right');
    expect(+r.big >= 18 && +r.big <= 78, 'age out of range: ' + r.big);
    return 'age ' + r.big;
  });
  await test('New IQ test, all right answers', async () => {
    const r = await playTest('iq-new', 'right');
    expect(r.ok === 24 && r.no === 0, `expected 24 of 24, got ${r.ok} right, ${r.no} wrong`);
    return `score ${r.big}, ${r.line}`;
  });
  await test('New memory test, every third answer wrong, order card runs by itself', async () => {
    const r = await playTest('memory-new', 'mixed', { waitKinds: ['order_path'], waitCards: SHARE ? 1 : 0 });
    expect(r.ok === r.right && r.no === r.scored - r.right, `answered ${r.right} of ${r.scored} right, app shows ${r.ok} right and ${r.no} wrong`);
    return `${r.ok} right, ${r.no} wrong, as answered; ${r.line}`;
  });
  if (!QUICK && !SHARE) await test('Original IQ test, all wrong answers', async () => {
    const r = await playTest('iq-test', 'wrong');
    expect(r.ok === 0 && r.no === 25, `expected 0 of 25, got ${r.ok} right, ${r.no} wrong`);
    return `score ${r.big}, ${r.line}`;
  });
  for (const cat of (QUICK ? ['matrix', 'clock'] : ['sequence', 'matrix', 'odd', 'memory', 'math', 'clock', 'count'])) {
    await test('Practice: ' + cat, async () => { /* a round is always 10 questions: --quick used to answer 4, then wait for a result screen that never came */ const r = await playPractice(cat, 10); expect(/level [2-5]/.test(r) || QUICK, 'level did not go up: ' + r); return r; });
  }
  await test('Brain check, 20 mixed questions', async () => {
    await ev(`window.__mgApp.go('home')`); await tap('#bc');
    for (let i = 0; i < 20; i++) {
      await waitFor(`!!document.querySelector('.opt') || !!document.querySelector('#ready')`, 6000, 'question');
      if (await ev(`!!document.querySelector('#ready')`)) await tap('#ready', 400);
      await waitFor(`!!document.querySelector('.opt')`, 6000, 'options');
      const k = await ev(`(()=>{const q=window.__mg.Q.q; const qq=q.kind==='memory'?q.question:q; return qq.options.findIndex(o=>o.correct)})()`);
      await tap(`.opt[data-k="${k}"]`, 300); await waitFor(`!!document.querySelector('#nx')`, 4000, 'Next'); await tap('#nx', 300);
    }
    await waitFor(`!!document.querySelector('.scorebig')`, 6000, 'brain check result'); await audit('brain check results'); await shot('braincheck-results');
    const s = await ev(`document.querySelector('.scorebig').innerText.trim()`);
    expect(s === '100', 'expected 100, got ' + s); return 'score 100';
  });
  await test('Game: find the pairs', async () => {
    await ev(`window.__mgApp.go('pairs')`); await tap('[data-d="6"]', 400); await audit('pairs');
    for (let i = 0; i < 12; i++) {
      if (await ev(`document.querySelector('.pcard[data-i="${i}"]').classList.contains('done')`)) continue;
      await tap(`.pcard[data-i="${i}"]`, 150);
      const e = await ev(`document.querySelector('.pcard[data-i="${i}"]').textContent`);
      for (let j = i + 1; j < 12; j++) {
        if (await ev(`document.querySelector('.pcard[data-i="${j}"]').classList.contains('done')`)) continue;
        await tap(`.pcard[data-i="${j}"]`, 150);
        if (await ev(`document.querySelector('.pcard[data-i="${j}"]').classList.contains('done')`)) break;
        await sleep(1300); await tap(`.pcard[data-i="${i}"]`, 100);
      }
    }
    await waitFor(`!!document.querySelector('#win .feedback')`, 5000, 'the win message'); await shot('pairs-won');
    return await ev(`document.querySelector('#win .feedback').innerText`);
  });
  await test('Game: spot the colour', async () => {
    await ev(`window.__mgApp.go('color')`); await audit('colour game');
    for (let r = 0; r < 4; r++) {
      const odd = await ev(`(()=>{const t=[...document.querySelectorAll('.ctile')].map(b=>b.style.background); const c={}; t.forEach(x=>c[x]=(c[x]||0)+1); return t.findIndex(x=>c[x]===1)})()`);
      expect(odd >= 0, 'no odd tile found'); await tap(`.ctile[data-i="${odd}"]`, 250);
    }
    const s = await ev(`document.querySelector('.row span').innerText`); expect(/4/.test(s), 'score after 4 right taps: ' + s); await shot('colour');
    return s;
  });
  await test('Game: repeat the tune', async () => {
    await ev(`window.__mgApp.go('simon')`); await audit('tune game'); await tap('#go', 400);
    for (let round = 1; round <= 2; round++) {
      await waitFor(`/turn|redu/.test(document.getElementById('st').textContent)`, 20000, 'my turn in round ' + round);
      const seq = await ev(`window.__mgSimon.slice()`); expect(seq.length === round, `round ${round} has ${seq.length} notes`);
      for (const p of seq) await tap(`.spad[data-i="${p}"]`, 350);
      await waitFor(`!/turn|redu/.test(document.getElementById('st').textContent)`, 6000, 'round to end');
    }
    await waitFor(`/turn|redu/.test(document.getElementById('st').textContent)`, 20000, 'my turn in round 3');
    const w = await ev(`(window.__mgSimon[0]+1)%4`); await tap(`.spad[data-i="${w}"]`, 350);
    await waitFor(`!!document.querySelector('#again')`, 5000, 'game over');
    return await ev(`document.querySelector('#msg .feedback').innerText`);
  });
  // ---------- Languages games (v12) ----------
  const lgStart = async n => { await ev(`window.__mgApp.go('home')`); await tap(`[data-lg="lang${n}"]`, 400); await audit('languages game ' + n); };
  const lgDone = async (n, pct) => { await waitFor(`!!document.querySelector('.scorebig')`, 6000, 'result of Languages game ' + n); await audit('languages result ' + n); await shot('lang' + n + '-result');
    const b = await ev(`document.querySelector('.scorebig').innerText.trim()`); expect(b === pct, `Languages game ${n}: expected ${pct}, got ${b}`); return b; };
  await test('Languages game 1: Meet the friends, all right', async () => {
    await lgStart(1); await tap('#nx'); for (let i = 0; i < 6; i++) await tap('#nx');
    for (let i = 0; i < 6; i++) { const k = await ev(`window.__mgLang.G.order[window.__mgLang.G.i]`); await tap(`[data-f="${k}"]`, 300); await tap('#nx', 300); }
    return await lgDone(1, '100%');
  });
  await test('Languages game 2: Which language is it, all right', async () => {
    await lgStart(2);
    for (let i = 0; i < 10; i++) { const k = await ev(`window.__mgLang.G.qs[window.__mgLang.G.i].f`); await tap(`[data-f="${k}"]`, 300); await tap('#nx', 300); }
    return await lgDone(2, '100%');
  });
  await test('Languages game 3: Find the word, all right', async () => {
    await lgStart(3);
    for (let i = 0; i < 10; i++) { const k = await ev(`(()=>{const G=window.__mgLang.G,q=G.qs[G.i],w=window.MGLang.word(q.c, window.MGLang.FRIENDS[q.f].l); return [...document.querySelectorAll('[data-w]')].findIndex(b=>b.innerText.trim()===w)})()`); expect(k >= 0, 'right word not on screen'); await tap(`[data-w="${k}"]`, 300); await tap('#nx', 300); }
    return await lgDone(3, '100%');
  });
  await test('Languages game 4: We build together, all right', async () => {
    await lgStart(4);
    for (let r = 0; r < 3; r++) {
      for (let f = 0; f < 6; f++) {
        const k = await ev(`(()=>{const G=window.__mgLang.G,c=G.concepts[G.r],w=window.MGLang.word(c,window.MGLang.FRIENDS[${f}].l); const b=[...document.querySelectorAll('[data-pick]')].find(b=>b.innerText.trim()===w); return b?b.dataset.pick:-1})()`);
        expect(k >= 0, 'word for friend ' + f + ' not on screen');
        await tap(`[data-pick="${k}"]`, 250); await tap(`[data-fr="${f}"]`, 250);
      }
      await tap('#nx', 300);
    }
    return await lgDone(4, '100%');
  });
  await test('Languages games: every word has a playable recording in its own language', async () => {
    const r = await ev(`(async()=>{const M=window.MGLang; let n=0, ok=0, miss=[]; for(const c of Object.keys(M.V)) for(const f of M.FRIENDS){ const w=M.word(c,f.l); n++; if(!window.MGSpeech.has(f.l,w)) { miss.push(f.l+':'+w); continue; } const a=new Audio('audio/'+f.l+'/'+window.MGSpeech.key(w)+'.mp3'); const d=await new Promise(res=>{a.onloadedmetadata=()=>res(a.duration); a.onerror=()=>res(0); setTimeout(()=>res(0),5000)}); if(d>0.1) ok++; else miss.push(f.l+':'+w+' (does not load)'); } return {n,ok,miss:miss.slice(0,8)}})()`);
    expect(r.ok === r.n, `${r.ok} of ${r.n} words playable; e.g. ${r.miss.join(', ')}`); return `${r.ok} of ${r.n} words playable`;
  });
  await test('Progress and settings screens', async () => {
    await ev(`window.__mgApp.go('progress')`); await sleep(400); await audit('progress'); await shot('progress');
    await ev(`window.__mgApp.go('settings')`); await sleep(400); await audit('settings'); await shot('settings');
    await tap('[data-set="fs"][data-v="huge"]', 300); await ev(`window.__mgApp.go('home')`); await sleep(300); audited.delete('home'); await audit('home with very large text'); await shot('home-huge-text');
    const big = await ev(`document.body.classList.contains('fs-huge')`); expect(big, 'very large text did not apply');
    await ev(`window.__mgApp.go('testIntro', window.ORIGINAL_TESTS ? 'memory-test' : 'memory-new')`); await tap('#go'); await tap('#nx'); await audit('memory card with very large text'); await shot('card-huge-text');
    await ev(`window.__mgApp.go('settings')`); await tap('[data-set="fs"][data-v="large"]', 300);
    return 'opened; very large text applies';
  });
  await test('English: switch and back', async () => {
    await setLang('en');
    const h = await ev(`document.querySelector('h2').innerText`); expect((SHARE ? /New every time/ : /^Tests$/).test(h.trim()), 'home heading in English is: ' + h);   // web v7: 'Tests from the original' became 'Tests'
    audited.delete('home'); await audit('home (English)'); await shot('home-english');
    await ev(`window.__mgApp.go('testIntro', window.ORIGINAL_TESTS ? 'iq-test' : 'iq-new')`); await tap('#go'); await tap('#nx');
    const q = await ev(`document.querySelector('.qe-title').innerText`); expect(/Which item is odd/.test(q), 'first IQ question in English is: ' + q);
    await setLang('hr');
    return 'English texts shown, back to Croatian';
  });
  await test('German: switch and back', async () => {
    await setLang('de');
    audited.delete('home'); await audit('home (German)'); await shot('home-german');
    await ev(`window.__mgApp.go('testIntro', window.ORIGINAL_TESTS ? 'iq-test' : 'iq-new')`); await tap('#go'); await tap('#nx');
    const q = await ev(`document.querySelector('.qe-title').innerText`); expect(/Was passt nicht dazu/.test(q), 'first IQ question in German is: ' + q);
    await audit('question (German)');
    await setLang('hr');
    return 'German texts shown, back to Croatian';
  });
  await test('Read aloud: speaker button and recordings in 3 languages', async () => {
    const out = [];
    for (const L of ['hr', 'en', 'de']) {
      await setLang(L);
      await ev(`window.__mgApp.go('testIntro', window.ORIGINAL_TESTS ? 'iq-test' : 'iq-new')`); await tap('#go'); await tap('#nx');
      expect(await ev(`!!document.querySelector('#spk')`), 'no speaker button on the first question in ' + L);
      const n = await ev(`Object.keys(window.MG_AUDIO.${L}).length`); expect(n > (SHARE ? 300 : 400), L + ' has only ' + n + ' recordings');
      // every spoken part of this question must have a file that really loads and has a length
      const r = await ev(`(async()=>{const list=[...document.querySelectorAll('[data-say]')].map(e=>e.getAttribute('data-say')).filter(t=>window.MGSpeech.has('${L}',t)); let ok=0, dur=0; for(const t of list){ const a=new Audio('audio/${L}/'+window.MGSpeech.key(t)+'.mp3'); const d=await new Promise(res=>{a.onloadedmetadata=()=>res(a.duration); a.onerror=()=>res(0); setTimeout(()=>res(0),5000)}); if(d>0.2){ok++; dur+=d} } return {n:list.length, ok, dur}})()`);
      expect(r.ok === r.n && r.n >= 5, `${L}: ${r.ok} of ${r.n} texts have a playable recording`);
      // the guide: the question is outlined first, then the answers one after another
      await tap('#spk', 300);
      const seen = [];
      for (let i = 0; i < 80 && seen.length < 3; i++) { const c = await ev(`(()=>{const e=document.querySelector('.spoken'); return e ? (e.className.split(' ')[0] + ':' + (e.dataset.k||'')) : ''})()`); if (c && seen[seen.length - 1] !== c) seen.push(c); await sleep(150); }
      expect(seen.length >= 3 && /qe-title/.test(seen[0]) && seen.some(x => /qe-opt/.test(x)), L + ': outline did not move from the question to the answers: ' + seen.join(' > '));
      await tap('#spk', 200); await sleep(300);
      expect(!(await ev(`!!document.querySelector('.spoken')`)), L + ': second tap on the speaker did not stop the guide');
      out.push(`${L}: ${n} files, question + ${r.n - 2} answers = ${r.dur.toFixed(0)} s`);
    }
    await setLang('hr'); await shot('speaker');
    return out.join('; ');
  });
  await test('Home guide: speaker reads the page and outlines each item', async () => {
    await ev(`window.__mgApp.go('home')`); await sleep(400);
    expect(await ev(`!!document.querySelector('#spkHome')`), 'no speaker beside the title on the first page');
    await tap('#spkHome', 300);
    const seen = [];
    for (let i = 0; i < 140 && !seen.some(x => /^test:/.test(x)); i++) { const c = await ev(`(()=>{const e=document.querySelector('.spoken'); return e ? (e.dataset.test ? 'test:' + e.dataset.test : e.tagName) : ''})()`); if (c && seen[seen.length - 1] !== c) seen.push(c); await sleep(150); }
    expect(seen.some(x => /^test:/.test(x)), 'the outline never reached a test card: ' + seen.join(' > '));
    await shot('home-guide');
    await tap('#spkHome', 200); await sleep(300);
    expect(!(await ev(`!!document.querySelector('.spoken')`)), 'second tap did not stop the guide');
    return 'outlined in order: ' + seen.join(' > ');
  });
  await test('Phone back button returns to home', async () => {
    await ev(`window.__mgApp.go('testIntro', window.ORIGINAL_TESTS ? 'iq-test' : 'iq-new')`); await sleep(500);
    sh('input', 'keyevent', '4'); await sleep(1200);
    expect(await ev(`!!document.querySelector('.hero')`), 'back did not return to the home screen');
    expect(front() === PKG, 'the app closed instead of going home');
    return 'home shown, app still open';
  });
  // native dialogs (the WebView's confirm() becomes an Android AlertDialog): found through uiautomator, tapped by their bounds
  const nativeTap = async label => {
    for (let i = 0; i < 12; i++) {
      adb('shell', 'uiautomator', 'dump', '/sdcard/mg_ui.xml'); const xml = adb('shell', 'cat', '/sdcard/mg_ui.xml');
      const m = [...xml.matchAll(/<node[^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)].find(x => x[1].toUpperCase() === label);
      if (m) { sh('input', 'tap', String(Math.round((+m[2] + +m[4]) / 2)), String(Math.round((+m[3] + +m[5]) / 2))); await sleep(700); return true; }
      await sleep(500);
    }
    return false;
  };
  await test('Remove a user: native confirmation, Cancel keeps, OK removes', async () => {
    await ev(`window.__mgApp.go('users')`); await waitFor(`!!document.querySelector('#uname')`, 4000, 'users');
    await ev(`(()=>{const i=document.getElementById('uname'); i.value='Temp B'; })()`); await tap('#uadd');
    await waitFor(`!!document.querySelector('[data-l]')`, 4000, 'language screen for the new user'); await tap('[data-l="en"]', 300);
    await ev(`window.__mgApp.go('users')`); const n0 = await ev(`document.querySelectorAll('.uname').length`) - 1; await waitFor(`document.querySelectorAll('.uname').length === ${n0 + 1}`, 4000, 'the new user listed');
    await shot('users-two'); const ti = await uidx('Temp B'); expect(ti >= 0, 'Temp B not listed');
    await tapDialog(`.udel[data-del="${ti}"]`); expect(await nativeTap('CANCEL'), 'the confirmation dialog did not appear (or has no Cancel)');
    expect(await ev(`document.querySelectorAll('.uname').length`) === n0 + 1, 'Cancel removed the user');
    await tapDialog(`.udel[data-del="${ti}"]`); expect(await nativeTap('OK'), 'the confirmation dialog did not appear again (or has no OK)');
    await waitFor(`document.querySelectorAll('.uname').length === ${n0}`, 4000, 'the user to be removed after OK');
    expect(await ev(`!localStorage.getItem('mindgarden.u.Temp B')`), 'the removed user\'s record is still stored');
    await tap(`.uname[data-u="${await uidx('Test A')}"]`); await waitFor(`!!document.querySelector('[data-test]')`, 6000, 'home as Test A again');
    return 'Cancel kept, OK removed, record deleted';
  });
  await test('Progress survives closing the app', async () => {
    const before = await ev(`JSON.stringify({n:(window.__mg.S.tests||[]).length,total:window.__mg.S.total,lang:window.__mg.S.settings.lang})`);
    try { ws.close(); } catch (e) { /* closing */ }
    sh('am', 'force-stop', PKG); await sleep(1000); adb('forward', '--remove', 'tcp:' + PORT); PORT++;
    await launch();
    // since v12 every start asks "Who is playing?": pick the same name again, its own progress must come back
    await waitFor(`!!document.querySelector('.uname')`, 6000, 'the Who-is-playing screen at start');
    const ai = await uidx('Test A'); expect(ai >= 0, 'the saved user name is not listed');
    await tap(`.uname[data-u="${ai}"]`); await waitFor(`!!document.querySelector('.hero [data-test], [data-test]')`, 6000, 'home after choosing the user');
    const after = await ev(`JSON.stringify({n:(window.__mg.S.tests||[]).length,total:window.__mg.S.total,lang:window.__mg.S.settings.lang})`);
    expect(before === after, `before ${before}, after ${after}`);
    expect(await ev(`!!document.querySelector('.hero')`), 'the Who-is-playing or language question came back after restart');
    return after;
  });
  await test('No JavaScript errors during the whole run', async () => { expect(report.jsErrors.length === 0, report.jsErrors.length + ' errors, first: ' + report.jsErrors[0]); return 'none'; });

  if (KEEP) await test('Clean up: remove the test user Test A (native confirmation)', async () => {
    await ev(`window.__mgApp.go('users')`); await waitFor(`!!document.querySelector('.uname')`, 4000, 'users');
    const ti = await uidx('Test A'); expect(ti >= 0, 'Test A not listed');
    await tapDialog(`.udel[data-del="${ti}"]`); expect(await nativeTap('OK'), 'no confirmation dialog'); await sleep(600);
    expect(await ev(`!localStorage.getItem('mindgarden.u.Test A') && ![...document.querySelectorAll('.uname')].some(b=>b.innerText.trim()==='Test A')`), 'Test A still there');
    return 'removed';
  });
  try { ws.close(); } catch (e) { /* done */ }
  adb('forward', '--remove', 'tcp:' + PORT);
  finish('done');
})().catch(e => finish('failed', 'runner crashed: ' + e.message));
