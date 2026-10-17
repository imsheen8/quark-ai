// اختبار شامل في Chromium حقيقي (OPFS + Worker): تبويب «تنزيل على الجهاز» ← تنزيل ← إيقاف/متابعة ← تشغيل بمحرك وهمي ← حذف ← إعادة فتح.
// يتطلب: python3 -m http.server 8123 (من مجلد التطبيق) و python3 tests/mock_hf.py 8124.   تشغيل: node tests/e2e_ondevice.js
const { chromium } = require('playwright'), assert = require('assert');
const APP = 'http://localhost:8123/index.html', HF = 'http://localhost:8124';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓', m); };
const MOCK = `window.__od.__lib = { base:'mock/', Wllama: class {
  constructor(){ this.loaded = false; }
  async loadModel(files){ const head = new Uint8Array(await files[0].slice(0,4).arrayBuffer()); if (String.fromCharCode(...head) !== 'GGUF') throw new Error('bad gguf'); this.loaded = files[0].size; }
  async createChatCompletion(msgs, o){
    window.__lastMsgs = msgs; const enc = new TextEncoder(); let text = '';
    for (const t of ['مرح','با ','<think>','أفكّر','</think>','بك ','يا ','صديقي']){
      if (o.abortSignal && o.abortSignal.aborted) return text;
      await new Promise(r => setTimeout(r, 25)); text += t; o.onNewToken(1, enc.encode(t), text, { abortSignal(){} });
    } return text; }
  async exit(){ this.loaded = false; } } };`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const boot = async () => { await p.goto(APP); await p.waitForFunction(() => window.__od_ui && document.getElementById('navModels'), null, { timeout: 20000 }); await p.addStyleTag({ content: '#qiHost,.gate,#qiCover,.intro{display:none!important;pointer-events:none!important}' }); };
  await boot();
  await p.evaluate(m => { window.__od.device.cfgSet({ base: m, wifiOnly: false }); window.__od.__net = () => ({ type: 'wifi' }); }, HF);
  await p.evaluate(MOCK);
  await p.evaluate(() => { document.getElementById('navModels').click(); });
  await p.waitForSelector('#mdTabs [data-mt="dl"]');
  await p.click('#mdTabs [data-mt="dl"]');
  await p.waitForSelector('.od-dev .od-chips', { timeout: 10000 });
  ok(await p.locator('.od-m').count() >= 3, 'ظهرت بطاقات الاقتراح');
  ok((await p.locator('.od-dev').innerText()).includes('الذاكرة'), 'بطاقة الجهاز تعرض الذاكرة');
  ok(await p.locator('.od-tag.acc').count() === 1, 'شارة «الأنسب لك» على بطاقة واحدة');
  await p.screenshot({ path: 'e2e-od-1.png' });

  // تنزيل نموذج من الاقتراحات
  await p.locator('.od-m [data-od="get"]').first().click();
  await p.waitForSelector('.od-sheet .od-var', { timeout: 10000 });
  ok(await p.locator('.od-var').count() === 3, 'عُرضت 3 صيغ (استُبعد mmproj)');
  await p.waitForTimeout(600); await p.screenshot({ path: 'e2e-od-2.png' });
  await p.click('.od-sheet [data-go]');
  const getRec = () => p.evaluate(() => window.__od.store.list()[0] || null);
  await p.waitForFunction(() => { const r = window.__od.store.list()[0]; return r && r.state === 'ready'; }, null, { timeout: 30000 });
  let rec = await getRec();
  ok(rec.size === rec.bytes && rec.size >= 2e6, 'اكتمل التنزيل: ' + rec.id);
  const opfs = await p.evaluate(async id => { const d = await navigator.storage.getDirectory(), r = await d.getDirectoryHandle('quark-models'), m = await r.getDirectoryHandle(window.__od.store.slug(id)); const out = []; for await (const [k, h] of m.entries()) out.push([k, (await h.getFile()).size]); return out; }, rec.id);
  ok(opfs.length === 1 && opfs[0][1] === rec.size, 'الملف في OPFS بحجمه الصحيح ' + JSON.stringify(opfs));
  const reg = await p.evaluate(() => { const ep = settings.endpoints.find(e => e.proto === 'ondevice'); return ep && { m: ep.models.map(x => x.id), sel: settings.sel && settings.sel.model, kind: ep.kind }; });
  ok(reg && reg.kind === 'local' && reg.m.includes(rec.id) && reg.sel === rec.id, 'سُجّل كنقطة «على الجهاز» وصار النموذج الحالي');

  // تشغيل عبر callModel (محرك وهمي)
  const out = await p.evaluate(async () => { const am = activeModel(), got = []; for await (const c of callModel([{ role: 'user', content: 'سلام' }], new AbortController().signal, null, am)) got.push(c); return got; });
  ok(out.filter(x => typeof x === 'string').join('') === 'مرحبا بك يا صديقي', 'البث النصي صحيح (UTF-8 والعربية)');
  ok(out.some(x => x && x.think === 'أفكّر'), 'فُصل التفكير');
  const ev = await p.evaluate(() => window.__usage.all().filter(e => e.t === 't').pop()); ok(ev && ev.ok && ev.o === 8 && /Qwen3/.test(ev.m), 'سُجّلت أرقام الاستخدام الحقيقية في الإحصائيات');
  const msgs = await p.evaluate(() => window.__lastMsgs); ok(msgs[0].role === 'system' && msgs.at(-1).content.startsWith('سلام'), 'رسالة النظام والسؤال وصلا للمحرك');
  // إلغاء
  const ab = await p.evaluate(async () => { const ctl = new AbortController(), am = activeModel(); let n = 0, err = ''; try { for await (const c of callModel([{ role: 'user', content: 'x' }], ctl.signal, null, am)) { if (typeof c === 'string' && ++n === 2) ctl.abort(); } } catch (e) { err = e.name; } return { n, err }; });
  ok(ab.err === 'AbortError' && ab.n <= 3, 'الإلغاء يوقف البث: ' + JSON.stringify(ab));
  // عنوان تلقائي بلا استهلاك المحرك
  const title = await p.evaluate(() => completeOnce(activeModel(), 'اكتب عنوانًا قصيرًا جدًا (من 2 إلى 5 كلمات) يلخّص\n\nالمستخدم: كيف أطبخ الأرز بالحليب للأطفال الصغار\n\nالمساعد: حسنًا'));
  ok(title === 'كيف أطبخ الأرز بالحليب للأطفال', 'عنوان محلي سريع: ' + title);

  // إيقاف مؤقت ثم متابعة (خادم بطيء)
  await p.evaluate(async () => { await window.__od.store.enqueue({ id: 'slow/Slow-1B-GGUF:Q8_0', repo: 'slow/Slow-1B-GGUF', quant: 'Q8_0', name: 'Slow · Q8_0', files: [{ path: 'Slow-1B-Q8_0.gguf', size: 5000000 }] }); });
  await p.waitForFunction(() => { const r = window.__od.store.get('slow/Slow-1B-GGUF:Q8_0'); return r && r.bytes > 600000; }, null, { timeout: 15000 });
  await p.evaluate(() => window.__od.store.pause('slow/Slow-1B-GGUF:Q8_0'));
  await p.waitForFunction(() => window.__od.store.get('slow/Slow-1B-GGUF:Q8_0').state === 'paused', null, { timeout: 8000 });
  const mid = await p.evaluate(() => window.__od.store.get('slow/Slow-1B-GGUF:Q8_0').bytes); ok(mid > 0 && mid < 5e6, 'أُوقف مؤقتًا عند ' + mid);
  await p.evaluate(() => window.__od.store.resume('slow/Slow-1B-GGUF:Q8_0'));
  await p.waitForFunction(() => window.__od.store.get('slow/Slow-1B-GGUF:Q8_0').state === 'ready', null, { timeout: 30000 });
  const blobOk = await p.evaluate(async () => { const f = (await window.__od.store.blobs('slow/Slow-1B-GGUF:Q8_0'))[0]; const u = new Uint8Array(await f.arrayBuffer()); let good = f.size === 5000000 && String.fromCharCode(...u.slice(0, 4)) === 'GGUF'; for (let i = 4; i < u.length; i += 9973) if (u[i] !== (i * 4) % 251) { good = false; break; } return good; });
  ok(blobOk, 'المحتوى بعد الاستئناف مطابق تمامًا (لا تلف)');

  // أخطاء المستودع
  const er = await p.evaluate(async () => { const o = {}; for (const r of ['x/missing-GGUF', 'x/private-GGUF']) { try { await window.__od.catalog.resolveRepo(r, window.__od.device.cfgGet()); } catch (e) { o[r] = e.code; } } return o; });
  ok(er['x/missing-GGUF'] === 'notfound' && er['x/private-GGUF'] === 'auth', 'أخطاء المستودع واضحة');

  // بحث
  await p.evaluate(() => { const i = document.getElementById('odQ'); i.value = 'tiny'; i.closest('form').requestSubmit(); });
  await p.waitForSelector('.od-res', { timeout: 8000 });
  ok(await p.locator('.od-res').count() === 2, 'نتائج بحث HF');
  await p.screenshot({ path: 'e2e-od-3.png', fullPage: false });

  // إعادة فتح التطبيق: السجل يبقى والملفات تبقى
  await boot(); await p.evaluate(m => { window.__od.device.cfgSet({ base: m }); }, HF);
  const after = await p.evaluate(async () => { await window.__od.store.verify(); return window.__od.store.list().map(r => r.id + ':' + r.state).sort(); });
  ok(after.length === 2 && after.every(x => x.endsWith(':ready')), 'بعد إعادة التحميل: ' + after.join(' | '));
  ok(await p.evaluate(() => settings.endpoints.some(e => e.proto === 'ondevice' && e.models.length === 2)), 'النقطة والنماذج ما زالت مسجّلة');

  // حذف عبر الواجهة
  await p.evaluate(() => document.getElementById('navModels').click()); await p.click('#mdTabs [data-mt="dl"]'); await p.waitForSelector('.od-rec');
  await p.locator('.od-rec [data-od="del"]').first().click(); await p.waitForSelector('.q-confirm [data-q="1"]'); await p.click('.q-confirm [data-q="1"]');
  await p.waitForFunction(() => window.__od.store.list().length === 1, null, { timeout: 8000 });
  const left = await p.evaluate(async () => { const d = await navigator.storage.getDirectory(), r = await d.getDirectoryHandle('quark-models'); const o = []; for await (const [k] of r.entries()) o.push(k); return o; });
  ok(left.length === 1, 'حُذف مجلد النموذج من OPFS (المتبقي ' + left.length + ')');
  ok(errs.length === 0, 'لا أخطاء في الصفحة ' + JSON.stringify(errs.slice(0, 3)));
  await b.close(); console.log('OK — ' + n);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
