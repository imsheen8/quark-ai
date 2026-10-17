// اختبار واجهة المحرك الأصلي وخدمة التنزيل في Chromium بجهاز QuarkNative وهمي (بلا أندرويد).
// يتطلب: python3 -m http.server 8123 (من مجلد التطبيق) و python3 tests/mock_hf.py 8124.   تشغيل: node tests/e2e_native.js
const { chromium } = require('playwright'), assert = require('assert');
const APP = 'http://localhost:8123/index.html', HF = 'http://localhost:8124';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓', m); };

const NATIVE = `(() => {
  const jobs = {}, calls = [], GB = 1073741824;
  const impl = {
    deviceInfo: () => JSON.stringify({ totalMem: 12 * GB, availMem: 6 * GB, freeBytes: 60 * GB, totalBytes: 256 * GB, cores: 8, sdk: 34, release: '14', brand: 'Test', model: 'Phone 12', soc: 'SoC', abi: 'arm64-v8a' }),
    odInfo: () => JSON.stringify({ available: true, sys: 'NEON = 1 | ARM_FMA = 1 | DOTPROD = 1' }),
    dlEnqueue: s => { const sp = JSON.parse(s); calls.push(['enq', sp]); jobs[sp.id] = { id: sp.id, state: 'downloading', err: '', code: '', bps: 4e6, step: 0, files: sp.files.map(f => ({ name: f.name, size: f.size, done: 0 })) }; return JSON.stringify({ ok: true, state: 'queued' }); },
    dlPause: id => { if (jobs[id]) jobs[id].state = 'paused'; calls.push(['pause', id]); },
    dlResume: (id, f) => { if (jobs[id]) jobs[id].state = 'downloading'; calls.push(['resume', id]); },
    dlCancel: id => { delete jobs[id]; calls.push(['cancel', id]); },
    dlState: () => { for (const j of Object.values(jobs)) if (j.state === 'downloading'){ j.step++; for (const f of j.files) f.done = Math.min(f.size, Math.floor(f.size * j.step / 3)); if (j.files.every(f => f.done >= f.size)) { j.state = 'ready'; j.bps = 0; } } return JSON.stringify({ root: '/data/user/0/app/files/quark-models', jobs: Object.values(jobs) }); },
    llamaLoad: (id, js) => { window.__nLoad = JSON.parse(js); setTimeout(() => window.__odn.ev({ t: 'loaded', id, ok: true, vision: !!window.__nLoad.mmproj, n_ctx: window.__nLoad.n_ctx }), 30); },
    llamaChat: (id, js, imgs) => { window.__nChat = JSON.parse(js); window.__nImgs = imgs ? JSON.parse(imgs) : []; window.__nAbort = false;
      (async () => { const ev = o => window.__odn.ev({ id, ...o }), sl = ms => new Promise(r => setTimeout(r, ms));
        await sl(20); ev({ t: 'pp', done: 500, total: 500 });
        for (const p of ['أرى ', 'قطة ', '😀 ', '<think>', 'x', '</think>', 'جميلة']) { if (window.__nAbort) break; ev({ t: 'tok', s: p }); await sl(15); }
        ev({ t: 'done', ok: true, stop: 'eos', n_prompt: 520, n_gen: 12, t_prompt_ms: 300, t_gen_ms: 1500 }); })(); },
    llamaAbort: () => { window.__nAbort = true; }, llamaFree: () => { calls.push(['free']); },
  };
  window.__nCalls = calls;
  window.QuarkNative = new Proxy(impl, { get: (t, k) => (k in t ? t[k] : () => '') });
})();`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(NATIVE);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(APP); await p.waitForFunction(() => window.__od_ui && document.getElementById('navModels'), null, { timeout: 20000 });
  await p.addStyleTag({ content: '#qiHost,.gate,#qiCover,.intro,.onb{display:none!important;pointer-events:none!important}' });
  await p.evaluate(m => { window.__od.device.cfgSet({ base: m, wifiOnly: false }); window.__od.__net = () => ({ type: 'wifi' }); }, HF);
  await p.evaluate(() => document.getElementById('navModels').click());
  await p.waitForSelector('#mdTabs [data-mt="dl"]'); await p.click('#mdTabs [data-mt="dl"]');
  await p.waitForSelector('.od-dev .od-chips', { timeout: 10000 });
  const dev = await p.locator('.od-dev').innerText();
  ok(/أصلي/.test(dev), 'بطاقة الجهاز تعرض المحرك الأصلي');
  ok(await p.evaluate(() => window.__od.store.useNative() && window.__od.native.available()), 'التخزين والمحرك الأصليان مفعّلان');
  await p.click('.od-gr [data-g="all"]');
  const cards = await p.locator('.od-m').count();
  ok(cards >= 15, 'ظهرت بطاقات كثيرة (7B وما فوق لا يُعرض لأن الكتالوج حتى 4B): ' + cards);
  ok(await p.locator('.od-m .od-tag.acc', { hasText: 'يفهم الصور' }).count() >= 3, 'شارة «يفهم الصور» على نماذج الرؤية');
  const noWasmLimit = await p.evaluate(() => { const d = window.__od_ui.state.dev; return [d.native, d.engineCapGB > 8, d.usableGB > 6]; });
  ok(noWasmLimit.every(Boolean), 'لا سقف 3.4GB مع المحرك الأصلي: ' + noWasmLimit);
  await p.screenshot({ path: 'e2e-native-1.png' });

  /* تنزيل نموذج رؤية (Gemma 3 4B) مع ملف mmproj */
  await p.locator('.od-m', { hasText: 'Gemma 3 4B' }).locator('[data-od="get"]').click();
  await p.waitForSelector('.od-sheet .od-var', { timeout: 10000 });
  ok(await p.locator('.od-sheet [data-vis]').count() === 1, 'مفتاح «تنزيل ملف الرؤية» ظاهر');
  ok(await p.locator('.od-sheet [data-vis]').getAttribute('aria-checked') === 'true', 'مفعّل افتراضيًا');
  const btn1 = await p.locator('.od-sheet [data-go]').innerText();
  await p.click('.od-sheet [data-vis]');
  const btn2 = await p.locator('.od-sheet [data-go]').innerText();
  ok(btn1 !== btn2, 'حجم التنزيل يتغير مع المفتاح: ' + btn1.trim() + ' ↔ ' + btn2.trim());
  await p.click('.od-sheet [data-vis]');
  await p.screenshot({ path: 'e2e-native-2.png' });
  await p.click('.od-sheet [data-go]');
  await p.waitForFunction(() => { const r = window.__od.store.list()[0]; return r && r.state === 'ready'; }, null, { timeout: 20000 });
  const rec = await p.evaluate(() => window.__od.store.list()[0]);
  const enq = await p.evaluate(() => window.__nCalls.find(c => c[0] === 'enq')[1]);
  ok(rec.storage === 'native' && rec.vision === true, 'سجل أصلي يدعم الصور');
  ok(enq.files.length === 2 && enq.files[1].name === 'mmproj-F16.gguf' && /resolve\/main\/mmproj-F16\.gguf/.test(enq.files[1].url), 'أُرسل ملف mmproj إلى الخدمة');
  ok(enq.dir && enq.wifiOnly === false, 'مجلد النموذج وإعداد الواي فاي أُرسلا');
  const reg = await p.evaluate(() => { const ep = settings.endpoints.find(e => e.proto === 'ondevice'); const m = ep.models.find(x => x.vision); return { v: !!m, sel: settings.sel && settings.sel.model }; });
  ok(reg.v && reg.sel === rec.id, 'سُجّل بعلامة vision وصار الحالي');
  await p.waitForTimeout(300); await p.screenshot({ path: 'e2e-native-3.png' });
  ok((await p.locator('.od-rec').first().innerText()).includes('يدعم الصور'), 'صف المكتبة يذكر دعم الصور');

  /* محادثة بصورة عبر callModel */
  const out = await p.evaluate(async () => {
    const am = activeModel(), res = [];
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    for await (const c of callModel([{ role: 'user', content: 'ماذا ترى؟', images: [{ mime: 'image/png', data: png }] }], null, am)) res.push(c);
    return { res, load: window.__nLoad, chat: window.__nChat, imgs: window.__nImgs.length };
  });
  ok(out.load.mmproj.endsWith('mmproj-F16.gguf') && out.load.model.endsWith('.gguf') && out.load.mmap === true, 'حُمّل النموذج مع ملف الرؤية');
  ok(out.chat.messages.some(m => m.nimg === 1) && out.imgs === 1, 'الصورة وصلت إلى المحرك الأصلي');
  ok(out.res.filter(c => typeof c === 'string').join('') === 'أرى قطة 😀 جميلة', 'بث النص العربي والإيموجي سليم');
  ok(out.res.some(c => c && c.think === 'x'), 'فُصل التفكير');
  const ev = await p.evaluate(() => window.__usage.all().filter(e => e.t === 't').pop()); ok(ev && ev.ok && ev.o === 12 && ev.i === 520, 'سُجّلت أرقام الاستخدام الحقيقية من المحرك الأصلي: ' + JSON.stringify(ev));
  /* الإلغاء */
  const ab = await p.evaluate(async () => { const ctl = new AbortController(); let k = 0, err = ''; try { for await (const c of callModel([{ role: 'user', content: 'hi' }], ctl.signal, activeModel())) { if (typeof c === 'string' && ++k === 1) ctl.abort(); } } catch (e) { err = e.name; } return { k, err, abort: window.__nAbort }; });
  ok(ab.err === 'AbortError' && ab.abort === true, 'الإلغاء يوقف المحرك الأصلي');
  /* إيقاف/استئناف/حذف عبر الخدمة */
  await p.evaluate(() => { window.__od.store.pause(window.__od.store.list()[0].id); });
  ok(await p.evaluate(() => window.__nCalls.some(c => c[0] === 'pause')), 'الإيقاف المؤقت يصل للخدمة');
  await p.evaluate(async () => { await window.__od.store.remove(window.__od.store.list()[0].id); });
  ok(await p.evaluate(() => window.__nCalls.some(c => c[0] === 'cancel') && window.__od.store.list().length === 0), 'الحذف يصل للخدمة ويُفرغ السجل');
  ok(errs.length === 0, 'لا أخطاء في الصفحة ' + JSON.stringify(errs));
  await b.close();
  console.log('OK — ' + n);
})().catch(e => { console.error(e); process.exit(1); });
