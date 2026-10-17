// اختبار الجسر الأصلي (llama.cpp + خدمة التنزيل) بجهاز QuarkNative وهمي: node tests/test_native.js
const assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const GB = 1024 ** 3;

/* ---------- QuarkNative وهمي ---------- */
const calls = [], jobs = new Map(); let emitCtxErrOnce = false, loadFail = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let aborted = false, lastReq = null, lastImgs = null, loadReq = null;
const QN = {
  odInfo: () => JSON.stringify({ available: true, sys: 'NEON' }),
  dlEnqueue: s => { const sp = JSON.parse(s); calls.push(['enq', sp]); const j = { id: sp.id, state: 'queued', err: '', code: '', bps: 0, files: sp.files.map(f => ({ name: f.name, size: f.size, done: 0 })), spec: sp }; jobs.set(sp.id, j); return JSON.stringify({ ok: true, state: 'queued' }); },
  dlPause: id => { calls.push(['pause', id]); const j = jobs.get(id); if (j) j.state = 'paused'; },
  dlResume: (id, f) => { calls.push(['resume', id, f]); const j = jobs.get(id); if (j) j.state = 'queued'; },
  dlCancel: id => { calls.push(['cancel', id]); jobs.delete(id); },
  dlState: () => JSON.stringify({ root: '/data/files/quark-models', jobs: [...jobs.values()].map(({ spec, ...j }) => j) }),
  llamaLoad: (id, js) => { loadReq = JSON.parse(js); setTimeout(() => globalThis.window.__odn.ev(loadFail ? { t: 'loaded', id, ok: false, error: 'تعذّر', code: 'load' } : { t: 'loaded', id, ok: true, vision: !!loadReq.mmproj, n_ctx: loadReq.n_ctx }), 5); },
  llamaChat: (id, js, imgs) => {
    lastReq = JSON.parse(js); lastImgs = imgs ? JSON.parse(imgs) : []; aborted = false;
    const ev = o => globalThis.window.__odn.ev({ id, ...o });
    (async () => {
      await sleep(5);
      if (emitCtxErrOnce) { emitCtxErrOnce = false; return ev({ t: 'err', code: 'ctx', error: 'long', need: 999, ctx: 100 }); }
      ev({ t: 'pp', done: 0, total: 400 }); ev({ t: 'pp', done: 400, total: 400 });
      for (const p of ['<think>أفكّر', '</think>', 'مرحب', 'ًا 😀', ' بك']) { if (aborted) break; ev({ t: 'tok', s: p }); await sleep(3); }
      ev({ t: 'done', ok: true, stop: aborted ? 'abort' : 'eos', n_prompt: 30, n_gen: 20, t_gen_ms: 2000, t_prompt_ms: 100 });
    })();
  },
  llamaAbort: () => { aborted = true; calls.push(['abort']); },
  llamaFree: () => calls.push(['free']),
};
globalThis.window = { QuarkNative: QN, addEventListener() {} }; globalThis.window.window = globalThis.window;
const kvm = {}; globalThis.store = { get: (k, d) => (k in kvm ? JSON.parse(kvm[k]) : d), set: (k, v) => { kvm[k] = JSON.stringify(v); } };
globalThis.toast = () => {};
const native = require('../js/features/od-native.js');
const device = require('../js/features/od-device.js');
const catalog = require('../js/features/od-catalog.js');
const fit = require('../js/features/od-fit.js');
const store = require('../js/features/od-store.js');
const engine = require('../js/features/od-engine.js');

(async () => {
  /* ---------- الجسر ---------- */
  ok(native.available() && native.dlAvailable(), 'المحرك الأصلي متاح');
  const L = await native.load({ model: '/m.gguf', mmproj: '', n_ctx: 2048 });
  eq([L.ok, L.n_ctx], [true, 2048]);
  loadFail = true; let le = null; try { await native.load({ model: '/x' }); } catch (e) { le = e; } loadFail = false; ok(le && le.code === 'load', 'فشل التحميل يرفض');
  const got = []; for await (const e of native.chat({ messages: [] }, [], null)) got.push(e);
  ok(got.some(e => e.pp) && got.filter(e => e.tok != null).map(e => e.tok).join('').includes('😀') && got[got.length - 1].stats.n_gen === 20, 'بث رموز + إحصاءات');
  emitCtxErrOnce = true; let ce = null; try { for await (const e of native.chat({ messages: [] }, [], null)); } catch (e) { ce = e; } ok(ce && ce.code === 'ctx' && ce.need === 999, 'خطأ السياق يحمل الرمز');
  const ac = new AbortController(); let cnt = 0;
  for await (const e of native.chat({ messages: [] }, [], ac.signal)) { if (e.tok != null && ++cnt === 1) ac.abort(); }
  ok(calls.some(c => c[0] === 'abort'), 'الإلغاء يستدعي llamaAbort');

  /* ---------- الجهاز والملاءمة ---------- */
  const dn = device.classify({ ram: 12, cores: 8, ramExact: true, engine: 'native', isolated: false, sab: false });
  eq([dn.native, dn.engineCapGB > 8, Math.round(dn.usableGB * 10) / 10], [true, true, 6.6]);
  const dw = device.classify({ ram: 12, cores: 8, ramExact: true, engine: 'wasm' });
  eq([dw.native, dw.usableGB], [false, 3.4]);
  const f7 = fit.fit({ sizeBytes: 4.4 * GB, params: 7.6, ar: 2, tags: [] }, dn);
  ok(f7.level !== 'no', 'نموذج 7B يناسب جهازًا بذاكرة 12GB مع المحرك الأصلي');
  ok(fit.fit({ sizeBytes: 4.4 * GB, params: 7.6 }, dw).level === 'no', 'ولا يناسب WASM');
  const fv = fit.fit({ sizeBytes: 2.5 * GB, params: 4, extraBytes: 0.9 * GB }, dn), fn = fit.fit({ sizeBytes: 2.5 * GB, params: 4 }, dn);
  ok(fv.needBytes > fn.needBytes + 0.9 * GB, 'ملف الرؤية يزيد الذاكرة المطلوبة');

  /* ---------- الكتالوج: mmproj ---------- */
  const vs = catalog.variantsFromFiles([{ path: 'g-Q4_K_M.gguf', size: 100 }, { path: 'mmproj-BF16.gguf', size: 90 }, { path: 'mmproj-F16.gguf', size: 80 }, { path: 'mmproj-Q8_0.gguf', size: 40 }]);
  eq([vs.length, vs[0].mmproj.path, vs[0].msize], [1, 'mmproj-F16.gguf', 80]);
  eq(catalog.variantsFromFiles([{ path: 'a-Q4_K_M.gguf', size: 1 }])[0].mmproj, undefined);
  ok(catalog.SEED.some(s => s.vision), 'نماذج رؤية في الكتالوج');

  /* ---------- المتجر: تنزيل أصلي ---------- */
  store._reset(); Object.keys(kvm).forEach(k => delete kvm[k]);
  device.cfgSet({ wifiOnly: true, token: 'hf_x' });
  const spec = { id: 'org/Vis-GGUF:Q4_K_M', repo: 'org/Vis-GGUF', quant: 'Q4_K_M', name: 'Vis 4B', params: 4, ar: 2, tags: ['vision'], files: [{ path: 'Vis-Q4_K_M.gguf', size: 3000 }, { path: 'mmproj-F16.gguf', size: 800, role: 'mmproj' }] };
  const rec = await store.enqueue(spec, { freeGB: 100 });
  eq([rec.storage, rec.vision, rec.state], ['native', true, 'queued']);
  const enq = calls.find(c => c[0] === 'enq')[1];
  eq([enq.wifiOnly, enq.headers.authorization, enq.files.map(f => f.name), enq.dir], [true, 'Bearer hf_x', ['Vis-Q4_K_M.gguf', 'mmproj-F16.gguf'], 'org_Vis-GGUF_Q4_K_M']);
  ok(/resolve\/main\/mmproj-F16\.gguf/.test(enq.files[1].url), 'رابط mmproj');
  const j = jobs.get(spec.id); j.state = 'downloading'; j.bps = 5e6; j.files[0].done = 1500; store.syncNative();
  const r1 = store.get(spec.id); eq([r1.state, r1.bytes, r1.bps], ['downloading', 1500, 5e6]);
  ok(store.hasActive(), 'نشط أثناء التنزيل');
  store.pause(spec.id); ok(calls.some(c => c[0] === 'pause' && c[1] === spec.id), 'إيقاف مؤقت للخدمة'); store.syncNative(); eq(store.get(spec.id).state, 'paused');
  store.resume(spec.id); ok(calls.some(c => c[0] === 'resume'), 'استئناف'); eq(store.get(spec.id).state, 'queued');
  j.state = 'ready'; j.files.forEach(f => { f.done = f.size; }); store.syncNative();
  eq(store.get(spec.id).state, 'ready');
  const pth = store.paths(spec.id); eq(pth, { model: '/data/files/quark-models/org_Vis-GGUF_Q4_K_M/Vis-Q4_K_M.gguf', mmproj: '/data/files/quark-models/org_Vis-GGUF_Q4_K_M/mmproj-F16.gguf' });
  j.state = 'error'; j.err = 'x'; j.code = 'auth'; const r2 = store.get(spec.id); r2.state = 'downloading'; store.syncNative(); eq([r2.state, r2.errCode], ['error', 'auth']);
  j.state = 'ready'; r2.state = 'downloading'; store.syncNative(); eq(store.get(spec.id).state, 'ready');

  /* ---------- المحرك: محادثة أصلية ---------- */
  engine.resetDevice();
  const am = { ep: { proto: 'ondevice' }, model: spec.id };
  const hist = [{ role: 'user', content: 'ما هذه؟', images: [{ mime: 'image/png', data: 'data:image/png;base64,QUJD' }] }];
  const out = []; for await (const c of engine.chat(am, hist, null, { temperature: 0.5 }, 'sys')) out.push(c);
  eq(out.filter(c => typeof c === 'string').join(''), 'مرحبًا 😀 بك'); eq(out.filter(c => c.think).map(c => c.think).join(''), 'أفكّر');
  eq(out[out.length - 1].usage, { in: 30, out: 20, think: 0 });
  eq([loadReq.model.endsWith('Vis-Q4_K_M.gguf'), loadReq.mmproj.endsWith('mmproj-F16.gguf')], [true, true]);
  eq(lastReq.messages.map(m => [m.role, m.nimg || 0]), [['system', 0], ['user', 1]]);
  ok(lastReq.messages[1].content.endsWith('/no_think') === false, 'لا /no_think لغير qwen3');
  eq([lastImgs.length, lastReq.temp, lastReq.think], [1, 0.5, false]);
  ok(device.benchGet().bw > 0, 'قياس السرعة حُفظ');
  /* ctx error → يقصّ ويعيد المحاولة */
  emitCtxErrOnce = true;
  const hist2 = [{ role: 'user', content: 'قديم' }, { role: 'assistant', content: 'رد' }, { role: 'user', content: 'جديد' }];
  const o2 = []; for await (const c of engine.chat(am, hist2, null, {}, '')) o2.push(c);
  ok(o2.some(c => typeof c === 'string') && lastReq.messages.length < 3, 'قصّ بعد تجاوز السياق وأعاد المحاولة');
  /* نموذج بلا رؤية: تُهمل الصور */
  const nb = engine.toNativeMessages(hist, '', { vision: false }); eq([nb.seen, nb.messages[0].imgs.length], [1, 0]);
  const many = engine.toNativeMessages([1, 2, 3, 4, 5].map(i => ({ role: i % 2 ? 'user' : 'assistant', content: 'x', images: i % 2 ? [{ data: 'data:image/png;base64,A' + i }] : [] })), '', { vision: true, maxImgs: 2 });
  eq(many.messages.reduce((a, m) => a + m.imgs.length, 0), 2); eq(many.messages.filter(m => m.imgs.length).map(m => m.imgs[0]), ['data:image/png;base64,A3', 'data:image/png;base64,A5']);
  /* إلغاء أثناء التوليد */
  const ac2 = new AbortController(); let err = null; const t = [];
  try { for await (const c of engine.chat(am, hist2, ac2.signal, {}, '')) { t.push(c); if (t.length === 1) ac2.abort(); } } catch (e) { err = e; }
  ok(err && err.name === 'AbortError', 'الإلغاء يرمي AbortError');
  /* حذف */
  await store.remove(spec.id); ok(calls.some(c => c[0] === 'cancel') && !store.get(spec.id), 'الحذف عبر الخدمة');
  /* بدون جسر → WASM */
  const savedQN = globalThis.window.QuarkNative; delete globalThis.window.QuarkNative; native.__reset();
  ok(!native.available() && !store.useNative(), 'خارج التطبيق لا يتوفر المحرك الأصلي'); globalThis.window.QuarkNative = savedQN;
  console.log('OK — ' + n + ' تأكيدًا');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
