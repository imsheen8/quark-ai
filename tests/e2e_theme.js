// المظهر «تلقائي»: تظهر ثيمات وضع الجهاز الحالي فقط.   تشغيل: python3 -m http.server 8123 ثم node tests/e2e_theme.js
const { chromium } = require('playwright'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓', m); };
(async () => {
  const b = await chromium.launch();
  for (const cs of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, colorScheme: cs });
    await ctx.addInitScript(() => { try { localStorage.setItem('ai_intro', 'false'); localStorage.setItem('ai_onboarded', 'true'); } catch {} });
    const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8123/index.html'); await p.waitForFunction(() => typeof openSettings === 'function', null, { timeout: 25000 });
    await p.addStyleTag({ content: '#qiHost,#qiCover{display:none!important}' });
    await p.evaluate(() => { settings.theme = 'auto'; persistSettings(); applyTheme(); openSettings('look'); }); await p.waitForTimeout(400);
    const g = await p.$$eval('#themeBox .th-group', a => a.map(x => x.querySelector('.lbl').textContent.trim()));
    ok(g.length === 1 && g[0].includes(cs === 'dark' ? 'الداكن' : 'الفاتح'), cs + ': مجموعة واحدة فقط — ' + g);
    await p.emulateMedia({ colorScheme: cs === 'dark' ? 'light' : 'dark' }); await p.waitForTimeout(400);
    const g2 = await p.$$eval('#themeBox .th-group', a => a.map(x => x.querySelector('.lbl').textContent.trim()));
    ok(g2.length === 1 && g2[0].includes(cs === 'dark' ? 'الفاتح' : 'الداكن'), cs + ': عند تبدّل وضع الجهاز تتبدّل المجموعة — ' + g2);
    await p.evaluate(() => { settings.theme = 'dark'; renderThemes(); });
    ok(await p.$$eval('#themeBox .th-group', a => a.length) === 1, 'الوضع الداكن اليدوي: مجموعة واحدة');
    ok(errs.length === 0, 'لا أخطاء ' + JSON.stringify(errs));
    await ctx.close();
  }
  await b.close(); console.log('OK — ' + n);
})().catch(e => { console.error(e); process.exit(1); });
