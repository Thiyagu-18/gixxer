// Dev-only: drives headless Chrome over CDP to capture each scene into ./preview
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const OUT = path.join(__dirname, 'preview');
const PORT = 9333;
const W = 1440, H = 900;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
if (!CHROME) { console.error('no chrome/edge found'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--window-size=${W},${H}`, '--hide-scrollbars', '--force-device-scale-factor=1',
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'shotprof'),
    '--no-first-run', '--disable-gpu', 'about:blank',
  ], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 40; i++) {
    try { targets = await getJSON(`http://127.0.0.1:${PORT}/json/list`); break; } catch { await sleep(300); }
  }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));

  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => {
    const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evalJS = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true })).result?.value;
  const shot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    console.log('shot', name);
  };

  const errors = [];
  await send('Runtime.enable');
  await send('Log.enable');
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  });

  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/') });
  await sleep(4000);
  await shot('00-loader');

  await evalJS(`document.querySelector('#playBtn').click()`);
  await sleep(4500);

  const scenes = ['hero', 'origin', 'tunnel', 'skills', 'ladder', 'beyond', 'offscreen', 'father', 'finale', 'credits'];
  const at = { ladder: [0.35, 0.62, 0.85], skills: [0.4, 0.75] };
  let n = 1;
  for (const s of scenes) {
    const fracs = at[s] || [0.35];
    for (const f of fracs) {
      await evalJS(`(()=>{const e=document.getElementById('${s}');const r=e.getBoundingClientRect();
        scrollTo(0, scrollY + r.top + (r.height - innerHeight) * ${f}); return 1})()`);
      await sleep(1400);
      await shot(String(n).padStart(2, '0') + '-' + s + (fracs.length > 1 ? '-' + f : ''));
    }
    n++;
  }

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  ws.close(); proc.kill();
  process.exit(0);
})();
