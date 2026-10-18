// صفحة النماذج: ترشيح مرتب (شبكة 2×2) وبطاقات بنفس عرض شبكة المكتبة.   تشغيل: python3 -m http.server 8123 ثم node tests/e2e_models.js
const { chromium } = require('playwright'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓', m); };
(async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 412, height: 860 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('ai_intro', 'false'); localStorage.setItem('ai_onboarded', 'true'); } catch {} });
  const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.waitForFunction(() => typeof window.__openModels === 'function', null, { timeout: 25000 });
  await p.addStyleTag({ content: '#qiHost,#qiCover{display:none!important}' });
  await p.evaluate(() => { settings.endpoints = [{ id: 'e1', preset: 'openai', url: 'https://api.openai.com/v1', key: 'k', proto: 'openai', kind: 'api', enabled: true, models: [{ id: 'gpt-4o-mini', on: true }, { id: 'gpt-5', on: true }] }]; settings.sel = { ep: 'e1', model: 'gpt-4o-mini' }; persistSettings(); window.__openModels(); });
  await p.waitForSelector('#mdGrid .lib-card', { timeout: 8000 });
  const r = sel => p.evaluate(s => { const e = document.querySelector(s); const x = e.getBoundingClientRect(); return { l: Math.round(x.left), r: Math.round(x.right), w: Math.round(x.width), t: Math.round(x.top) }; }, sel);
  const cap = await r('#mdCap'), st = await r('#mdSt'), fam = await r('#mdFam'), sort = await r('#mdSort');
  ok(Math.abs(cap.w - st.w) <= 1 && Math.abs(fam.w - sort.w) <= 1 && cap.t === st.t && fam.t === sort.t, 'قوائم الترشيح في شبكة 2×2 متساوية');
  const c = await r('#mdGrid .lib-card'); ok(c.w > 340 && c.l <= 20, 'بطاقة النموذج بعرض الشبكة: ' + JSON.stringify(c));
  ok(await p.evaluate(() => { const t = document.querySelector('#mdTabs .lib-tab.on'), tr = t.getBoundingClientRect(), cr = document.getElementById('mdTabs').getBoundingClientRect(); return tr.left >= cr.left - 2 && tr.right <= cr.right + 2; }), 'التبويب النشط ظاهر');
  ok(errs.length === 0, 'لا أخطاء ' + JSON.stringify(errs));
  await b.close(); console.log('OK — ' + n);
})().catch(e => { console.error(e); process.exit(1); });
