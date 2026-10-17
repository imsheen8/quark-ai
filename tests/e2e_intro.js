// أول فتح: انميشن الشعار (نفس انميشن كل فتح) ثم صفحة الدخول مباشرة؛ ويحترم خيار الإعدادات.  تشغيل: python3 -m http.server 8123 ثم node tests/e2e_intro.js
const { chromium } = require('playwright'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓', m); };
const scene = p => p.evaluate(() => { const r = document.getElementById('qiHost')?.shadowRoot; return r ? [...r.querySelectorAll('.scene.on')].map(s => s.id).join(',') : ''; });
(async () => {
  const b = await chromium.launch();
  for (const introOff of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 860 } });
    if (introOff) await ctx.addInitScript(() => { try { localStorage.setItem('ai_intro', 'false'); } catch {} });
    const p = await ctx.newPage(), errs = [], seen = new Set(); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8123/index.html');
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) { const s = await scene(p); if (s) seen.add(s); if (seen.has('sLogin')) break; await p.waitForTimeout(100); }
    ok(seen.has('sLogin'), (introOff ? 'الانميشن معطّل: ' : 'الانميشن مفعّل: ') + 'صفحة الدخول ظهرت [' + [...seen] + '] خلال ' + (Date.now() - t0) + 'ms');
    ok(introOff ? !seen.has('sSplash') : seen.has('sSplash'), introOff ? 'لا شعار قبل الدخول' : 'الشعار يسبق الدخول');
    ok(!seen.has('sBuild') && errs.length === 0, 'لا مشهد بناء الواجهة ولا أخطاء ' + JSON.stringify(errs));
    if (!introOff) await p.screenshot({ path: 'e2e-intro-login.png' });
    await ctx.close();
  }
  await b.close(); console.log('OK — ' + n);
})().catch(e => { console.error(e); process.exit(1); });
