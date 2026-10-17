/* QUARK AI — نماذج على الجهاز: محرك التشغيل
   يشغّل ملفات GGUF المنزَّلة داخل التطبيق عبر llama.cpp المترجَم إلى WebAssembly (مكتبة wllama، تُضمَّن عند البناء في vendor/wllama).
   يُعرَض للتطبيق كنقطة اتصال «على الجهاز» (proto = ondevice) فتعمل مع المحادثة والمقارنة والمهام كأي نموذج آخر. */
(function(root){
  'use strict';
  const od = root.__od = root.__od || {};

  /* =============== أدوات نقية (تُختبر في Node) =============== */
  /* يفصل <think>…</think> من النص المتدفق (حتى لو انقسم الوسم بين دفعتين) */
  class ThinkSplitter{
    constructor(){ this.buf = ''; this.inThink = false; }
    static partial(buf, tag){ for (let k = Math.min(tag.length - 1, buf.length); k > 0; k--) if (buf.endsWith(tag.slice(0, k))) return k; return 0; }
    feed(s){
      this.buf += s; const out = [];
      for (;;){
        const tag = this.inThink ? '</think>' : '<think>', i = this.buf.indexOf(tag);
        if (i >= 0){
          const b = this.buf.slice(0, i); if (b) out.push(this.inThink ? { think:b } : b);
          this.buf = this.buf.slice(i + tag.length); this.inThink = !this.inThink; continue;
        }
        const keep = ThinkSplitter.partial(this.buf, tag), e = this.buf.slice(0, this.buf.length - keep);
        if (e) out.push(this.inThink ? { think:e } : e);
        this.buf = this.buf.slice(this.buf.length - keep); break;
      }
      return out;
    }
    flush(){ const r = this.buf ? [this.inThink ? { think:this.buf } : this.buf] : []; this.buf = ''; return r; }
  }
  /* تقدير الرموز من الأحرف (العربية ≈ 2.4 حرف/رمز، الإنجليزية ≈ 4) */
  const estTokens = s => { s = String(s || ''); const ar = (s.match(/[؀-ۿ]/g) || []).length; return Math.ceil(ar / 2.4 + (s.length - ar) / 3.8) + 4; };
  /* يقصّ أقدم الرسائل حتى يتسع السياق: يبقي الرسالة النظامية وآخر رسالة دائمًا */
  function trimHistory(msgs, nCtx, nPredict){
    const budget = Math.max(256, nCtx - nPredict - 48);
    const sys = msgs.filter(m => m.role === 'system'), rest = msgs.filter(m => m.role !== 'system');
    const cost = m => estTokens(m.content) + 6 + (m.imgs ? m.imgs.length * 320 : 0);
    let used = sys.reduce((n, m) => n + cost(m), 0);
    const keep = [];
    for (let i = rest.length - 1; i >= 0; i--){
      const c = cost(rest[i]);
      if (keep.length && used + c > budget) break;
      keep.unshift(rest[i]); used += c;
    }
    let dropped = rest.length - keep.length;
    /* رسالة واحدة أطول من السياق: نقتطع من بدايتها */
    if (keep.length === 1 && used > budget){
      const m = keep[0], room = Math.max(200, (budget - sys.reduce((n, x) => n + cost(x), 0)) * 2.4);
      keep[0] = { ...m, content:String(m.content).slice(-room) }; dropped++;
    }
    /* القالب يتوقع أن تبدأ المحادثة برسالة مستخدم */
    while (keep.length > 1 && keep[0].role !== 'user'){ keep.shift(); dropped++; }
    return { messages:[...sys, ...keep], dropped };
  }
  /* يحوّل سجل التطبيق إلى رسائل نصية فقط */
  function toMessages(history, system, opts = {}){
    const out = []; let imgs = 0;
    if (system) out.push({ role:'system', content:String(system) });
    for (const m of history || []){
      if (m.images && m.images.length) imgs += m.images.length;
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const c = String(m.content == null ? '' : m.content);
      const last = out[out.length - 1];
      if (last && last.role === role && role !== 'system') last.content += '\n\n' + c; else out.push({ role, content:c });
    }
    if (opts.noThink){ const l = out[out.length - 1]; if (l && l.role === 'user') l.content += ' /no_think'; }
    return { messages:out, imgs };
  }
  /* رسائل للمحرك الأصلي: يحمل كل رسالة صورها (imgs) لتُقصّ معها عند ضيق السياق؛ نُبقي آخر maxImgs صور فقط */
  function toNativeMessages(history, system, opts = {}){
    const out = []; let seen = 0;
    if (system) out.push({ role:'system', content:String(system), imgs:[] });
    for (const m of history || []){
      const role = m.role === 'assistant' ? 'assistant' : 'user', c = String(m.content == null ? '' : m.content);
      const all = (m.images || []).map(i => i && i.data).filter(d => typeof d === 'string' && /^data:/.test(d));
      seen += all.length;
      const mine = opts.vision && role === 'user' ? all : [], last = out[out.length - 1];
      if (last && last.role === role && role !== 'system'){ last.content += '\n\n' + c; last.imgs.push(...mine); } else out.push({ role, content:c, imgs:mine.slice() });
    }
    let allow = opts.maxImgs == null ? 3 : opts.maxImgs;
    for (let i = out.length - 1; i >= 0; i--){ out[i].imgs = allow > 0 ? out[i].imgs.slice(-allow) : []; allow -= out[i].imgs.length; }
    if (opts.noThink){ const l = out[out.length - 1]; if (l && l.role === 'user') l.content += ' /no_think'; }
    return { messages:out, seen };
  }
  const flattenNative = msgs => ({ messages:msgs.map(m => ({ role:m.role, content:m.content, ...(m.imgs && m.imgs.length ? { nimg:m.imgs.length } : {}) })), images:msgs.flatMap(m => m.imgs || []) });
  /* يقلّص المحادثة عند «تجاوز السياق»: يحذف صور أقدم رسالة تحملها أولًا ثم أقدم رسالة؛ false إن لم يبقَ ما يُحذف */
  function shrinkNative(msgs){
    const i = msgs.findIndex(m => m.imgs && m.imgs.length && m !== msgs[msgs.length - 1]);
    if (i >= 0){ msgs[i].imgs = []; return true; }
    const j = msgs.findIndex(m => m.role !== 'system');
    if (j >= 0 && msgs.filter(m => m.role !== 'system').length > 1){ msgs.splice(j, 1); while (msgs.length > 2 && msgs[msgs.findIndex(m => m.role !== 'system')].role !== 'user') msgs.splice(msgs.findIndex(m => m.role !== 'system'), 1); return true; }
    const l = msgs[msgs.length - 1];
    if (l && l.imgs && l.imgs.length > 1){ l.imgs = l.imgs.slice(-1); return true; }
    if (l && l.content.length > 400){ l.content = l.content.slice(Math.floor(l.content.length * 0.35)); return true; }
    return false;
  }
  const friendly = e => {
    const s = String(e && (e.message || e) || '');
    if (e && e.code === 'noengine') return s;
    if (e && e.code === 'ctx') return 'الرسالة أطول من سياق النموذج المحلي. قصّر النص أو ارفع «حجم السياق» من إعدادات النماذج على الجهاز.';
    if (e && e.code === 'image') return s;
    if (/memory|alloc|oom|abort\(|RangeError|out of bounds|grow/i.test(s)) return 'الذاكرة لا تكفي لتشغيل هذا النموذج بالحجم الحالي. أغلق التطبيقات الأخرى أو اختر نموذجًا أصغر، أو قلّل «حجم السياق» من إعدادات النماذج على الجهاز.';
    if (/gguf|magic|invalid|unsupported|unknown model architecture/i.test(s)) return 'تعذّر قراءة النموذج: الصيغة غير مدعومة في المحرك الحالي (' + s.slice(0, 120) + ').';
    return s || 'فشل تشغيل النموذج على الجهاز.';
  };

  /* =============== المحرك =============== */
  let lib = null, W = null, loaded = null /* { id, ctx } */, nloaded = null /* المحرك الأصلي */, lock = Promise.resolve(), idleT = null, devCache = null;
  const subs = new Set(), state = { state:'idle', id:'', msg:'' };
  const setState = (st, extra = {}) => { Object.assign(state, { state:st, msg:'' }, extra); subs.forEach(f => { try{ f({ ...state }); }catch{} }); };
  const on = f => { subs.add(f); return () => subs.delete(f); };

  async function loadLib(){
    if (od.__lib) return od.__lib;
    if (lib) return lib;
    const doc = root.document, here = doc ? doc.baseURI : 'http://localhost/';
    const bases = [new URL('vendor/wllama/', here).href, 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2/esm/'];
    let last = null;
    for (const b of bases){
      try{
        const mod = await import(/* webpackIgnore: true */ b + 'index.js');
        if (mod && mod.Wllama){ lib = { Wllama:mod.Wllama, base:b }; return lib; }
      }catch(e){ last = e; }
    }
    throw Object.assign(new Error('محرك تشغيل النماذج (wllama) غير مضمّن في هذا البناء ولا يمكن جلبه الآن. ابنِ التطبيق بعد `npm install` (يُنسخ تلقائيًا إلى vendor/wllama) أو اتصل بالإنترنت لمرة واحدة. ' + (last ? '(' + (last.message || last) + ')' : '')), { code:'noengine' });
  }
  async function engineAvailable(){ if (od.native && od.native.available()) return true; try{ await loadLib(); return true; }catch{ return false; } }
  async function device(){ if (!devCache) devCache = await od.device.detect(); return devCache; }

  async function unload(){
    clearTimeout(idleT);
    const w = W; W = null; loaded = null;
    if (nloaded){ nloaded = null; try{ od.native.free(); }catch{} }
    state.gpu = '';
    if (w){ try{ await w.exit(); }catch{} }
    if (state.state !== 'error') setState('idle', { id:'' });
  }
  const touchIdle = () => {
    clearTimeout(idleT);
    const m = od.device.cfgGet().idleMin;
    if (m > 0) idleT = setTimeout(() => { if (!state.busy) unload(); }, m * 60000);
  };

  async function ensure(rec){
    const cfg = od.device.cfgGet(), dev = await device();
    let ctx = od.fit.ctxForModel(rec.size, rec.params, dev, cfg.ctx); if (rec.ctx) ctx = Math.min(ctx, rec.ctx);
    if (W && loaded && loaded.id === rec.id && loaded.ctx === ctx) return { ctx };
    await unload();
    setState('loading', { id:rec.id, msg:'جارٍ تحميل النموذج في الذاكرة…' });
    try{
      const L = await loadLib();
      const files = await od.store.blobs(rec.id);
      const paths = { 'single-thread/wllama.wasm':L.base + 'single-thread/wllama.wasm', 'multi-thread/wllama.wasm':L.base + 'multi-thread/wllama.wasm' };
      const w = new L.Wllama(paths, { suppressNativeLog:true, allowOffline:true });
      const t0 = performance.now();
      await w.loadModel(files, { n_ctx:ctx, n_batch:512, ...(dev.threads ? { n_threads:Math.max(1, Math.min(6, (dev.cores || 4) - 1)) } : {}) });
      W = w; loaded = { id:rec.id, ctx, ms:Math.round(performance.now() - t0) };
      setState('ready', { id:rec.id, ctx, loadMs:loaded.ms });
      return { ctx };
    }catch(e){
      W = null; loaded = null; setState('error', { id:rec.id, msg:friendly(e) });
      throw Object.assign(new Error(friendly(e)), { code:e && e.code });
    }
  }

  /* ---------- تسريع GPU (Vulkan) ---------- */
  const GPU_NOTES = { no_lib:'هذا الـ APK بُني بلا وحدة GPU', no_device:'لم يجد الهاتف معالجًا رسوميًا يدعم Vulkan', gpu_load_failed:'تعذّر تحميل النموذج على GPU', gpu_ctx_failed:'ذاكرة GPU لا تكفي', gpu_warmup_failed:'فشل اختبار GPU الأوّلي', crashed:'انهار تشغيل GPU في المرة السابقة' };
  function gpuNote(r, cfg){
    if (!cfg.gpu) return;
    if (r.gpu){ state.gpu = r.gpu_name || 'GPU'; return; }
    state.gpu = '';
    const why = GPU_NOTES[r.gpu_note] || 'غير متاح';
    if (r.gpu_note === 'crashed' || r.gpu_note === 'no_lib') od.device.cfgSet({ gpu:false });
    try{ if (root.__errlog) root.__errlog.add({ src:'native', lvl:'warn', force:true, msg:'تسريع GPU غير مفعّل — ' + why, code:r.gpu_note, ctx:{ gpu_note:r.gpu_note } }); }catch{}
    if (typeof root.toast === 'function') root.toast('تسريع GPU غير مفعّل — ' + why + '؛ يعمل النموذج على المعالج');
  }
  /* مقارنة السرعة (معالج مقابل GPU) على نموذج مُنزَّل: يحمّله بالوضعين ويولّد نصًا قصيرًا */
  async function benchGpu(rec, onStep){
    const info = od.native.readInfo();
    if (!od.native.available()) throw new Error('المحرك الأصلي غير متاح');
    if (!info.gpuLib) throw new Error(GPU_NOTES.no_lib);
    const cfg = od.device.cfgGet(), p = od.store.paths(rec.id), out = {};
    for (const mode of ['cpu', 'gpu']){
      await unload(); onStep && onStep(mode);
      const r = await od.native.load({ model:p.model, mmproj:'', n_ctx:1024, n_threads:cfg.threads || 0, n_batch:512, mmap:true, gpu:mode === 'gpu' });
      if (mode === 'gpu' && !r.gpu){ out.gpu = { err:GPU_NOTES[r.gpu_note] || 'غير متاح' }; continue; }
      let st = null;
      const req = { messages:[{ role:'user', content:'اكتب فقرة قصيرة عن الشمس والقمر.' }], n_predict:48, temp:0, top_k:1, think:false };
      for await (const ev of od.native.chat(req, [], null)){ if (ev.stats) st = ev.stats; }
      out[mode] = st ? { tps:st.t_gen_ms > 0 ? st.n_gen * 1000 / st.t_gen_ms : 0, pps:st.t_prompt_ms > 0 ? st.n_prompt * 1000 / st.t_prompt_ms : 0, name:r.gpu_name || '' } : { err:'لا نتيجة' };
    }
    await unload();
    return out;
  }

  /* ---------- المحرك الأصلي (llama.cpp) ---------- */
  async function ensureNative(rec){
    const cfg = od.device.cfgGet(), dev = await device();
    const extra = (rec.files || []).filter(f => f.role === 'mmproj').reduce((n, f) => n + (f.size || 0), 0), msize = Math.max(1, (rec.size || 0) - extra);
    let ctx = od.fit.ctxForModel(msize, rec.params, dev, cfg.ctx, extra); if (rec.ctx) ctx = Math.min(ctx, rec.ctx);
    if (nloaded && nloaded.id === rec.id && nloaded.ctx === ctx && nloaded.threads === cfg.threads && nloaded.wantGpu === cfg.gpu) return nloaded;
    await unload();
    setState('loading', { id:rec.id, msg:'جارٍ تحميل النموذج في الذاكرة…' });
    try{
      const p = od.store.paths(rec.id), t0 = Date.now();
      const r = await od.native.load({ model:p.model, mmproj:p.mmproj, n_ctx:ctx, n_threads:cfg.threads || 0, n_batch:512, mmap:true, gpu:cfg.gpu });
      nloaded = { id:rec.id, ctx:r.n_ctx || ctx, vision:!!r.vision, threads:cfg.threads, msize, gpu:!!r.gpu, gpuName:r.gpu_name || '', wantGpu:cfg.gpu };
      gpuNote(r, cfg);
      setState('ready', { id:rec.id, ctx:nloaded.ctx, loadMs:Date.now() - t0, native:true });
      return nloaded;
    }catch(e){
      nloaded = null; const m = friendly(e); setState('error', { id:rec.id, msg:m }); throw Object.assign(new Error(m), { code:e && e.code });
    }
  }

  async function* chatNative(rec, am, history, signal, P, system){
    const id = am.model, cfg = od.device.cfgGet(), N = await ensureNative(rec);
    const abortErr = () => { const e = new Error('Aborted'); e.name = 'AbortError'; return e; };
    if (signal && signal.aborted) throw abortErr();
    state.busy = true; clearTimeout(idleT); setState('busy', { id, native:true });
    const noThink = !cfg.think && /qwen3/i.test(id);
    const nb = toNativeMessages(history, system, { noThink, vision:N.vision, maxImgs:3 });
    if (nb.seen && !N.vision && typeof root.toast === 'function') root.toast('هذا النموذج المحلي نصّي فقط — تجاهلتُ الصور المرفقة (نزّل نموذجًا يدعم الصور)');
    const nPredict = Math.max(16, Math.min(Number(P.max_tokens) || 1024, Math.floor(N.ctx * 0.6)));
    const tr = trimHistory(nb.messages, N.ctx, nPredict); let msgs = tr.messages;
    if (tr.dropped && typeof root.toast === 'function') root.toast('قُصّ جزء من بداية المحادثة ليتسع سياق النموذج المحلي');
    const sp = new ThinkSplitter(); let stats = null, gotTok = false, lastPct = -1;
    try{
      for (let attempt = 0; ; attempt++){
        const flat = flattenNative(msgs), imgs = [];
        for (const d of flat.images){ const b = await od.native.prepImage(d); if (b) imgs.push(b); }
        const req = { messages:flat.messages, n_predict:nPredict, temp:P.temperature != null ? P.temperature : 0.7, top_p:P.top_p != null ? P.top_p : 0.9, top_k:40, min_p:0.05, repeat_penalty:1.08, think:cfg.think };
        try{
          for await (const ev of od.native.chat(req, imgs, signal)){
            if (ev.tok != null){ gotTok = true; for (const x of sp.feed(ev.tok)) yield x; }
            else if (ev.pp){ const pct = ev.pp.total > 300 ? Math.floor(ev.pp.done * 100 / ev.pp.total) : -1; if (pct >= 0 && pct !== lastPct && pct % 5 === 0){ lastPct = pct; setState('busy', { id, native:true, msg:'جارٍ قراءة المحادثة ' + pct + '%' }); } }
            else if (ev.stats) stats = ev.stats;
          }
          break;
        }catch(e){
          if (e && e.code === 'ctx' && !gotTok && attempt < 8 && shrinkNative(msgs)) continue;
          throw e;
        }
      }
      for (const x of sp.flush()) yield x;
      if (signal && signal.aborted) throw abortErr();
      const nIn = stats ? stats.n_prompt : 0, nOut = stats ? stats.n_gen : 0;
      if (stats && nOut >= 8 && stats.t_gen_ms > 50 && !N.gpu) od.device.benchAdd(id, N.msize, nOut * 1000 / stats.t_gen_ms);
      yield { usage:{ in:nIn, out:nOut, think:0 } };
    }catch(e){
      if (e && e.name === 'AbortError') throw e;
      const m = friendly(e); setState('error', { id, msg:m });
      if (e && e.code !== 'ctx' && e.code !== 'image'){ try{ await unload(); }catch{} }
      throw Object.assign(new Error(m), { code:e && e.code });
    }finally{
      state.busy = false; if (state.state === 'busy') setState('ready', { id, native:true }); touchIdle();
    }
  }

  /* قفل بسيط: طلب واحد في كل مرة (الذاكرة لا تسع نموذجين) */
  async function acquire(){ let rel; const prev = lock; lock = new Promise(r => { rel = r; }); await prev; return rel; }

  /* توليد بالبث: يُنتج نصوصًا و{ think } و{ usage } بنفس واجهة callModel */
  async function* chat(am, history, signal, P = {}, system = ''){
    const id = am.model, rec = od.store.get(id);
    if (!rec || rec.state !== 'ready') throw new Error('النموذج غير منزَّل على هذا الجهاز: ' + id);
    const release = await acquire();
    try{ if (rec.storage === 'native') yield* chatNative(rec, am, history, signal, P, system); else yield* run(); }
    finally{ release(); }

    async function* run(){
      if (signal && signal.aborted){ const e = new Error('Aborted'); e.name = 'AbortError'; throw e; }
      const cfg = od.device.cfgGet(), { ctx } = await ensure(rec);
      if (signal && signal.aborted){ const e = new Error('Aborted'); e.name = 'AbortError'; throw e; }
      state.busy = true; clearTimeout(idleT); setState('busy', { id });
      const noThink = !cfg.think && /qwen3/i.test(id);
      const { messages, imgs } = toMessages(history, system, { noThink });
      const nPredict = Math.max(16, Math.min(Number(P.max_tokens) || 1024, Math.floor(ctx * 0.6)));
      const tr = trimHistory(messages, ctx, nPredict);
      if (tr.dropped && typeof root.toast === 'function') root.toast('قُصّ جزء من بداية المحادثة ليتسع سياق النموذج المحلي');
      if (imgs && typeof root.toast === 'function') root.toast('النموذج المحلي نصّي فقط — تجاهلتُ الصور المرفقة');
      const q = [], dec = new TextDecoder('utf-8'), sp = new ThinkSplitter();
      let wake = null, finished = false, failure = null, nTok = 0, tFirst = 0, tLast = 0;
      const push = s => { if (s){ q.push(...sp.feed(s)); if (wake){ wake(); wake = null; } } };
      const ctl = new AbortController(); let aborted = false;
      const onAbort = () => { aborted = true; try{ ctl.abort(); }catch{} };
      if (signal) signal.addEventListener('abort', onAbort, { once:true });
      const sampling = { temp:P.temperature != null ? P.temperature : 0.7, top_p:P.top_p != null ? P.top_p : 0.9, top_k:40, penalty_repeat:1.08 };
      const p = W.createChatCompletion(tr.messages, {
        nPredict, sampling, abortSignal:ctl.signal,
        onNewToken:(token, piece, text, opt) => {
          const now = performance.now(); if (!tFirst) tFirst = now; tLast = now; nTok++;
          if (aborted && opt && typeof opt.abortSignal === 'function') opt.abortSignal();
          push(piece instanceof Uint8Array ? dec.decode(piece, { stream:true }) : (typeof piece === 'string' ? piece : ''));
        },
      }).then(() => { finished = true; }, e => { if (aborted) finished = true; else failure = e; finished = true; })
        .finally(() => { if (wake){ wake(); wake = null; } });
      try{
        for (;;){
          while (q.length) yield q.shift();
          if (finished) break;
          await new Promise(r => { wake = r; if (q.length || finished){ wake = null; r(); } });
        }
        q.push(...sp.flush()); while (q.length) yield q.shift();
        await p;
        if (aborted){ const e = new Error('Aborted'); e.name = 'AbortError'; throw e; }
        if (failure){ setState('error', { id, msg:friendly(failure) }); try{ await unload(); }catch{} throw new Error(friendly(failure)); }
        const outTok = nTok, inTok = tr.messages.reduce((n, m) => n + estTokens(m.content), 0);
        if (outTok >= 8 && tLast > tFirst) od.device.benchAdd(id, rec.size, (outTok - 1) * 1000 / (tLast - tFirst));
        yield { usage:{ in:inTok, out:outTok, think:0 } };
      }finally{
        if (signal) signal.removeEventListener('abort', onAbort);
        if (!finished){ onAbort(); await p.catch(() => {}); }
        state.busy = false; if (state.state === 'busy') setState('ready', { id }); touchIdle();
      }
    }
  }

  /* طلب واحد (عنوان/اختبار): نص كامل */
  async function once(am, prompt, signal, opts = {}){
    const cfg = od.device.cfgGet();
    /* العنوان التلقائي يستهلك بطارية وزمنًا على الهاتف: نكتفي بأول كلمات رسالة المستخدم ما لم يُفعَّل من الإعدادات */
    if (!cfg.autoTitle && /اكتب عنوانًا قصيرًا جدًا/.test(prompt)){
      const m = /المستخدم:\s*([\s\S]*?)(?:\n\nالمساعد:|$)/.exec(prompt), t = ((m && m[1]) || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
      return t;
    }
    let r = '';
    for await (const ch of chat(am, [{ role:'user', content:prompt }], signal, { max_tokens:opts.max || 48, temperature:0.2 }, '')){ if (typeof ch === 'string') r += ch; }
    return r;
  }

  /* اختبار المحرك: يحمّل النموذج ويولّد جملة قصيرة ويقيس السرعة */
  async function selfTest(id){
    const t0 = performance.now(); let text = '', n = 0, tf = 0;
    for await (const ch of chat({ model:id }, [{ role:'user', content:'Say hello in one short sentence.' }], null, { max_tokens:24, temperature:0.2 }, '')){
      if (typeof ch === 'string'){ text += ch; n++; if (!tf) tf = performance.now(); }
    }
    const ms = performance.now() - t0, tps = n > 1 && tf ? (n - 1) * 1000 / (performance.now() - tf) : 0;
    return { ok:text.trim().length > 0, text:text.trim(), ms:Math.round(ms), tps };
  }

  od.engine = { ThinkSplitter, estTokens, trimHistory, toMessages, toNativeMessages, flattenNative, shrinkNative, friendly, chat, once, selfTest, ensure, unload, benchGpu, available:engineAvailable, on, state, device, resetDevice:() => { devCache = null; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = od.engine;
})(typeof window !== 'undefined' ? window : globalThis);
