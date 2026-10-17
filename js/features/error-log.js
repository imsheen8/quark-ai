/* QUARK AI — سجل الأخطاء (يغذّي الإعدادات ← سجل الأخطاء)
   يلتقط كل ما يحدث من أخطاء في التطبيق: أخطاء الصفحة، الوعود المرفوضة، console.error، فشل الشبكة (fetch)،
   أخطاء الموارد، وما يرسله باقي التطبيق عبر __errlog.add (API / المحرك المحلي / التنزيل / انهيارات أندرويد).
   يُحمَّل أولًا من loader.js (قبل أي ملف) كي لا يفوته خطأ في الإقلاع. يُحفظ محليًا فقط (localStorage) ولا يُرسل لأي جهة.
   المفاتيح والرموز تُخفى تلقائيًا من كل نص يدخل السجل.
   يعمل أيضًا في اختبارات Node (module.exports). */
(function(root){
  'use strict';
  if (root.__errlog && root.__errlog.__v) return;

  const KEY = 'ai_errlog_v1', PKEY = 'ai_errlog_prefs', SKEY = 'ai_errlog_seen';
  const DEF = { max:300, warn:false, net:true, con:true };
  const SRC = {
    js:{ t:'الواجهة', i:'code' }, promise:{ t:'وعد مرفوض', i:'code' }, console:{ t:'console', i:'terminal' }, resource:{ t:'مورد', i:'file' },
    net:{ t:'الشبكة', i:'globe' }, api:{ t:'نموذج / API', i:'cpu' }, native:{ t:'المحرك المحلي', i:'cpu' }, download:{ t:'التنزيل', i:'download' },
    crash:{ t:'انهيار التطبيق', i:'alert' }, exit:{ t:'إغلاق النظام للتطبيق', i:'alert' }, app:{ t:'التطبيق', i:'info' },
  };
  const ls = {
    get:k => { try{ return root.localStorage.getItem(k); }catch{ return null; } },
    set:(k, v) => { try{ root.localStorage.setItem(k, v); return true; }catch{ return false; } },
    del:k => { try{ root.localStorage.removeItem(k); }catch{} },
  };
  const parse = (s, d) => { try{ const v = JSON.parse(s); return v == null ? d : v; }catch{ return d; } };

  /* ---------- إخفاء الأسرار ---------- */
  const RED = [
    [/(sk-[A-Za-z0-9_-]{12})[A-Za-z0-9_-]{8,}/g, '$1…[مخفي]'],
    [/(Bearer\s+)[A-Za-z0-9._~+\/=-]{12,}/gi, '$1[مخفي]'],
    [/((?:api[_-]?key|apikey|key|token|access[_-]?token|secret|password|passwd|authorization|x-api-key|x-goog-api-key|x-quark-token)["']?\s*[:=]\s*["']?)[^\s"'&,;}]{6,}/gi, '$1[مخفي]'],
    [/([?&](?:key|api_key|apikey|token|access_token|code)=)[^&\s#]+/gi, '$1[مخفي]'],
    [/\b(hf_[A-Za-z0-9]{10})[A-Za-z0-9]{8,}/g, '$1…[مخفي]'],
    [/\b(AIza[0-9A-Za-z_-]{6})[0-9A-Za-z_-]{20,}/g, '$1…[مخفي]'],
    [/\b(ghp_[A-Za-z0-9]{6})[A-Za-z0-9]{20,}/g, '$1…[مخفي]'],
    [/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+\/=]{40,}/gi, 'data:…[base64 محذوف]'],
  ];
  const clean = (s, n = 4000) => {
    let t = String(s == null ? '' : s);
    for (const [re, to] of RED) t = t.replace(re, to);
    return t.length > n ? t.slice(0, n) + '…' : t;
  };
  const cleanCtx = (o, depth = 0) => {
    if (o == null) return o;
    if (typeof o === 'string') return clean(o, 600);
    if (typeof o === 'number' || typeof o === 'boolean') return o;
    if (depth > 2) return clean(JSON.stringify(o), 300);
    if (Array.isArray(o)) return o.slice(0, 12).map(x => cleanCtx(x, depth + 1));
    if (typeof o === 'object'){
      const r = {}; let n = 0;
      for (const k of Object.keys(o)){ if (++n > 24) break; r[k] = /key|token|secret|pass|auth/i.test(k) ? '[مخفي]' : cleanCtx(o[k], depth + 1); }
      return r;
    }
    return clean(String(o), 200);
  };
  const urlSafe = u => { try{ const x = new URL(String(u), root.location && root.location.href || 'http://x/'); return x.origin === 'null' ? clean(u, 200) : clean(x.origin + x.pathname, 240); }catch{ return clean(String(u).split('?')[0], 200); } };

  /* ---------- الحالة ---------- */
  let prefs = { ...DEF, ...parse(ls.get(PKEY), {}) };
  let db = parse(ls.get(KEY), null);
  if (!db || !Array.isArray(db.e)) db = { v:1, seq:0, e:[] };
  let seenAt = Number(ls.get(SKEY)) || 0;
  const subs = new Set();
  let timer = 0, bucket = 40, bucketT = Date.now(), dropped = 0, muted = 0;
  const savePrefs = () => ls.set(PKEY, JSON.stringify(prefs));
  const flush = () => {
    clearTimeout(timer); timer = 0;
    let s = JSON.stringify(db);
    while (s.length > 220000 && db.e.length > 20){ db.e.splice(0, Math.ceil(db.e.length / 5)); s = JSON.stringify(db); }
    ls.set(KEY, s);
  };
  const queue = () => { if (!timer) timer = setTimeout(flush, 800); };
  const emit = () => { subs.forEach(f => { try{ f(); }catch{} }); };
  if (root.addEventListener){
    root.addEventListener('pagehide', () => { if (timer) flush(); });
    if (root.document) root.document.addEventListener('visibilitychange', () => { if (root.document.hidden && timer) flush(); });
  }

  const topFrame = st => { const m = /\n\s*at\s+(.+)|@(.+)/.exec(String(st || '')); return m ? (m[1] || m[2] || '').slice(0, 120) : ''; };
  function add(o){
    try{
      if (!o) return null;
      /* حماية من العاصفة: بحد أقصى ~40 حدثًا فورًا ثم 10 في الثانية */
      const now = Date.now(); bucket = Math.min(40, bucket + (now - bucketT) / 100); bucketT = now;
      if (bucket < 1){ dropped++; return null; }
      bucket -= 1;
      const err = o.err, lvl = o.lvl === 'warn' ? 'warn' : 'error', src = SRC[o.src] ? o.src : 'app';
      if (lvl === 'warn' && !prefs.warn && !o.force) return null;
      let msg = o.msg != null ? o.msg : err && (err.message || String(err)) || 'خطأ غير معروف';
      let stack = o.stack != null ? o.stack : err && err.stack || '';
      msg = clean(String(msg).replace(/\s+/g, ' '), 600); stack = clean(stack, 2400);
      const code = o.code != null ? String(o.code) : err && err.code != null ? String(err.code) : '';
      const fp = src + '|' + (o.key || (code + '|' + msg.slice(0, 160) + '|' + topFrame(stack)));
      let e = db.e.find(x => x.fp === fp);
      if (e){ e.n++; e.last = now; if (o.ctx) e.ctx = cleanCtx(o.ctx); if (stack && !e.stack) e.stack = stack; }
      else {
        e = { id:++db.seq, fp, ts:o.ts || now, last:o.ts || now, n:1, lvl, src, msg, stack, code, ctx:o.ctx ? cleanCtx(o.ctx) : undefined, page:clean(root.location ? (root.location.hash || '') : '', 80) };
        db.e.push(e);
        if (db.e.length > prefs.max) db.e.splice(0, db.e.length - prefs.max);
      }
      queue(); emit();
      return e;
    }catch{ return null; }
  }

  /* ---------- الالتقاط التلقائي ---------- */
  let installed = false;
  function install(){
    if (installed || !root.addEventListener) return; installed = true;
    root.addEventListener('error', ev => {
      const t = ev && ev.target;
      if (t && t !== root && (t.src || t.href)){                       /* فشل تحميل مورد (صورة/سكربت/ملف أنماط) */
        add({ src:'resource', msg:'تعذّر تحميل المورد: ' + urlSafe(t.src || t.href), ctx:{ tag:t.tagName }, key:'res|' + urlSafe(t.src || t.href) });
        return;
      }
      if (ev && /ResizeObserver loop/.test(String(ev.message))) return;   /* ضجيج معروف غير ضار */
      add({ src:'js', err:ev && ev.error, msg:ev && (ev.message || (ev.error && ev.error.message)), ctx:{ file:urlSafe(ev && ev.filename || ''), line:ev && ev.lineno, col:ev && ev.colno } });
    }, true);
    root.addEventListener('unhandledrejection', ev => {
      const r = ev && ev.reason;
      if (r && (r.name === 'AbortError' || /aborted/i.test(String(r.message || r)))) return;
      add({ src:'promise', err:r instanceof Error ? r : null, msg:r instanceof Error ? r.message : (typeof r === 'string' ? r : (() => { try{ return JSON.stringify(r); }catch{ return String(r); } })()) });
    });
    const con = root.console;
    if (con){
      const wrap = (name, lvl) => {
        const orig = con[name]; if (typeof orig !== 'function') return;
        con[name] = function(){
          try{
            if (!muted && prefs.con && (lvl === 'error' || prefs.warn)){
              const a = [].slice.call(arguments), first = a[0];
              if (!(typeof first === 'string' && /^\[errlog\]/.test(first))){
                const err = a.find(x => x instanceof Error);
                const text = a.map(x => x instanceof Error ? (x.message || String(x)) : typeof x === 'string' ? x : (() => { try{ return JSON.stringify(x); }catch{ return String(x); } })()).join(' ');
                add({ src:'console', lvl, err, msg:text });
              }
            }
          }catch{}
          return orig.apply(this, arguments);
        };
      };
      wrap('error', 'error'); wrap('warn', 'warn');
    }
    /* الشبكة: نغلّف fetch (دون تغيير سلوكه) */
    const f0 = root.fetch;
    if (typeof f0 === 'function'){
      root.fetch = function(input, init){
        const t0 = Date.now();
        let url = '', method = 'GET';
        try{ url = typeof input === 'string' ? input : input && input.url || String(input); method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase(); }catch{}
        let p; try{ p = f0.apply(this, arguments); }catch(e){ throw e; }
        if (!prefs.net) return p;
        return p.then(res => {
          try{
            if (res && !res.ok && res.status >= 400){
              const u = urlSafe(url);
              add({ src:'net', lvl:res.status === 404 ? 'warn' : 'error', msg:'HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + ' — ' + method + ' ' + u,
                ctx:{ status:res.status, method, url:u, ms:Date.now() - t0 }, key:'http|' + res.status + '|' + method + '|' + u, code:res.status });
            }
          }catch{}
          return res;
        }, e => {
          try{
            if (!(e && (e.name === 'AbortError' || /aborted/i.test(String(e.message))))){
              const u = urlSafe(url);
              add({ src:'net', err:e, msg:(e && e.message || 'فشل الاتصال') + ' — ' + method + ' ' + u, ctx:{ method, url:u, ms:Date.now() - t0, online:root.navigator && root.navigator.onLine }, key:'neterr|' + method + '|' + u });
            }
          }catch{}
          throw e;
        });
      };
    }
  }
  install();

  /* ---------- استيراد انهيارات أندرويد (Java + أسباب إغلاق العملية السابقة) ---------- */
  function importNative(){
    try{
      const n = root.window && root.window.QuarkNative || root.QuarkNative;
      if (!n || typeof n.crashLog !== 'function') return 0;
      const arr = parse(n.crashLog() || '[]', []);
      let c = 0;
      for (const x of arr){
        if (!x) continue;
        const exitK = x.kind === 'EXIT';
        add({ src:exitK ? 'exit' : 'crash', force:true, ts:x.ts, msg:(exitK ? x.reason + (x.desc ? ' — ' + x.desc : '') : (x.text || '').split('\n')[0]) || 'انهيار', stack:exitK ? '' : x.text, ctx:exitK ? { reason:x.reason, importance:x.importance, pssKB:x.pss, rssKB:x.rss, pid:x.pid } : { thread:x.thread }, key:'native|' + x.ts });
        c++;
      }
      return c;
    }catch{ return 0; }
  }

  /* ---------- التقرير ---------- */
  const two = n => String(n).padStart(2, '0');
  const tfmt = ts => { const d = new Date(ts); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()); };
  function deviceSummary(){
    const nav = root.navigator || {}, s = {};
    try{ s.userAgent = nav.userAgent; s.language = nav.language; s.online = nav.onLine; s.cores = nav.hardwareConcurrency; s.deviceMemoryGB = nav.deviceMemory; }catch{}
    try{ s.screen = root.screen ? root.screen.width + 'x' + root.screen.height + ' @' + (root.devicePixelRatio || 1) : ''; }catch{}
    try{ s.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; }catch{}
    try{ const q = root.window && root.window.QuarkNative; if (q && typeof q.deviceInfo === 'function') s.native = parse(q.deviceInfo(), null); }catch{}
    try{ const od = root.__od; if (od && od.native){ const i = od.native.readInfo(); s.engine = { available:i.available, error:i.error, sys:i.sys && String(i.sys).slice(0, 200), gpuLib:i.gpuLib, gpuCrashed:i.gpuCrashed }; } }catch{}
    try{ const od = root.__od; if (od && od.engine && od.engine.state) s.engineState = { state:od.engine.state.state, gpu:od.engine.state.gpu || '', msg:od.engine.state.msg || '' }; }catch{}
    try{ const od = root.__od; if (od && od.device){ const c = od.device.cfgGet(); s.odCfg = { wifiOnly:c.wifiOnly, idleMin:c.idleMin, ramGB:c.ramGB, ctx:c.ctx, threads:c.threads, gpu:c.gpu, think:c.think, base:c.base, hasToken:!!c.token }; } }catch{}
    try{ const od = root.__od; if (od && od.store) s.models = od.store.list().map(r => ({ id:r.id, state:r.state, size:r.size, storage:r.storage, vision:!!r.vision })).slice(0, 12); }catch{}
    try{ if (root.settings){ const sel = root.settings.sel, eps = root.settings.endpoints || []; const ep = sel && eps.find(e => e.id === sel.ep); s.selected = sel ? { model:sel.model, endpoint:ep ? (ep.preset || 'custom') + ' / ' + urlSafe(ep.url) + ' / ' + ep.proto : '' } : null; s.endpoints = eps.length; } }catch{}
    return s;
  }
  function entryText(e, i){
    const L = [];
    L.push('#' + i + ' [' + (e.lvl === 'warn' ? 'تحذير' : 'خطأ') + '] ' + (SRC[e.src] ? SRC[e.src].t : e.src) + (e.n > 1 ? ' ×' + e.n : '') + ' — ' + tfmt(e.last) + (e.n > 1 ? ' (أول مرة ' + tfmt(e.ts) + ')' : ''));
    L.push(e.msg);
    if (e.code) L.push('code: ' + e.code);
    if (e.ctx) L.push('ctx: ' + JSON.stringify(e.ctx));
    if (e.stack) L.push(e.stack);
    return L.join('\n');
  }
  function list(f = {}){
    let a = db.e.slice();
    if (f.src && f.src !== 'all') a = a.filter(e => e.src === f.src);
    if (f.lvl && f.lvl !== 'all') a = a.filter(e => e.lvl === f.lvl);
    if (f.q){ const q = String(f.q).toLowerCase(); a = a.filter(e => (e.msg + ' ' + e.stack + ' ' + e.code + ' ' + JSON.stringify(e.ctx || '')).toLowerCase().includes(q)); }
    if (f.since) a = a.filter(e => e.last >= f.since);
    return a.sort((x, y) => y.last - x.last);
  }
  function report(o = {}){
    const ents = o.entries || list({}).slice(0, o.limit || 60);
    const L = [];
    L.push('=== QUARK AI — تقرير أخطاء ===');
    L.push('وقت التقرير: ' + tfmt(Date.now()));
    L.push('عدد الأخطاء المسجّلة: ' + db.e.length + ' (أخطاء ' + db.e.filter(e => e.lvl === 'error').length + ' / تحذيرات ' + db.e.filter(e => e.lvl === 'warn').length + ')' + (dropped ? ' — أُسقط ' + dropped + ' حدث بسبب الفيضان' : ''));
    L.push('');
    L.push('--- الجهاز والإعدادات ---');
    try{ L.push(JSON.stringify(deviceSummary(), null, 1)); }catch{ L.push('(تعذّر جمع معلومات الجهاز)'); }
    L.push('');
    if (o.usage !== false){
      try{
        const U = root.__usage, bad = U ? U.all().filter(x => x.ok === false && !x.ab).slice(-15) : [];
        if (bad.length){ L.push('--- آخر طلبات النماذج الفاشلة ---'); bad.forEach(x => L.push(tfmt(x.ts) + ' ' + (x.k || x.t) + ' ' + (x.m || '') + ' ' + (x.h || '') + ' → ' + clean(x.e || '', 200))); L.push(''); }
      }catch{}
    }
    L.push('--- الأخطاء (الأحدث أولًا، ' + ents.length + ') ---');
    ents.forEach((e, i) => { L.push(entryText(e, i + 1)); L.push(''); });
    if (!ents.length) L.push('(لا أخطاء)');
    return L.join('\n');
  }

  const api = {
    __v:1, SRC, add, list, report, entryText, deviceSummary, importNative, clean,
    all:() => db.e.slice(),
    count:f => list(f).length,
    unseen:() => db.e.filter(e => e.lvl === 'error' && e.last > seenAt).length,
    markSeen:() => { seenAt = Date.now(); ls.set(SKEY, String(seenAt)); emit(); },
    clear:() => { db.e = []; flush(); dropped = 0; emit(); },
    remove:id => { db.e = db.e.filter(e => e.id !== id); queue(); emit(); },
    prefs:() => ({ ...prefs }),
    setPrefs:p => { prefs = { ...prefs, ...p }; prefs.max = Math.max(50, Math.min(1000, Number(prefs.max) || DEF.max)); savePrefs(); if (db.e.length > prefs.max) db.e.splice(0, db.e.length - prefs.max); emit(); },
    on:fn => { subs.add(fn); return () => subs.delete(fn); },
    silentLogs:fn => { muted++; try{ return fn(); } finally{ muted--; } },
    flush, __reset:() => { db = { v:1, seq:0, e:[] }; ls.del(KEY); },
  };
  root.__errlog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
