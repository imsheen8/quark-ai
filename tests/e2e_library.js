// المكتبة: كل التبويبات تُرسم بلا أخطاء، وبطاقاتها بنفس الحواف والعرض، ووصف البطاقة ظاهر.   تشغيل: python3 -m http.server 8123 ثم node tests/e2e_library.js
const { chromium } = require('playwright'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓', m); };
(async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 412, height: 860 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('ai_intro', 'false'); localStorage.setItem('ai_onboarded', 'true'); } catch {} });
  const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.waitForFunction(() => typeof window.__openLib === 'function', null, { timeout: 25000 });
  await p.addStyleTag({ content: '#qiHost,#qiCover{display:none!important}' });
  await p.evaluate(() => window.__openLib()); await p.waitForTimeout(500);
  const tabs = await p.evaluate(() => window.__libTabs); ok(tabs.length === 7, '7 تبويبات: ' + tabs);
  const rect = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; }, sel);
  for (const t of tabs) { await p.evaluate(t => { window.__libSetTab(t); window.__libRefresh(); }, t); await p.waitForTimeout(400); }
  await p.evaluate(() => { window.__libSetTab('template'); window.__libRefresh(); }); await p.waitForTimeout(300);
  const a = await rect('#lbGrid .lib-card'); ok(a && a.w > 300, 'بطاقة القوالب عرضها ' + (a && a.w));
  ok(await p.evaluate(() => document.querySelector('#lbGrid .lib-card p').offsetHeight > 20), 'وصف البطاقة ظاهر (ارتفاعه > 0)');
  await p.evaluate(() => { window.__libSetTab('skills'); window.__libRefresh(); }); await p.waitForTimeout(400);
  const s = await rect('#skList .sk-card'); ok(s && Math.abs(s.l - a.l) <= 1 && Math.abs(s.w - a.w) <= 1, 'بطاقة المهارات بنفس الموضع والعرض: ' + JSON.stringify([a, s]));
  ok(await p.evaluate(() => { const t = document.querySelector('.lib-tab.on'); const r = t.getBoundingClientRect(), c = document.getElementById('lbTabs').getBoundingClientRect(); return r.left >= c.left - 2 && r.right <= c.right + 2; }), 'التبويب النشط ظاهر داخل الشريط');
  await p.evaluate(() => { window.__libSetTab('tasks'); window.__libRefresh(); }); await p.waitForTimeout(400);
  const sg = await rect('#tkSeg'); ok(sg && Math.abs(sg.l - a.l) <= 1 && Math.abs(sg.r - a.r) <= 1, 'أقسام المهام بنفس عرض الشبكة: ' + JSON.stringify([a, sg]));
  ok(errs.length === 0, 'لا أخطاء ' + JSON.stringify(errs));
  await b.close(); console.log('OK — ' + n);
})().catch(e => { console.error(e); process.exit(1); });
