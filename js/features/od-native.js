/* QUARK AI — جسر المحرك الأصلي (llama.cpp عبر JNI) وخدمة التنزيل في الخلفية — يتصل بـ window.QuarkNative داخل تطبيق أندرويد.
   خارج التطبيق (متصفح/اختبارات) تكون available() = false فيُستعمل محرك WASM. */
(function(root){
  'use strict';
  const od = root.__od = root.__od || {};
  const QN = () => (root.window && root.window.QuarkNative) || null;
  let info = null, seq = 0;
  const reqs = new Map();                                              /* id → { on(ev) } */

  /* سجل الأخطاء: أخطاء المحرك الأصلي (تحميل/توليد) بتفاصيلها الخام */
  function logNative(kind, o){
    try{ if (root.__errlog) root.__errlog.add({ src:'native', msg:(kind === 'load' ? 'تحميل النموذج: ' : 'التوليد: ') + String(o.error || 'خطأ'), code:o.code, ctx:{ kind, code:o.code, need:o.need, ctx:o.ctx, gpu:o.gpu, gpu_note:o.gpu_note }, key:'nat|' + kind + '|' + o.code + '|' + String(o.error || '').slice(0, 100) }); }catch{}
  }
  function readInfo(force){
    if (info && !force) return info;
    const n = QN();
    if (!n || typeof n.odInfo !== 'function'){ return (info = { available:false, error:'no-bridge' }); }
    try{ info = JSON.parse(n.odInfo() || '{}'); }catch(e){ info = { available:false, error:String(e && e.message || e) }; }
    return info;
  }
  const available = () => !!readInfo().available;
  const dlAvailable = () => available() && !!QN() && typeof QN().dlEnqueue === 'function';

  /* الأحداث القادمة من Java: {t:'tok'|'pp'|'done'|'err'|'loaded', id, ...} */
  const ev = o => { const r = o && reqs.get(o.id); if (r) { try{ r.on(o); }catch{} } };
  root.window && (root.window.__odn = { ev });
  if (!root.window) root.__odn = { ev };                              /* اختبارات Node */

  /* ---------- تحميل النموذج ---------- */
  function load(opts){
    const n = QN(); if (!n) return Promise.reject(new Error('المحرك الأصلي غير متاح.'));
    const id = 'L' + (++seq);
    return new Promise((resolve, reject) => {
      reqs.set(id, { on:o => { if (o.t !== 'loaded') return; reqs.delete(id); o.ok ? resolve(o) : (logNative('load', o), reject(Object.assign(new Error(o.error || 'تعذّر تحميل النموذج'), { code:o.code || 'load' }))); } });
      try{ n.llamaLoad(id, JSON.stringify(opts)); }catch(e){ reqs.delete(id); reject(e); }
    });
  }

  /* ---------- المحادثة بالبث: مولّد يُنتج {tok} و{pp} وينتهي بإحصاءات {stats} ---------- */
  async function* chat(req, images, signal){
    const n = QN(); if (!n) throw new Error('المحرك الأصلي غير متاح.');
    const id = 'C' + (++seq), q = []; let wake = null, end = null;
    reqs.set(id, { on:o => { q.push(o); if (o.t === 'done' || o.t === 'err') end = o; if (wake){ wake(); wake = null; } } });
    const onAbort = () => { try{ n.llamaAbort(); }catch{} };
    if (signal){ if (signal.aborted){ reqs.delete(id); const e = new Error('Aborted'); e.name = 'AbortError'; throw e; } signal.addEventListener('abort', onAbort, { once:true }); }
    try{
      n.llamaChat(id, JSON.stringify(req), images && images.length ? JSON.stringify(images) : '');
      for (;;){
        while (q.length){
          const o = q.shift();
          if (o.t === 'tok') yield { tok:o.s };
          else if (o.t === 'pp') yield { pp:{ done:o.done, total:o.total } };
          else if (o.t === 'done'){ yield { stats:o }; return; }
          else if (o.t === 'err'){ if (o.code !== 'ctx') logNative('chat', o); throw Object.assign(new Error(o.error || 'فشل التوليد'), { code:o.code || 'decode', need:o.need, ctx:o.ctx }); }
        }
        if (end) return;
        await new Promise(r => { wake = r; if (q.length || end){ wake = null; r(); } });
      }
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!end){ try{ n.llamaAbort(); }catch{} }                       /* خرج المستهلك مبكرًا: نوقف التوليد */
      reqs.delete(id);
    }
  }
  const free = () => { try{ QN() && QN().llamaFree && QN().llamaFree(); }catch{} };

  /* ---------- تجهيز الصور: تصغير (حتى 896px) وJPEG لتسريع الترميز على الهاتف ---------- */
  async function prepImage(dataUrl, maxSide = 896){
    const m = /^data:([^;,]+)(?:;base64)?,(.*)$/s.exec(dataUrl || '');
    if (!m) return null;
    const raw = m[2], doc = root.document;
    if (!doc || typeof root.Image === 'undefined') return raw;
    try{
      const img = await new Promise((res, rej) => { const i = new root.Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img')); i.src = dataUrl; });
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, k = Math.min(1, maxSide / Math.max(w, h, 1));
      if (k >= 1 && /jpe?g/i.test(m[1]) && raw.length < 600000) return raw;
      const c = doc.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.85).split(',')[1];
    }catch{ return raw; }
  }

  /* ---------- التنزيل في الخلفية ---------- */
  const parse = s => { try{ return JSON.parse(s || '{}'); }catch{ return {}; } };
  const dl = {
    enqueue:spec => parse(QN().dlEnqueue(JSON.stringify(spec))),
    pause:id => { try{ QN().dlPause(id); }catch{} },
    resume:(id, force) => { try{ QN().dlResume(id, !!force); }catch{} },
    cancel:id => { try{ QN().dlCancel(id); }catch{} },
    state:() => parse(QN().dlState()),
  };
  const join = (rootDir, dir, name) => String(rootDir).replace(/\/+$/, '') + '/' + dir + '/' + name;

  od.native = { available, dlAvailable, readInfo, load, chat, free, prepImage, dl, join, __reset:() => { info = null; reqs.clear(); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = od.native;
})(typeof window !== 'undefined' ? window : globalThis);
