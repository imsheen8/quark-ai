// اختبار واجهة «سجل الأخطاء» في Chromium. يتطلب: python3 -m http.server 8123 (من مجلد التطبيق).   تشغيل: node tests/e2e_errlog.js
const { chromium } = require('playwright'), assert = require('assert');
const APP = 'http://localhost:8123/index.html';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓', m); };
const NATIVE = `(() => { window.QuarkNative = new Proxy({
  crashLog: () => JSON.stringify([{ kind:'EXIT', ts: Date.now() - 60000, reason:'CRASH_NATIVE (انهيار أصلي — المحرك/المكتبات)', desc:'signal 11 (SIGSEGV), code 1', pss: 900000, rss: 1200000, pid: 123 }]),
  deviceInfo: () => JSON.stringify({ brand:'POCO', model:'23049PCD8G', sdk:35, release:'15', totalMem: 11e9, cores:8, appVersion:'1.0.9' }),
  odInfo: () => JSON.stringify({ available:false, error:'dlopen failed: library "libquark_llama.so" not found' }),
}, { get:(t, k) => k in t ? t[k] : undefined }); })()`;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(NATIVE);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(APP); await p.waitForFunction(() => window.__errlog && typeof openSettings === 'function' && document.getElementById('tabs'), null, { timeout: 25000 });
  await p.addStyleTag({ content: '#qiHost,.gate,#qiCover,.intro,.onb{display:none!important;pointer-events:none!important}' });
  ok(await p.evaluate(() => window.__errlog.all().some(e => e.src === 'exit' && /CRASH_NATIVE/.test(e.msg))), 'انهيار النظام السابق استُورد عند الإقلاع');
  /* أخطاء حقيقية من الصفحة نفسها */
  await p.evaluate(() => { setTimeout(() => { throw new Error('خطأ ثابت من الواجهة'); }, 0); Promise.reject(new Error('وعد مرفوض حقيقي')); fetch('/no-such-file-xyz.json').catch(() => {}); fetch('http://localhost:1/unreachable').catch(() => {});
    window.__errlog.add({ src:'native', msg:'تحميل النموذج: المحرك الأصلي غير متاح — dlopen failed', code:'load', ctx:{ gpu_note:'no_lib' }, stack:'at nativeLoad (od-native.js:12)' });
    window.__errlog.add({ src:'download', msg:'HTTP 401 — unsloth/gemma-3-4b-it-GGUF:Q4_K_M', code:'auth', ctx:{ id:'x', retryable:true } }); });
  await p.waitForTimeout(800);
  await p.evaluate(() => openSettings('errors'));
  await p.waitForSelector('#erRoot .er-card', { timeout: 8000 });
  const cards = await p.locator('.er-card').count(); ok(cards >= 5, 'ظهرت بطاقات الأخطاء: ' + cards);
  ok(await p.locator('.er-chip').count() >= 5, 'مرشحات المصدر والمستوى والمدة ظاهرة');
  ok(await p.evaluate(() => document.getElementById('setTitle').textContent) === 'سجل الأخطاء', 'عنوان الصفحة');
  await p.screenshot({ path: 'e2e-errlog-1.png' });
  /* تفاصيل */
  await p.locator('.er-card [data-er="toggle"]').first().click();
  ok(await p.locator('.er-card.open .er-pre').count() >= 1, 'التفاصيل (stack/ctx) تظهر عند الضغط');
  /* بحث وتصفية */
  await p.fill('#erQ', 'dlopen'); await p.waitForTimeout(400);
  ok(await p.locator('.er-card').count() === 1, 'البحث يصفّي النتائج');
  await p.fill('#erQ', ''); await p.waitForTimeout(400);
  await p.locator('.er-chip[data-v="download"]').click();
  ok(await p.locator('.er-card').count() === 1 && /401/.test(await p.locator('.er-msg').first().innerText()), 'تصفية بالمصدر');
  await p.locator('.er-chip[data-v="all"]').first().click();
  /* نسخ التقرير الكامل */
  await p.evaluate(() => { window.copyText = async t => { window.__copied = t; return true; }; });
  await p.locator('[data-er="copyfull"]').click(); await p.waitForTimeout(300);
  const rep = await p.evaluate(() => window.__copied || '');
  ok(/تقرير أخطاء/.test(rep) && /POCO/.test(rep) && /CRASH_NATIVE/.test(rep) && /خطأ ثابت من الواجهة/.test(rep) && /401/.test(rep), 'التقرير الكامل يحوي الجهاز والأخطاء');
  await p.locator('[data-er="copy1"]').first().click(); await p.waitForTimeout(200);
  ok((await p.evaluate(() => window.__copied)).length > 20, 'نسخ خطأ واحد');
  /* المتقدم */
  await p.locator('.er-adv summary').click();
  await p.locator('[data-er="sw"][data-k="warn"]').click();
  ok(await p.evaluate(() => window.__errlog.prefs().warn === true), 'مفتاح التقاط التحذيرات يُحفظ');
  await p.locator('.er-adv').scrollIntoViewIfNeeded(); await p.screenshot({ path: 'e2e-errlog-2.png' });
  /* القائمة الرئيسية للإعدادات تعرض الصف */
  await p.evaluate(() => selectTab('home'));
  ok(/سجل الأخطاء/.test(await p.locator('#setHome').innerText()), 'صف «سجل الأخطاء» في قائمة الإعدادات');
  /* مسح */
  await p.evaluate(() => selectTab('errors'));
  p.once('dialog', d => d.accept());
  await p.locator('[data-er="clear"]').click(); await p.waitForTimeout(500);
  const cfm = p.locator('.q-dlg [data-ok], .lib-dlg .pri'); if (await cfm.count()) await cfm.last().click();
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => window.__errlog.all().length) === 0, 'مسح الكل');
  ok(errs.length >= 1 && errs.every(e => /خطأ ثابت|وعد مرفوض/.test(e)), 'أخطاء الصفحة الوحيدة هي التي أطلقناها عمدًا: ' + JSON.stringify(errs));
  await b.close(); console.log('OK — ' + n);
})().catch(e => { console.error(e); process.exit(1); });
