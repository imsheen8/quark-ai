// الإعدادات ← التخصيص: أربعة تبويبات تُظهر كل منها محتواها فقط.   تشغيل: python3 -m http.server 8123 ثم node tests/e2e_custom.js
const { chromium } = require('playwright'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓', m); };
(async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 412, height: 860 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('ai_intro', 'false'); localStorage.setItem('ai_onboarded', 'true'); } catch {} });
  const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.waitForFunction(() => typeof openSettings === 'function' && window.__cuGo, null, { timeout: 25000 });
  await p.addStyleTag({ content: '#qiHost,#qiCover{display:none!important}' });
  await p.evaluate(() => openSettings('custom')); await p.waitForTimeout(500);
  const labels = await p.$$eval('#cuTabs .vo-tab', a => a.map(x => x.textContent));
  ok(labels.length === 4 && labels[0] === 'التفضيلات والتعليمات', 'أربعة تبويبات: ' + labels);
  ok(await p.evaluate(() => document.getElementById('setTitle').textContent.trim() === ''), 'اسم الصفحة محذوف');
  const vis = () => p.evaluate(() => [...document.querySelectorAll('[data-panel="custom"] details[data-cu]')].filter(d => d.offsetParent).map(d => d.id).join(','));
  ok(await vis() === 'prefsDetails,systemDetails', 'تبويب التفضيلات يضم التفضيلات والتعليمات معًا');
  for (const [k, id] of [['mem', 'memoryDetails'], ['skills', 'skillsSettingsDetails'], ['params', 'paramsDetails']]) {
    await p.click(`#cuTabs [data-cu="${k}"]`, { force: true }); await p.waitForTimeout(250);
    ok(await vis() === id, 'تبويب ' + k + ' يُظهر ' + id);
  }
  await p.screenshot({ path: 'e2e-custom-params.png' });
  await p.evaluate(() => window.__openMemory && window.__openMemory()); await p.waitForTimeout(300);
  ok(await vis() === 'memoryDetails', 'الرابط القديم للذاكرة يفتح تبويبها');
  ok(errs.length === 0, 'لا أخطاء ' + JSON.stringify(errs));
  await b.close(); console.log('OK — ' + n);
})().catch(e => { console.error(e); process.exit(1); });
