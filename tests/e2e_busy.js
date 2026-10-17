// أثناء توليد رد: إنشاء/حذف/تبديل المحادثة يوقف التوليد ثم ينفَّذ.  تشغيل: python3 -m http.server 8123 ثم node tests/e2e_busy.js
const { chromium } = require('playwright'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓', m); };
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 412, height: 860 } })).newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.waitForFunction(() => typeof newChat === 'function' && typeof interruptGen === 'function', null, { timeout: 25000 });
  const fake = `chats.push({id:'cA',title:'أ',ts:1,messages:[]},{id:'cB',title:'ب',ts:2,messages:[]}); currentId='cA'; renderAll();
    window.__start = () => { setBusy(true); controller = new AbortController(); controller.signal.addEventListener('abort', () => setTimeout(() => { setBusy(false); controller = null; }, 120)); };`;
  await p.evaluate(fake);
  await p.evaluate(() => { __start(); newChat(); }); await p.waitForTimeout(600);
  ok(await p.evaluate(() => !busy && currentId === null), 'إنشاء محادثة أثناء التوليد يوقفه وينفَّذ');
  await p.evaluate(() => { currentId = 'cA'; renderAll(); __start(); deleteChat('cA'); }); await p.waitForTimeout(600);
  ok(await p.evaluate(() => !busy && !chats.some(c => c.id === 'cA')), 'حذف المحادثة الجارية أثناء التوليد');
  await p.evaluate(() => { currentId = null; __start(); });
  await p.evaluate(() => document.querySelector('.chat-item')?.click()); await p.waitForTimeout(600);
  ok(await p.evaluate(() => !busy && currentId === 'cB'), 'تبديل المحادثة من القائمة أثناء التوليد');
  ok(errs.length === 0, 'لا أخطاء: ' + JSON.stringify(errs));
  await b.close(); console.log('OK — ' + n);
})().catch(e => { console.error(e); process.exit(1); });
