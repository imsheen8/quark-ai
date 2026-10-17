/* QUARK AI — نماذج على الجهاز: مدير التنزيل والتخزين
   • الملفات تُحفظ في تخزين التطبيق الخاص (OPFS) ولا تخرج من الجهاز.
   • التنزيل يعمل في Worker ويكتب مباشرة على القرص (بلا نسخ في الذاكرة) ويستأنف بـ Range بعد الانقطاع أو إعادة فتح التطبيق.
   • بدون Worker/الكتابة المتزامنة (متصفح قديم) يعود لكتابة عادية مع إمكانية الإيقاف والاستئناف داخل الجلسة. */
(function(root){
  'use strict';
  const od = root.__od = root.__od || {};
  const GB = 1024 * 1024 * 1024, DB_KEY = 'ai_od_models', ROOT_DIR = 'quark-models';

  /* =============== نواة التنزيل (تُشغَّل داخل Worker أو في الصفحة؛ يجب أن تبقى بلا اعتماد على أي متغير خارجي) =============== */
  async function odDlCore(m, io, post, env){
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const fail = (code, msg, retry) => Object.assign(new Error(msg), { code, retry:!!retry });
    let have = await io.size();
    if (m.size && have > m.size){ await io.truncate(0); have = 0; }
    let total = m.size || 0, attempt = 0, lastFlush = have, lastPost = 0, wBytes = have, wT = Date.now(), bps = 0, finished = false;
    const report = force => {
      const now = Date.now();
      if (!force && now - lastPost < 350) return;
      lastPost = now;
      if (now - wT >= 1500){ bps = Math.max(0, (have - wBytes) * 1000 / (now - wT)); wBytes = have; wT = now; }
      post({ type:'progress', done:have, total, bps });
    };
    report(true);
    while (!finished){
      if (total && have >= total){ finished = true; break; }
      if (env.stopped()) break;
      const ctl = new env.AbortController(); env.setCtl(ctl);
      try{
        const headers = Object.assign({}, m.headers || {});
        if (have > 0) headers.Range = 'bytes=' + have + '-';
        const res = await env.fetch(m.url, { headers, signal:ctl.signal, cache:'no-store' });
        if (res.status === 416){
          if (total && have >= total){ finished = true; break; }
          await io.truncate(0); have = 0; attempt++;
          if (attempt > 3) throw fail('http', 'رفض الخادم الاستئناف (416).');
          continue;
        }
        if (res.status === 401 || res.status === 403) throw fail('auth', 'هذا الملف يتطلب تسجيل دخول Hugging Face أو قبول شروط النموذج (أضف الرمز من إعدادات التنزيل).');
        if (res.status === 404) throw fail('notfound', 'الملف غير موجود على الخادم.');
        if (!res.ok) throw fail('http', 'رد غير متوقع من الخادم (' + res.status + ').', res.status >= 500 || res.status === 429);
        if (res.status === 200 && have > 0){ await io.truncate(0); have = 0; wBytes = 0; }     /* الخادم تجاهل Range: نبدأ من الصفر */
        const cr = res.headers.get('content-range'), cl = Number(res.headers.get('content-length')) || 0, mm = cr && /\/(\d+)\s*$/.exec(cr);
        const t = mm ? Number(mm[1]) : (cl ? have + cl : 0);
        if (t) total = t;
        const reader = res.body.getReader();
        for (;;){
          const r = await reader.read();
          if (r.done) break;
          await io.write(r.value, have); have += r.value.byteLength;
          if (have - lastFlush >= 33554432){ await io.flush(); lastFlush = have; }
          report(false);
        }
        if (!total || have >= total){ finished = true; break; }
        attempt++; if (attempt > 8) throw fail('net', 'انقطع الاتصال قبل اكتمال الملف.', true);
        post({ type:'retrying', attempt, msg:'انقطع الاتصال' }); await sleep(Math.min(15000, 600 * Math.pow(2, attempt)));
      }catch(e){
        if (env.stopped()) break;
        if (e && (e.code === 'auth' || e.code === 'notfound' || (e.code === 'http' && !e.retry))) throw e;
        attempt++; if (attempt > 8) throw fail('net', 'تعذّر إكمال التنزيل: ' + (e && e.message || e), true);
        post({ type:'retrying', attempt, msg:String(e && e.message || e) });
        await sleep(Math.min(15000, 600 * Math.pow(2, attempt)));
      }
    }
    await io.flush();
    if (!finished){ post({ type:'stopped', done:have }); return; }
    report(true);
    await io.finish();
    if (m.size && have !== m.size) throw fail('size', 'حجم الملف المُنزَّل (' + have + ') لا يطابق المتوقع (' + m.size + ').', true);
    if ((await io.head4()) !== 'GGUF') throw fail('badfile', 'الملف المُنزَّل ليس نموذج GGUF صالحًا (قد يكون صفحة خطأ).');
    post({ type:'done', size:have });
  }

  /* =============== المحوّلات (Adapters) =============== */
  const WORKER_SRC = () => odDlCore.toString() + `
let ctl = null, stopFlag = false;
const env = { fetch:(...a) => fetch(...a), AbortController, stopped:() => stopFlag, setCtl:c => { ctl = c; } };
self.onmessage = async e => {
  const m = e.data;
  if (m.cmd === 'stop'){ stopFlag = true; if (ctl) ctl.abort(); return; }
  if (m.cmd !== 'start') return;
  stopFlag = false; let h = null;
  try{
    let d = await navigator.storage.getDirectory();
    for (const p of m.dir) d = await d.getDirectoryHandle(p, { create:true });
    const fh = await d.getFileHandle(m.name, { create:true });
    h = await fh.createSyncAccessHandle();
    const io = {
      size:() => h.getSize(), write:(b, at) => { h.write(b, { at }); }, truncate:n => { h.truncate(n); }, flush:() => { h.flush(); }, finish:() => { h.flush(); },
      head4:() => { const b = new Uint8Array(4); h.read(b, { at:0 }); return String.fromCharCode(b[0], b[1], b[2], b[3]); }
    };
    await odDlCore(m, io, x => postMessage(x), env);
  }catch(err){ postMessage({ type:'error', msg:String(err && err.message || err), code:(err && err.code) || '', retry:!!(err && err.retry) }); }
  finally{ try{ if (h) h.close(); }catch(e){} postMessage({ type:'closed' }); }
};`;

  const canWorker = () => {
    try{ return typeof root.Worker !== 'undefined' && typeof root.FileSystemFileHandle !== 'undefined' && typeof root.FileSystemFileHandle.prototype.createSyncAccessHandle === 'function' && !od.__forceMain; }catch{ return false; }
  };
  const getDir = async path => { let d = await root.navigator.storage.getDirectory(); for (const p of path) d = await d.getDirectoryHandle(p, { create:true }); return d; };

  /* يشغّل تنزيل ملف واحد. ctl.stop() يوقفه. cb(msg) يستقبل progress/retrying/stopped/done/error. يعيد Promise تنتهي بعد تحرير الملف. */
  function runFile(m, cb){
    if (od.__runFile) return od.__runFile(m, cb);                                   /* للاختبارات */
    return canWorker() ? runFileWorker(m, cb) : runFileMain(m, cb);
  }
  function runFileWorker(m, cb){
    const url = URL.createObjectURL(new Blob([WORKER_SRC()], { type:'text/javascript' })), w = new root.Worker(url);
    let resolve; const p = new Promise(r => { resolve = r; });
    let closeTimer = null;
    const end = () => { clearTimeout(closeTimer); try{ w.terminate(); }catch{} URL.revokeObjectURL(url); resolve(); };
    w.onmessage = e => {
      const d = e.data;
      if (d.type === 'closed'){ end(); return; }
      cb(d);
      if (d.type === 'done' || d.type === 'error' || d.type === 'stopped') closeTimer = setTimeout(end, 2500);   /* احتياط إن لم يصل closed */
    };
    w.onerror = e => { cb({ type:'error', msg:'فشل تشغيل عامل التنزيل: ' + (e.message || ''), retry:true }); end(); };
    w.postMessage({ cmd:'start', ...m });
    return { done:p, stop:() => { try{ w.postMessage({ cmd:'stop' }); }catch{} } };
  }
  function runFileMain(m, cb){
    let stopFlag = false, ctl = null;
    const env = { fetch:(...a) => root.fetch(...a), AbortController:root.AbortController, stopped:() => stopFlag, setCtl:c => { ctl = c; } };
    const done = (async () => {
      let w = null, fh = null;
      try{
        const d = await getDir(m.dir); fh = await d.getFileHandle(m.name, { create:true });
        const f0 = await fh.getFile(); let size = f0.size;
        w = await fh.createWritable({ keepExistingData:true });
        const io = {
          size:() => size, write:async (b, at) => { await w.write({ type:'write', position:at, data:b }); size = Math.max(size, at + b.byteLength); },
          truncate:async n => { await w.truncate(n); size = n; }, flush:() => {},
          finish:async () => { await w.close(); w = null; },
          head4:async () => { const f = await fh.getFile(); const b = new Uint8Array(await f.slice(0, 4).arrayBuffer()); return String.fromCharCode(b[0], b[1], b[2], b[3]); }
        };
        await odDlCore(m, io, cb, env);
      }catch(err){ cb({ type:'error', msg:String(err && err.message || err), code:err && err.code || '', retry:!!(err && err.retry) }); }
      finally{ try{ if (w) await w.close(); }catch{} }
    })();
    return { done, stop:() => { stopFlag = true; if (ctl) ctl.abort(); } };
  }

  /* =============== السجل والمدير =============== */
  const mem = {};
  const kv = {
    get:(k, d) => { try{ return typeof store !== 'undefined' ? store.get(k, d) : (k in mem ? JSON.parse(mem[k]) : d); }catch{ return d; } },
    set:(k, v) => { try{ if (typeof store !== 'undefined') store.set(k, v); else mem[k] = JSON.stringify(v); }catch{} },
  };
  let recs = null, listeners = new Set(), jobs = new Map(), saveT = null;
  const cfg = () => (od.device ? od.device.cfgGet() : { base:'https://huggingface.co', token:'', wifiOnly:true });
  const load = () => { if (!recs){ recs = kv.get(DB_KEY, {}) || {}; } return recs; };
  const saveNow = () => { clearTimeout(saveT); saveT = null; kv.set(DB_KEY, load()); };
  const saveSoon = () => { if (!saveT) saveT = setTimeout(saveNow, 4000); };
  /* سجل الأخطاء: أي انتقال لحالة «error» (مرة واحدة لكل رسالة) */
  const errSeen = new Map();
  const logDl = id => { try{
    const r = get(id);
    if (!r || r.state !== 'error' || !root.__errlog) return;
    const k = id + '|' + r.errCode + '|' + r.err; if (errSeen.get(id) === k) return; errSeen.set(id, k);
    root.__errlog.add({ src:'download', msg:(r.err || 'فشل التنزيل') + ' — ' + id, code:r.errCode, ctx:{ id, storage:r.storage, code:r.errCode, retryable:!!r.retryable, bytes:r.bytes, size:r.size }, key:'dl|' + id + '|' + r.errCode + '|' + (r.err || '').slice(0, 80) });
  }catch{} };
  const emit = (id, kind) => { if (kind === 'state') logDl(id); listeners.forEach(f => { try{ f({ id, kind:kind || 'update' }); }catch{} }); };
  const slug = id => String(id).replace(/[^\w.-]+/g, '_').slice(0, 100);
  const dirOf = rec => [ROOT_DIR, slug(rec.id)];
  const fileName = (rec, f, i) => (rec.files.length > 1 ? String(i + 1).padStart(2, '0') + '_' : '') + slug(f.path.split('/').pop());
  const sumDone = rec => rec.files.reduce((n, f) => n + (f.done || 0), 0);

  function list(){ return Object.values(load()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)); }
  const get = id => load()[id] || null;
  const isActive = () => [...jobs.values()].some(j => j.state === 'running');
  const hasActive = () => list().some(r => r.state === 'downloading' || r.state === 'queued');
  const totalBytes = () => list().reduce((n, r) => n + (r.state === 'ready' ? r.size : sumDone(r)), 0);

  async function persistStorage(){ try{ await root.navigator.storage?.persist?.(); }catch{} }
  function nativeKeep(on){
    try{
      const n = root.window && root.window.QuarkNative; if (!n) return;
      if (on && typeof n.startGenText === 'function') n.startGenText('جارٍ تنزيل نموذج على الجهاز…');
      else if (!on && typeof n.stopGen === 'function' && !(typeof busy !== 'undefined' && busy)) n.stopGen();
    }catch{}
  }
  root.window && (root.window.__odActive = () => hasActive());

  /* spec: { id, repo, quant, name, fam, params, ar, tags, files:[{path,size}] } */
  async function enqueue(spec, opts = {}){
    const R = load(), size = spec.files.reduce((n, f) => n + (f.size || 0), 0);
    const prev = R[spec.id];
    if (prev && prev.state === 'ready') throw new Error('هذا النموذج منزَّل بالفعل.');
    const free = opts.freeGB != null ? opts.freeGB : (od.__freeGB != null ? od.__freeGB : null);
    const need = (size - (prev ? sumDone(prev) : 0)) / GB + 0.3;
    if (free != null && need > free) throw Object.assign(new Error('المساحة الحرة غير كافية: يلزم ≈' + need.toFixed(1) + ' GB والمتاح ≈' + free.toFixed(1) + ' GB.'), { code:'space' });
    const rec = prev || { id:spec.id, addedAt:Date.now() };
    const native = prev ? prev.storage === 'native' : useNative();
    Object.assign(rec, { storage:native ? 'native' : 'opfs', vision:spec.files.some(f => f.role === 'mmproj'), repo:spec.repo, quant:spec.quant, name:spec.name || spec.id, fam:spec.fam || '', params:spec.params || 0, ar:spec.ar || 0, tags:spec.tags || [], ctx:spec.ctx || 0, size,
      files:spec.files.map((f, i) => ({ path:f.path, role:f.role || '', size:f.size || 0, done:(prev && prev.files[i] && prev.files[i].path === f.path) ? prev.files[i].done || 0 : 0 })), state:'queued', err:'', errCode:'' });
    if (opts.force) rec.force = true;
    R[spec.id] = rec; saveNow(); emit(spec.id, 'state');
    if (native){ nativeStart(rec); return rec; }
    persistStorage();
    pump();
    return rec;
  }

  function pump(){
    if (isActive()) return;
    const next = list().reverse().find(r => r.state === 'queued' && r.storage !== 'native');
    if (next) runRec(next);
  }
  const hint = rec => (od.__net ? od.__net() : (root.navigator && root.navigator.connection)) || {};

  async function runRec(rec){
    const c = cfg(), job = { state:'running', cur:null, stopFlag:false, force:!!rec.force };
    jobs.set(rec.id, job); rec.state = 'downloading'; rec.err = ''; rec.errCode = ''; delete rec.force; saveNow(); emit(rec.id, 'state'); nativeKeep(true);
    if (c.wifiOnly && !job.force && hint(rec).type === 'cellular'){
      rec.state = 'paused'; rec.err = 'بانتظار الواي فاي (ميزة «الواي فاي فقط» مفعّلة).'; rec.errCode = 'wifi';
      jobs.delete(rec.id); saveNow(); emit(rec.id, 'state'); finishJob(); return;
    }
    const headers = c.token ? { authorization:'Bearer ' + c.token } : {};
    try{
      for (let i = 0; i < rec.files.length; i++){
        const f = rec.files[i];
        if (f.size && f.done >= f.size) continue;
        let result = null;
        const h = runFile({ url:od.catalog.fileUrl(c, rec.repo, f.path), headers, dir:dirOf(rec), name:fileName(rec, f, i), size:f.size || 0 }, msg => {
          if (msg.type === 'progress'){ f.done = msg.done; if (msg.total && !f.size){ f.size = msg.total; rec.size = rec.files.reduce((n, x) => n + (x.size || 0), 0); } rec.bps = msg.bps; rec.bytes = sumDone(rec); rec.retry = 0; emit(rec.id, 'progress'); saveSoon(); }
          else if (msg.type === 'retrying'){ rec.retry = msg.attempt; rec.retryMsg = msg.msg; emit(rec.id, 'progress'); }
          else { result = msg; }
        });
        job.cur = h; if (job.stopFlag) h.stop();
        await h.done; job.cur = null;
        if (!result || result.type === 'stopped') { if (job.stopFlag) break; throw new Error('توقف التنزيل بشكل غير متوقع.'); }
        if (result.type === 'error') throw Object.assign(new Error(result.msg), { code:result.code, retry:result.retry });
        if (result.type === 'done'){ f.done = result.size; f.size = result.size; }
      }
      rec.bytes = sumDone(rec);
      if (job.stopFlag){ rec.state = job.after || 'paused'; }
      else { rec.state = 'ready'; rec.bps = 0; rec.readyAt = Date.now(); }
    }catch(e){
      rec.state = 'error'; rec.err = String(e.message || e); rec.errCode = e.code || ''; rec.retryable = !!e.retry;
    }
    jobs.delete(rec.id); saveNow(); emit(rec.id, rec.state === 'ready' ? 'ready' : 'state'); finishJob();
  }
  function finishJob(){ if (!hasActive()) nativeKeep(false); setTimeout(pump, 50); }

  function pause(id){
    const r = get(id); if (!r) return;
    if (r.storage === 'native'){ od.native.dl.pause(id); if (r.state === 'queued'){ r.state = 'paused'; saveNow(); emit(id, 'state'); } pollSoon(); return; }
    const j = jobs.get(id);
    if (j){ j.stopFlag = true; j.after = 'paused'; if (j.cur) j.cur.stop(); }
    else if (r.state === 'queued'){ r.state = 'paused'; saveNow(); emit(id, 'state'); }
  }
  function resume(id, opts = {}){
    const r = get(id); if (!r || r.state === 'ready' || jobs.has(id)) return;
    if (r.storage === 'native'){ r.state = 'queued'; r.err = ''; r.errCode = ''; saveNow(); emit(id, 'state'); od.native.dl.resume(id, !!opts.force); startPoll(); return; }
    r.state = 'queued'; r.err = ''; r.errCode = ''; if (opts.force) r.force = true; saveNow(); emit(id, 'state'); pump();
  }
  async function removeFiles(rec){
    try{
      const d = await root.navigator.storage.getDirectory(), p = await d.getDirectoryHandle(ROOT_DIR, { create:true });
      await p.removeEntry(slug(rec.id), { recursive:true });
    }catch{}
  }
  /* إلغاء/حذف: يوقف التنزيل الجاري إن وُجد ثم يمسح الملفات والسجل */
  async function remove(id){
    const r = get(id); if (!r) return;
    if (r.storage === 'native'){
      od.native.dl.cancel(id);
      for (let i = 0; i < 80; i++){ const j = (od.native.dl.state().jobs || []).find(x => x.id === id); if (!j) break; await new Promise(x => setTimeout(x, 50)); }
      delete load()[id]; saveNow(); emit(id, 'removed'); return;
    }
    const j = jobs.get(id);
    if (j){ j.stopFlag = true; j.after = 'paused'; if (j.cur) j.cur.stop(); for (let i = 0; i < 80 && jobs.has(id); i++) await new Promise(x => setTimeout(x, 50)); }
    await removeFiles(r);
    delete load()[id]; saveNow(); emit(id, 'removed'); pump();
  }
  /* ---------- التخزين الأصلي: الملفات في تخزين التطبيق الخاص وتنزّلها خدمة أندرويد في الخلفية ---------- */
  const useNative = () => { try{ return !!(od.native && od.native.dlAvailable()); }catch{ return false; } };
  const nName = f => slug(f.path.split('/').pop());                                     /* نحافظ على اسم الملف (أجزاء -00001-of-0000N تُكتشف تلقائيًا) */
  function nativeStart(rec){
    const c = cfg(), headers = c.token ? { authorization:'Bearer ' + c.token } : {};
    const spec = { id:rec.id, name:rec.name, dir:slug(rec.id), wifiOnly:!!c.wifiOnly, force:!!rec.force, headers,
      files:rec.files.map(f => ({ url:od.catalog.fileUrl(c, rec.repo, f.path), name:nName(f), size:f.size || 0 })) };
    delete rec.force;
    let r; try{ r = od.native.dl.enqueue(spec); }catch(e){ r = { ok:false, error:String(e && e.message || e) }; }
    if (!r || r.ok === false){ rec.state = 'error'; rec.err = (r && r.error) || 'تعذّر بدء التنزيل.'; rec.errCode = 'native'; saveNow(); emit(rec.id, 'state'); return; }
    rec.state = r.state === 'ready' ? 'ready' : 'queued'; saveNow(); emit(rec.id, 'state'); startPoll(); pollSoon();
  }
  let pollT = null;
  const nativeActive = () => list().some(r => r.storage === 'native' && (r.state === 'downloading' || r.state === 'queued'));
  function startPoll(){
    if (pollT) return;
    pollT = setInterval(() => { syncNative(); if (!nativeActive()){ clearInterval(pollT); pollT = null; } }, 1000);
    if (pollT && pollT.unref) pollT.unref();
  }
  const pollSoon = () => setTimeout(syncNative, 150);
  /* يطابق سجلات التطبيق مع حالة خدمة التنزيل (التقدّم، الاكتمال، الأخطاء) */
  function syncNative(){
    if (!useNative()) return;
    let snap; try{ snap = od.native.dl.state(); }catch{ return; }
    const jobs = new Map((snap.jobs || []).map(j => [j.id, j]));
    let changed = false;
    for (const r of list()){
      if (r.storage !== 'native' || r.state === 'ready') continue;
      const j = jobs.get(r.id);
      if (!j){ if (r.state === 'downloading' || r.state === 'queued'){ r.state = 'error'; r.err = 'فُقد سجل التنزيل — أعد المحاولة.'; r.errCode = 'missing'; r.retryable = true; changed = true; emit(r.id, 'state'); } continue; }
      const before = r.state;
      r.state = j.state; r.err = j.err || ''; r.errCode = j.code || ''; r.bps = j.bps || 0; r.retryable = !!j.retryable;
      (j.files || []).forEach((jf, i) => { if (r.files[i]){ r.files[i].done = jf.done || 0; if (jf.size && !r.files[i].size) r.files[i].size = jf.size; } });
      r.size = r.files.reduce((n, x) => n + (x.size || 0), 0); r.bytes = sumDone(r);
      if (j.state === 'ready'){ r.readyAt = Date.now(); r.bps = 0; r.root = snap.root; saveNow(); emit(r.id, 'ready'); changed = false; }
      else if (before !== r.state){ saveNow(); emit(r.id, 'state'); }
      else { emit(r.id, 'progress'); saveSoon(); }
    }
    if (changed) saveNow();
  }
  /* مسارات ملفات النموذج الجاهز للمحرك الأصلي */
  function paths(id){
    const r = get(id); if (!r || r.state !== 'ready') throw new Error('النموذج غير جاهز.');
    if (r.storage !== 'native') throw new Error('هذا النموذج مخزَّن لمحرك WASM.');
    const root = r.root || (od.native.dl.state().root || '');
    const names = r.files.map(f => ({ n:nName(f), role:f.role }));
    const model = names.find(x => x.role !== 'mmproj'), mm = names.find(x => x.role === 'mmproj');
    return { model:od.native.join(root, slug(r.id), model.n), mmproj:mm ? od.native.join(root, slug(r.id), mm.n) : '' };
  }

  /* ملفات النموذج الجاهز كـ File (قراءة كسولة من القرص) */
  async function blobs(id){
    const r = get(id); if (!r || r.state !== 'ready') throw new Error('النموذج غير جاهز.');
    const d = await getDir(dirOf(r)), out = [];
    for (let i = 0; i < r.files.length; i++){
      const fh = await d.getFileHandle(fileName(r, r.files[i], i)), f = await fh.getFile();
      if (r.files[i].size && f.size !== r.files[i].size) throw new Error('ملف النموذج تالف أو ناقص — احذفه وأعد التنزيل.');
      out.push(f);
    }
    return out;
  }
  /* عند فتح التطبيق: ما كان يُنزَّل يُستأنف تلقائيًا، وما كان جاهزًا يُتحقق من وجوده */
  async function init(){
    load();
    let touched = false;
    for (const r of list()){
      if (r.state === 'downloading' || r.state === 'queued'){ r.state = 'queued'; touched = true; }
    }
    if (touched) saveNow();
    try{ root.window && root.window.addEventListener('online', () => { list().forEach(r => { if (r.state === 'error' && r.retryable) resume(r.id); }); }); }catch{}
    if (useNative()){
      /* الخدمة تحمل حالتها بنفسها: نوقظها لاستئناف ما كان يُنزَّل ثم نطابق السجل */
      for (const r of list()) if (r.storage === 'native' && (r.state === 'queued' || r.state === 'downloading')) { try{ od.native.dl.resume(r.id, false); }catch{} }
      syncNative(); if (nativeActive()) startPoll();
    }
    setTimeout(pump, 600);
  }
  /* ينقص ما فُقد من القرص (يُستدعى عند فتح صفحة النماذج) */
  async function verify(){
    let changed = false;
    for (const r of list()){
      if (r.state !== 'ready') continue;
      if (r.storage === 'native'){
        const j = useNative() ? (od.native.dl.state().jobs || []).find(x => x.id === r.id) : null;
        if (!j || j.state !== 'ready'){ r.state = 'error'; r.err = 'ملف النموذج مفقود أو تالف — أعد التنزيل.'; r.errCode = 'missing'; r.files.forEach(f => { f.done = 0; }); r.bytes = 0; changed = true; emit(r.id, 'state'); }
        continue;
      }
      try{ await blobs(r.id); }catch{ r.state = 'error'; r.err = 'ملف النموذج مفقود أو تالف — أعد التنزيل.'; r.errCode = 'missing'; r.files.forEach(f => { f.done = 0; }); r.bytes = 0; changed = true; emit(r.id, 'state'); }
    }
    if (changed) saveNow();
    return changed;
  }
  const on = f => { listeners.add(f); return () => listeners.delete(f); };

  od.store = { enqueue, pause, resume, remove, blobs, paths, syncNative, useNative, list, get, init, verify, on, totalBytes, hasActive, odDlCore, WORKER_SRC, canWorker, runFile, slug, dirOf, fileName, _reset:() => { recs = null; jobs.clear(); listeners.clear(); if (pollT){ clearInterval(pollT); pollT = null; } } };
  if (typeof module !== 'undefined' && module.exports) module.exports = od.store;
})(typeof window !== 'undefined' ? window : globalThis);
