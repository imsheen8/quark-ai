// اختبار منطق «النماذج على الجهاز»: فحص الجهاز، الكتالوج وقراءة ملفات GGUF، تقييم الملاءمة، أدوات المحرك، ونواة التنزيل (استئناف/Range/أخطاء).
// تشغيل: node tests/test_ondevice.js
const assert = require('assert');
const device = require('../js/features/od-device.js');
const catalog = require('../js/features/od-catalog.js');
const fit = require('../js/features/od-fit.js');
const store = require('../js/features/od-store.js');
const engine = require('../js/features/od-engine.js');
const GB = 1024 ** 3;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

(async () => {
  /* ---------- الجهاز ---------- */
  eq(device.parseUA('Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A) AppleWebKit').android, 14);
  eq(device.parseUA('Mozilla/5.0 (Linux; Android 13; Pixel 7) Chrome/120').model, 'Pixel 7');
  const nat = { totalMem: 6 * GB, availMem: 2.5 * GB, freeBytes: 40 * GB, totalBytes: 128 * GB, cores: 8, release: '14', sdk: 34, brand: 'samsung', model: 'SM-A546E', soc: 'Exynos 1380', abi: 'arm64-v8a' };
  const d1 = await device.detect({ navigator: { userAgent: 'Android 14; SM-A546E', hardwareConcurrency: 8 }, native: nat, gpu: 'Mali-G68', isolated: false });
  eq([d1.ram, d1.ramExact, d1.src, d1.tier, d1.freeGB, d1.threads], [6, true, 'native', 'mid', 40, false]);
  ok(Math.abs(d1.usableGB - 3) < 1e-9 && d1.availWarn === undefined || d1.availWarn === true, 'ذاكرة متاحة');
  const d2 = await device.detect({ navigator: { userAgent: 'Android 12; X', deviceMemory: 4, hardwareConcurrency: 4 }, native: null, gpu: '' });
  eq([d2.ram, d2.ramExact, d2.ramGuess, d2.tier, d2.src], [4, false, true, 'mid', 'web']);
  const d3 = await device.detect({ navigator: { userAgent: 'x' }, native: null, gpu: '' });
  eq([d3.ram, d3.tier], [4, 'mid']);                                   // لا معلومة → افتراض
  const hi = device.classify({ ram: 16, cores: 8, isolated: true, sab: true, ramExact: true });
  eq([hi.tier, hi.threads, hi.usableGB], ['ultra', true, 3.4]);        // سقف المحرك 3.4GB حتى مع ذاكرة كبيرة
  ok(hi.bwGBs > 3, 'تعدد الخيوط يرفع النطاق');
  const low = device.classify({ ram: 2, cores: 4 });
  eq([low.tier, low.usableGB], ['low', 1]);

  /* ---------- الكتالوج ---------- */
  eq([catalog.quantOf('Qwen2.5-1.5B-Instruct-Q4_K_M.gguf'), catalog.quantOf('qwen2.5-0.5b-instruct-q4_k_m.gguf'), catalog.quantOf('model-IQ4_XS.gguf'), catalog.quantOf('x-Q8_0.gguf'), catalog.quantOf('m-BF16.gguf')], ['Q4_K_M', 'Q4_K_M', 'IQ4_XS', 'Q8_0', 'BF16']);
  eq(catalog.quantOf('Qwen3-4B-Q4_K_M-00001-of-00002.gguf'), 'Q4_K_M');
  const files = [
    { path: 'README.md', size: 10 }, { path: 'm-Q4_K_M.gguf', size: 900 }, { path: 'm-Q8_0.gguf', size: 1600 }, { path: 'm-Q5_K_M.gguf', size: 1100 },
    { path: 'mmproj-F16.gguf', size: 500 }, { path: 'm.imatrix.gguf', size: 5 },
    { path: 'big-Q4_K_M-00001-of-00002.gguf', size: 2000 }, { path: 'big-Q4_K_M-00002-of-00002.gguf', size: 1500 },
    { path: 'half-Q4_K_M-00001-of-00003.gguf', size: 100 },
    { path: 'sub/dir-Q3_K_M.gguf', size: 700, lfs: { size: 700 } },
  ];
  const vars = catalog.variantsFromFiles(files);
  eq(vars.map(v => v.quant + ':' + v.size + ':' + v.files.length).sort(), ['Q3_K_M:700:1', 'Q4_K_M:3500:2', 'Q4_K_M:900:1', 'Q5_K_M:1100:1', 'Q8_0:1600:1']);   // mmproj/imatrix/أجزاء ناقصة مستبعدة
  eq(catalog.pickVariant(vars.filter(v => v.files.length === 1), 0).quant, 'Q4_K_M');
  eq(catalog.pickVariant(vars.filter(v => v.files.length === 1), 800).quant, 'Q3_K_M');          // الأعلى تفضيلًا مما يتسع
  eq(catalog.pickVariant(vars.filter(v => v.files.length === 1), 100).quant, 'Q3_K_M');          // لا شيء يتسع → الأصغر
  eq(catalog.pickVariant(vars, 0, 'Q8_0').quant, 'Q8_0');
  eq(catalog.parseUrl('https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf?download=true'), { repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', rev: 'main', path: 'qwen2.5-0.5b-instruct-q4_k_m.gguf' });
  eq(catalog.cleanRepo('https://huggingface.co/unsloth/Qwen3-4B-GGUF/tree/main'), 'unsloth/Qwen3-4B-GGUF');
  ok(catalog.validRepo('a/b-c.d') && !catalog.validRepo('abc') && !catalog.validRepo('a/b/c'));
  eq([catalog.paramsFromName('Qwen2.5-1.5B-Instruct'), catalog.paramsFromName('SmolLM2-360M'), catalog.paramsFromName('Llama-3.2-3B'), catalog.paramsFromName('foo')], [1.5, 0.36, 3, 0]);
  ok(catalog.approxBytes(1.5) > 0.85 * GB && catalog.approxBytes(1.5) < 1.1 * GB);
  eq(catalog.fileUrl({ base: 'https://hf-mirror.com/' }, 'a/b', 'sub/x y.gguf'), 'https://hf-mirror.com/a/b/resolve/main/sub/x%20y.gguf?download=true');
  ok(catalog.SEED.every(s => catalog.validRepo(s.repo) && s.params > 0) && new Set(catalog.SEED.map(s => s.id)).size === catalog.SEED.length);
  // واجهة HF بنسخة وهمية
  const calls = [];
  const mf = async (url, o) => { calls.push([url, o.headers]); if (/tree\/main/.test(url)) return { ok: true, status: 200, json: async () => files.map(f => ({ type: 'file', path: f.path, size: f.size })) }; if (/\/api\/models\?/.test(url)) return { ok: true, status: 200, json: async () => [{ id: 'a/Foo-3B-GGUF', downloads: 5 }, { id: 'b/Bar-GGUF', downloads: 1 }, {}] }; return { ok: false, status: 404, json: async () => ({}) }; };
  eq((await catalog.resolveRepo('o/r', { base: 'https://huggingface.co', token: 'T' }, mf)).length, 5);
  eq(calls[0][1].authorization, 'Bearer T');
  ok(/recursive=true/.test(calls[0][0]));
  const sr = await catalog.search('foo', {}, mf); eq(sr.map(x => [x.repo, x.params]), [['a/Foo-3B-GGUF', 3], ['b/Bar-GGUF', 0]]);
  await assert.rejects(() => catalog.resolveRepo('x/y', {}, async () => ({ ok: false, status: 404 })), /لم يُعثر/); n++;
  await assert.rejects(() => catalog.resolveRepo('x/y', {}, async () => ({ ok: false, status: 401 })), /تسجيل دخول/); n++;
  await assert.rejects(() => catalog.resolveRepo('x/y', {}, async () => ({ ok: true, status: 200, json: async () => [{ type: 'file', path: 'a.md' }] })), /لا توجد ملفات GGUF/); n++;

  /* ---------- الملاءمة ---------- */
  const mk = (gb, params, extra = {}) => ({ sizeBytes: gb * GB, params, ...extra });
  const phone = device.classify({ ram: 8, cores: 8, ramExact: true, isolated: false, sab: true });                    // خيط واحد
  const weak = device.classify({ ram: 3, cores: 4, ramExact: true });
  const f1 = fit.fit(mk(0.4, 0.5), phone), f2 = fit.fit(mk(1.0, 1.5), phone), f3 = fit.fit(mk(2.5, 4), phone), f4 = fit.fit(mk(4.5, 7), phone);
  eq([f1.level, f2.level], ['great', 'good']);
  ok(['slow', 'tight'].includes(f3.level) && f3.ctx === 2048, 'نموذج 4B على خيط واحد: على الحد وسياق مخفَّض');
  eq(f4.level, 'no'); ok(/محرك/.test(f4.why[0]));
  ok(f1.tps > f2.tps && f2.tps > f3.tps, 'السرعة تقل مع الحجم');
  eq(fit.fit(mk(1.0, 1.5), weak).level === 'no' || fit.fit(mk(1.0, 1.5), weak).level === 'tight' || fit.fit(mk(1.0, 1.5), weak).level === 'slow', true);
  eq(fit.fit(mk(2.0, 3), weak).level, 'no');                                                                           // 3GB RAM لا تتسع لـ 2GB
  ok(fit.ctxFor(phone) === 4096 && fit.ctxFor(weak) === 1536 && fit.ctxFor(phone, 1024) === 1024);
  eq(fit.fmtBytes(1.5 * GB), '1.5 GB'); eq(fit.fmtBytes(300 * 1048576), '300 MB'); eq(fit.fmtTps(0.4), '<1'); eq(fit.fmtTps(12.3), '12');
  const items = catalog.SEED.map(s => ({ ...s, sizeBytes: catalog.approxBytes(s.params) })).map(x => ({ ...x, fit: fit.fit(x, phone) }));
  const g = fit.pickGroups(items);
  ok(g.best && g.best.fit.level !== 'no', 'يوجد اقتراح'); ok(g.fast.params <= g.best.params + 1e-9, 'الأسرع ليس أكبر من الأنسب');
  ok(g.arabic && g.arabic.ar >= 2); ok(g.code && g.code.tags.includes('code'));
  const gw = fit.pickGroups(catalog.SEED.map(s => { const x = { ...s, sizeBytes: catalog.approxBytes(s.params) }; return { ...x, fit: fit.fit(x, weak) }; }));
  ok(gw.best && gw.best.params <= 1.7, 'الجهاز الضعيف يُقترح له نموذج صغير: ' + (gw.best && gw.best.name));
  ok(g.best.params >= gw.best.params, 'الجهاز الأقوى لا يُقترح له أقل');
  // معايرة بالقياس الفعلي ترفع الدقة
  const meas = device.classify({ ram: 8, cores: 8, ramExact: true }, device.CFG_DEF, { bw: 9, n: 3 });
  eq([meas.bwGBs, meas.bwMeasured], [9, true]);

  /* ---------- أدوات المحرك ---------- */
  const sp = new engine.ThinkSplitter();
  eq([...sp.feed('مرحبا <thi'), ...sp.feed('nk>أفكر'), ...sp.feed(' الآن</th'), ...sp.feed('ink>الجواب'), ...sp.flush()], ['مرحبا ', { think: 'أفكر' }, { think: ' الآن' }, 'الجواب']);
  const sp2 = new engine.ThinkSplitter(); eq([...sp2.feed('a < b and 3 <'), ...sp2.flush()], ['a < b and 3 ', '<']);
  const sp3 = new engine.ThinkSplitter(); eq([...sp3.feed('<think>غير مغلق'), ...sp3.flush()], [{ think: 'غير مغلق' }]);
  const long = n2 => 'س'.repeat(n2);
  const msgs = [{ role: 'system', content: 'sys' }, { role: 'user', content: long(3000) }, { role: 'assistant', content: long(3000) }, { role: 'user', content: long(3000) }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'سؤالي الأخير' }];
  const t = engine.trimHistory(msgs, 2048, 512);
  eq(t.messages[0].role, 'system'); eq(t.messages[t.messages.length - 1].content, 'سؤالي الأخير'); ok(t.dropped > 0 && t.messages[1].role === 'user', 'يقص الأقدم ويبدأ بمستخدم');
  eq(engine.trimHistory(msgs.slice(0, 1).concat(msgs.slice(5)), 2048, 512).dropped, 0);
  const huge = engine.trimHistory([{ role: 'user', content: long(20000) }], 1024, 256); ok(huge.messages[0].content.length < 4000 && huge.dropped === 1);
  const tm = engine.toMessages([{ role: 'user', content: 'a', images: [1] }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' }], 'SYS', { noThink: true });
  eq(tm.messages.map(m => m.role + ':' + m.content), ['system:SYS', 'user:a\n\nb', 'assistant:c', 'user:d /no_think']); eq(tm.imgs, 1);
  ok(/الذاكرة لا تكفي/.test(engine.friendly(new Error('RangeError: WebAssembly.Memory.grow(): Maximum memory size exceeded'))));
  ok(/الصيغة غير مدعومة/.test(engine.friendly(new Error('unknown model architecture: foo'))));

  /* ---------- نواة التنزيل ---------- */
  const bytes = Buffer.alloc(200000); bytes.write('GGUF', 0); for (let i = 4; i < bytes.length; i++) bytes[i] = i % 251;
  const memIo = (init = Buffer.alloc(0)) => { let buf = Buffer.from(init); return { buf: () => buf, size: () => buf.length, write: (b, at) => { const nb = Buffer.alloc(Math.max(buf.length, at + b.byteLength)); buf.copy(nb); Buffer.from(b).copy(nb, at); buf = nb; }, truncate: k => { buf = buf.subarray(0, k); }, flush: () => {}, finish: () => {}, head4: () => buf.subarray(0, 4).toString('latin1') }; };
  const mkFetch = (opt = {}) => {
    const log = [];
    const f = async (url, o) => {
      const range = o.headers && o.headers.Range, start = range ? Number(/bytes=(\d+)-/.exec(range)[1]) : 0; log.push(range || '-');
      if (opt.status) return { status: opt.status, ok: false, headers: { get: () => null } };
      if (opt.ignoreRange) { const body = bytes; return stream(200, body, 0, null, o.signal); }
      if (start >= bytes.length) return { status: 416, ok: false, headers: { get: () => null } };
      const cutAt = opt.cut && log.length === 1 ? opt.cut : bytes.length;
      const part = bytes.subarray(start, Math.min(bytes.length, cutAt));
      return stream(range ? 206 : 200, bytes.subarray(start), start, part, o.signal);
    };
    const stream = (status, full, start, part, signal) => {
      part = part || full; let pos = 0;
      const chunks = []; for (let i = 0; i < part.length; i += 16384) chunks.push(part.subarray(i, i + 16384));
      return { status, ok: true, headers: { get: h => (h === 'content-length' ? String(full.length) : h === 'content-range' && status === 206 ? `bytes ${start}-${bytes.length - 1}/${bytes.length}` : null) }, body: { getReader: () => ({ read: async () => { if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); await new Promise(r => setImmediate(r)); return pos < chunks.length ? { done: false, value: chunks[pos++] } : { done: true }; } }) } };
    };
    return { f, log };
  };
  const run = async (m, io, fetchImpl, stopAfter) => {
    const out = []; let stop = false, ctl = null;
    const env = { fetch: fetchImpl, AbortController, stopped: () => stop, setCtl: c => { ctl = c; } };
    const wr = io.write; if (stopAfter) io.write = (b, at) => { wr(b, at); if (at + b.byteLength >= stopAfter && !stop) { stop = true; if (ctl) ctl.abort(); } };
    await store.odDlCore(m, io, x => out.push(x), env);
    return out;
  };
  // 1) تنزيل كامل
  let io = memIo(), F = mkFetch();
  let out = await run({ url: 'u', size: bytes.length }, io, F.f);
  eq(out[out.length - 1], { type: 'done', size: bytes.length }); ok(io.buf().equals(bytes), 'المحتوى مطابق'); eq(F.log, ['-']);
  // 2) استئناف من جزء موجود
  io = memIo(bytes.subarray(0, 50000)); F = mkFetch();
  out = await run({ url: 'u', size: bytes.length }, io, F.f);
  eq(F.log, ['bytes=50000-']); ok(io.buf().equals(bytes) && out.at(-1).type === 'done', 'استئناف سليم');
  // 3) انقطاع في المنتصف ثم إعادة المحاولة تلقائيًا بـ Range
  io = memIo(); F = mkFetch({ cut: 70000 });
  out = await run({ url: 'u', size: bytes.length }, io, F.f);
  ok(out.some(x => x.type === 'retrying') && io.buf().equals(bytes) && F.log[1] === 'bytes=70000-' + '' || /bytes=\d+-/.test(F.log[1]), 'استأنف بعد الانقطاع: ' + F.log.join(','));
  ok(io.buf().equals(bytes));
  // 4) الخادم يتجاهل Range → يعيد من الصفر دون تلف
  io = memIo(bytes.subarray(0, 30000)); F = mkFetch({ ignoreRange: true });
  out = await run({ url: 'u', size: bytes.length }, io, F.f); ok(io.buf().equals(bytes) && out.at(-1).type === 'done', 'تجاهل Range');
  // 5) إيقاف مؤقت ثم متابعة
  io = memIo(); F = mkFetch();
  out = await run({ url: 'u', size: bytes.length }, io, F.f, 60000);
  eq(out.at(-1).type, 'stopped'); ok(io.buf().length >= 60000 && io.buf().length < bytes.length);
  const have = io.buf().length; F = mkFetch();
  out = await run({ url: 'u', size: bytes.length }, io, F.f); eq(F.log, ['bytes=' + have + '-']); ok(io.buf().equals(bytes));
  // 6) ملف مكتمل مسبقًا
  io = memIo(bytes); F = mkFetch(); out = await run({ url: 'u', size: bytes.length }, io, F.f); eq(F.log, []); eq(out.at(-1).type, 'done');
  // 7) أخطاء
  await assert.rejects(() => run({ url: 'u', size: 10 }, memIo(), mkFetch({ status: 404 }).f), e => e.code === 'notfound'); n++;
  await assert.rejects(() => run({ url: 'u', size: 10 }, memIo(), mkFetch({ status: 401 }).f), e => e.code === 'auth'); n++;
  await assert.rejects(() => run({ url: 'u', size: 10 }, memIo(), mkFetch({ status: 400 }).f), e => e.code === 'http'); n++;
  const html = Buffer.from('<html>not a model at all</html>');
  const hf = async () => ({ status: 200, ok: true, headers: { get: h => (h === 'content-length' ? String(html.length) : null) }, body: { getReader: () => { let d = false; return { read: async () => (d ? { done: true } : (d = true, { done: false, value: html }) ) }; } } });
  await assert.rejects(() => run({ url: 'u', size: html.length }, memIo(), hf), e => e.code === 'badfile'); n++;
  await assert.rejects(() => run({ url: 'u', size: html.length + 5 }, memIo(), hf), e => e.code === 'size' || e.code === 'badfile'); n++;
  // الملف أكبر من المتوقع يُعاد من الصفر
  io = memIo(Buffer.alloc(bytes.length + 10, 1)); F = mkFetch(); out = await run({ url: 'u', size: bytes.length }, io, F.f); ok(io.buf().equals(bytes));
  // نص عامل التنزيل صالح كشيفرة
  new Function(store.WORKER_SRC()); n++;

  console.log('OK — ' + n + ' تأكيدًا');
})().catch(e => { console.error(e); process.exit(1); });
