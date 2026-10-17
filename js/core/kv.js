/* QUARK AI — طبقة التخزين
   الحقيقة في بايثون (SQLite + ملفات) عبر البوابة: المحادثات والإعدادات والمفاتيح والصور والذاكرة …
   - يُحمَّل كل شيء مرة واحدة عند الفتح إلى الذاكرة، فتبقى القراءات متزامنة (store.get) كما كانت.
   - الكتابة فورية في الذاكرة ثم تُرسل للخادم بعد لحظة (محادثات: تفاضليًا — فقط ما تغيّر).
   - إن لم يتوفر خادم (استضافة ثابتة) نعود تلقائيًا إلى localStorage وIndexedDB كما في السابق.
   - بيانات المتصفح القديمة تُنقل تلقائيًا مرة واحدة عند أول تشغيل مع الخادم.
   يُحمَّل من loader.js قبل أي ملف آخر، ويُنتظر init() قبل تشغيل التطبيق. */
'use strict';

window.QuarkKV = (() => {
  /* مفاتيح خاصة بهذا الجهاز تبقى في المتصفح دائمًا: القفل (يجب أن يعمل قبل التحميل ولا يُشارَك بين الأجهزة)
     وتفضيلات العتاد، وإعداد الاتصال بالخادم نفسه. */
  const LOCAL_RE = /^(ai_lock|ai_account|ai_intro|ai_haptics|ai_shake|ai_notify|ai_notif_asked|ai_vol_act|ai_assist_act|ai_gw_boot|ai_kv_)/;
  const CHATS = 'ai_chats', DEBOUNCE = 350;
  const S = { mode:'pending', base:'', token:'', status:'ok', migrationFailed:false };
  const mem = new Map();                                  /* مفتاح → نص JSON (وضع الخادم) */
  const pendItems = new Map();                            /* مفاتيح لم تُرسل بعد (null = حذف) */
  let chatStr = new Map(), chatOrder = [], chatObjs = null;
  const pendUp = new Map(), pendDel = new Set(); let pendOrder = null;
  let timer = 0, inflight = null, retryT = 0, retryN = 0, lastToast = 0;

  const server = () => S.mode === 'server';
  const isLocalKey = k => LOCAL_RE.test(k);
  const ls = { get:k => { try{ return localStorage.getItem(k); }catch{ return null; } },
    set:(k, v) => { try{ localStorage.setItem(k, v); return true; }catch{ return false; } },
    del:k => { try{ localStorage.removeItem(k); }catch{} },
    keys:() => { try{ return Object.keys(localStorage); }catch{ return []; } } };
  const headers = (extra = {}) => ({ ...(S.token ? { 'x-quark-token':S.token } : {}), ...extra });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isNative = () => !!(window.Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform());

  /* ================= شاشة صغيرة للتقدّم / طلب الرمز ================= */
  function overlay(html){
    let d = document.getElementById('qkvOv');
    if (!d){
      d = document.createElement('div'); d.id = 'qkvOv'; d.dir = 'rtl';
      d.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:#161616;color:#eee;font:16px/1.9 system-ui,Tahoma,sans-serif;text-align:center;z-index:99998';
      (document.body || document.documentElement).appendChild(d);
    }
    d.innerHTML = '<div style="max-width:440px;width:100%">' + html + '</div>';
    return d;
  }
  const overlayOff = () => { const d = document.getElementById('qkvOv'); if (d) d.remove(); };
  function askToken(msg){
    return new Promise(res => {
      const d = overlay('<h3 style="margin:0 0 8px">رمز الخادم مطلوب</h3><p style="opacity:.75;margin:0 0 14px;font-size:14px">' + msg + '</p>' +
        '<input id="qkvTok" type="password" dir="ltr" autocomplete="off" style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #444;background:#222;color:#eee;font-size:16px">' +
        '<div style="display:flex;gap:8px;margin-top:12px"><button id="qkvOk" style="flex:1;padding:12px;border:0;border-radius:10px;background:#5b8def;color:#fff;font-size:15px">متابعة</button>' +
        '<button id="qkvNo" style="flex:1;padding:12px;border:0;border-radius:10px;background:#333;color:#eee;font-size:15px">استخدام تخزين المتصفح</button></div>');
      const inp = d.querySelector('#qkvTok'); inp.focus();
      const done = v => { overlayOff(); res(v); };
      d.querySelector('#qkvOk').onclick = () => done(inp.value.trim() || null);
      d.querySelector('#qkvNo').onclick = () => done(null);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(inp.value.trim() || null); });
    });
  }

  /* ================= اكتشاف الخادم ================= */
  const readBoot = () => { try{ return JSON.parse(ls.get('ai_gw_boot') || '{}') || {}; }catch{ return {}; } };
  function setBoot(o){ const b = { ...readBoot(), ...o }; ls.set('ai_gw_boot', JSON.stringify(b)); }

  async function probe(base, token){
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    try{
      const r = await fetch(base + '/health', { headers:token ? { 'x-quark-token':token } : {}, cache:'no-store', signal:ctl.signal });
      if (r.status === 403) return 'forbidden';
      const j = r.ok ? await r.json().catch(() => null) : null;
      return j && j.ok ? 'ok' : 'down';
    }catch{ return 'down'; }
    finally{ clearTimeout(t); }
  }
  async function detect(){
    /* 1) الأندرويد: البوابة المدمجة (بايثون يحتاج بضع ثوانٍ ليبدأ) */
    if (isNative() && window.QuarkNative && typeof QuarkNative.gwPort === 'function'){
      for (let i = 0; i < 150; i++){
        let p = 0; try{ p = Number(QuarkNative.gwPort()) || 0; }catch{ p = -1; }
        if (p > 0){
          let tok = ''; try{ tok = String(QuarkNative.gwToken() || ''); }catch{}
          const base = 'http://127.0.0.1:' + p + '/api/gw';
          if (await probe(base, tok) === 'ok'){ S.base = base; S.token = tok; return true; }
          return false;
        }
        if (p < 0) return false;
        if (i === 6) overlay('<p style="opacity:.75">جارٍ تشغيل التخزين…</p>');
        await sleep(100);
      }
      return false;
    }
    /* 2) نفس الأصل (serve.py) ثم 3) خادم محدد في الإعدادات */
    const boot = readBoot(), cands = [];
    if (/^https?:$/.test(location.protocol) && !isNative()) cands.push({ base:'/api/gw', token:boot.token || '' });
    const u = String(boot.url || '').trim().replace(/\/+$/, '');
    if (u) cands.push({ base:/\/api\/gw$/.test(u) ? u : u + '/api/gw', token:boot.token || '' });
    for (const c of cands){
      let r = await probe(c.base, c.token);
      if (r === 'forbidden'){
        const tok = await askToken('هذا الخادم يحمي بياناتك برمز. أدخل قيمة <code>QUARK_GW_TOKEN</code> لحفظ المحادثات والإعدادات عليه.');
        if (tok){ r = await probe(c.base, tok); if (r === 'ok'){ c.token = tok; setBoot({ token:tok }); } }
      }
      if (r === 'ok'){ S.base = c.base; S.token = c.token; return true; }
    }
    return false;
  }

  /* ================= نداءات الخادم ================= */
  async function api(route, { method = 'GET', body, raw, ctype, keepalive } = {}){
    const r = await fetch(S.base + '/' + route, {
      method, keepalive:!!keepalive && !!body && body.length < 60000, cache:'no-store',
      headers:headers(body !== undefined ? { 'content-type':'application/json' } : (ctype ? { 'content-type':ctype } : {})),
      body:body !== undefined ? body : raw,
    });
    if (!r.ok){ let m = ''; try{ m = (await r.json()).error || ''; }catch{} const e = new Error(m || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return r;
  }
  const apiJson = async (route, opts) => (await api(route, opts)).json();
  const call = (route, body) => apiJson(route, { method:'POST', body:JSON.stringify(body || {}) });      /* نداء JSON عام للبوابة (المهام…) */

  /* ================= الكتابة المؤجّلة ================= */
  const sameArr = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);
  const hasPending = () => pendItems.size || pendUp.size || pendDel.size || pendOrder;
  function schedule(ms = DEBOUNCE){ if (!timer && server()) timer = setTimeout(() => { timer = 0; flush(); }, ms); }
  function report(ok, err){
    const was = S.status; S.status = ok ? 'ok' : 'error';
    if (was !== S.status) try{ window.dispatchEvent(new CustomEvent('quark-kv-status', { detail:{ ok } })); }catch{}
    if (!ok && Date.now() - lastToast > 30000){
      lastToast = Date.now();
      try{ if (typeof toast === 'function') toast('تعذّر الحفظ على الخادم — سنعيد المحاولة تلقائيًا'); }catch{}
    }
    if (!ok) console.warn('QuarkKV: save failed', err);
  }
  async function flush(keepalive){
    if (!server()) return true;
    clearTimeout(timer); timer = 0;
    if (inflight){ await inflight.catch(() => {}); if (!hasPending()) return true; }
    if (!hasPending()) return true;
    const run = (async () => {
      /* لقطة مما سيُرسل؛ لا نحذفه من الانتظار إلا إن بقي كما هو بعد نجاح الإرسال */
      const items = {}; pendItems.forEach((v, k) => { items[k] = v; });
      const ups = [...pendUp], dels = [...pendDel], order = pendOrder ? [...pendOrder] : null;
      if (Object.keys(items).length){
        await api('store/set', { method:'POST', body:JSON.stringify({ items }), keepalive });
        Object.keys(items).forEach(k => { if (pendItems.get(k) === items[k]) pendItems.delete(k); });
      }
      if (ups.length || dels.length || order){
        /* المحادثات مُرمَّزة مسبقًا: نلصقها كما هي دون ترميز مزدوج */
        const body = '{"upsert":[' + ups.map(([, s]) => s).join(',') + '],"delete":' + JSON.stringify(dels) + ',"order":' + JSON.stringify(order || chatOrder) + '}';
        await api('store/chats', { method:'POST', body, keepalive });
        ups.forEach(([id, s]) => { if (pendUp.get(id) === s) pendUp.delete(id); });
        dels.forEach(id => pendDel.delete(id));
        if (order && sameArr(pendOrder, order)) pendOrder = null;
      }
    })();
    inflight = run;
    try{ await run; retryN = 0; clearTimeout(retryT); retryT = 0; report(true); return true; }
    catch(e){
      report(false, e);
      retryN = Math.min(retryN + 1, 6);
      clearTimeout(retryT); retryT = setTimeout(() => { retryT = 0; flush(); }, Math.min(30000, 1500 * 2 ** retryN));
      return false;
    }
    finally{ inflight = null; if (hasPending() && !retryT && !timer) schedule(); }
  }

  /* ================= واجهة القراءة والكتابة (نصوص JSON) ================= */
  function get(k){
    if (server() && !isLocalKey(k)){
      if (k === CHATS) return JSON.stringify(chatsArray());
      return mem.has(k) ? mem.get(k) : null;
    }
    return ls.get(k);
  }
  function set(k, v){
    if (server() && !isLocalKey(k)){ mem.set(k, v); pendItems.set(k, v); schedule(); return true; }
    return ls.set(k, v);
  }
  function remove(k){
    if (server() && !isLocalKey(k)){ mem.delete(k); pendItems.set(k, null); schedule(); return; }
    ls.del(k);
  }
  const keys = () => server() ? [...mem.keys(), ...ls.keys().filter(isLocalKey)] : ls.keys();
  const size = k => { const v = get(k); return v ? new Blob([v]).size : 0; };

  /* ---- المحادثات ---- */
  function chatsArray(){
    if (chatObjs){ const a = chatObjs; return a; }
    return chatOrder.map(id => { try{ return JSON.parse(chatStr.get(id)); }catch{ return null; } }).filter(Boolean);
  }
  function setChats(arr){
    if (!server()){ return ls.set(CHATS, JSON.stringify(arr)); }
    chatObjs = null;
    const ids = [], seen = new Set();
    for (const c of arr){
      if (!c || typeof c.id !== 'string' || seen.has(c.id)) continue;
      seen.add(c.id); ids.push(c.id);
      const s = JSON.stringify(c);
      if (chatStr.get(c.id) !== s){ chatStr.set(c.id, s); pendUp.set(c.id, s); pendDel.delete(c.id); }
    }
    for (const id of [...chatStr.keys()]) if (!seen.has(id)){ chatStr.delete(id); pendUp.delete(id); pendDel.add(id); }
    if (!sameArr(ids, chatOrder)){ chatOrder = ids; pendOrder = ids; }
    if (hasPending()) schedule();
    return true;
  }
  function loadChats(list){
    chatStr = new Map(); chatOrder = [];
    list.forEach(c => { if (c && typeof c.id === 'string' && !chatStr.has(c.id)){ chatStr.set(c.id, JSON.stringify(c)); chatOrder.push(c.id); } });
    chatObjs = list.filter(c => c && chatStr.has(c.id));
  }

  /* ================= الملفات (الصور والمرفقات) ================= */
  const dataUrlToBlob = u => {
    const i = u.indexOf(','), meta = u.slice(5, i), mime = meta.split(';')[0] || 'application/octet-stream';
    if (/;base64$/i.test(meta)){ const bin = atob(u.slice(i + 1)), a = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) a[j] = bin.charCodeAt(j); return new Blob([a], { type:mime }); }
    return new Blob([decodeURIComponent(u.slice(i + 1))], { type:mime });
  };
  const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  const filePend = new Map();                             /* ملفات لم يكتمل رفعها (تُعاد محاولتها) */
  async function uploadFile(id, data){
    const b = typeof data === 'string' ? dataUrlToBlob(data) : data;
    await api('files/' + encodeURIComponent(id), { method:'POST', raw:b, ctype:b.type || 'application/octet-stream' });
  }
  let fileRetryT = 0;
  function retryFiles(){
    if (fileRetryT || !filePend.size) return;
    fileRetryT = setTimeout(async () => {
      fileRetryT = 0;
      for (const [id, d] of [...filePend]){ try{ await uploadFile(id, d); filePend.delete(id); }catch{ break; } }
      if (filePend.size) retryFiles();
    }, 4000);
  }
  const files = {
    async put(id, data){
      try{ await uploadFile(id, data); filePend.delete(id); }
      catch(e){ filePend.set(id, data); retryFiles(); report(false, e); }
    },
    async get(id){
      if (filePend.has(id)) return filePend.get(id);
      const r = await fetch(S.base + '/files/' + encodeURIComponent(id), { headers:headers(), cache:'force-cache' });
      if (r.status === 404) return undefined;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return blobToDataUrl(await r.blob());
    },
    async del(id){ filePend.delete(id); await api('files/' + encodeURIComponent(id) + '/delete', { method:'POST', body:'{}' }); },
    async keys(){ return (await apiJson('files')).files.map(f => f.id).concat([...filePend.keys()]); },
  };

  /* ================= نقل بيانات المتصفح القديمة (مرة واحدة) ================= */
  function legacyKeys(){ return ls.keys().filter(k => k.startsWith('ai_') && !isLocalKey(k)); }
  async function restoreNativeState(){
    const Cap = window.Capacitor;
    if (!(isNative() && Cap.Plugins && Cap.Plugins.Filesystem)) return;
    if (ls.get('ai_onboarded') || ls.get('ai_chats')) return;      /* فقط إن كان تخزين المتصفح فارغًا (مُسح) */
    try{
      const r = await Cap.Plugins.Filesystem.readFile({ path:'quark/state.json', directory:'DATA', encoding:'utf8' });
      const o = JSON.parse((r && r.data) || '{}');
      Object.keys(o).forEach(k => ls.set(k, o[k]));
    }catch{}
  }
  function legacyImages(){
    return new Promise(res => {
      try{
        const q = indexedDB.open('quark-ai-img', 1);
        q.onupgradeneeded = () => { try{ q.transaction.abort(); }catch{} res([]); };      /* لا قاعدة قديمة */
        q.onerror = () => res([]);
        q.onsuccess = () => {
          const db = q.result;
          if (!db.objectStoreNames.contains('imgs')){ db.close(); return res([]); }
          const out = [], cur = db.transaction('imgs', 'readonly').objectStore('imgs').openCursor();
          cur.onsuccess = () => { const c = cur.result; if (c){ if (typeof c.value === 'string') out.push({ id:String(c.key), data:c.value }); c.continue(); } else { db.close(); res(out); } };
          cur.onerror = () => { db.close(); res(out); };
        };
      }catch{ res([]); }
    });
  }
  async function legacyNativeImages(have){
    const Cap = window.Capacitor, out = [];
    if (!(isNative() && Cap.Plugins && Cap.Plugins.Filesystem)) return out;
    try{
      const FS = Cap.Plugins.Filesystem, d = await FS.readdir({ path:'quark/img', directory:'DATA' });
      for (const f of (d.files || [])){
        const name = typeof f === 'string' ? f : f.name, id = String(name).replace(/\.txt$/, '');
        if (have.has(id)) continue;
        try{ const r = await FS.readFile({ path:'quark/img/' + name, directory:'DATA', encoding:'utf8' }); if (r && typeof r.data === 'string' && r.data.startsWith('data:')) out.push({ id, data:r.data }); }catch{}
      }
    }catch{}
    return out;
  }
  async function migrate(){
    await restoreNativeState();
    const items = {}; let chats = [];
    legacyKeys().forEach(k => {
      const v = ls.get(k); if (v == null) return;
      if (k === CHATS){ try{ const a = JSON.parse(v); if (Array.isArray(a)) chats = a.filter(c => c && typeof c.id === 'string'); }catch{} }
      else items[k] = v;
    });
    let imgs = await legacyImages();
    imgs = imgs.concat(await legacyNativeImages(new Set(imgs.map(i => i.id))));
    if (Object.keys(items).length || chats.length || imgs.length){
      const total = imgs.length + 2; let n = 0;
      const prog = () => overlay('<h3 style="margin:0 0 8px">جارٍ نقل بياناتك إلى التخزين الجديد</h3><p style="opacity:.75;font-size:14px;margin:0">تُحفظ الآن في بايثون بدل المتصفح — لا تُغلق التطبيق (' + Math.min(100, Math.round(n / total * 100)) + '%)</p>');
      prog();
      if (Object.keys(items).length) await apiJson('store/set', { method:'POST', body:JSON.stringify({ items }) });
      n++; prog();
      if (chats.length){
        for (let i = 0; i < chats.length; i += 20){                       /* دفعات صغيرة كي لا يتجاوز الطلب الحد */
          const part = chats.slice(i, i + 20);
          await apiJson('store/chats', { method:'POST', body:JSON.stringify({ upsert:part, order:i + part.length === chats.length ? chats.map(c => c.id) : undefined }) });
        }
      }
      n++; prog();
      let next = 0;
      await Promise.all(Array.from({ length:3 }, async () => {
        while (next < imgs.length){ const im = imgs[next++]; await uploadFile(im.id, im.data); n++; prog(); }
      }));
    }
    await apiJson('store/migrated', { method:'POST', body:'{}' });
    ls.set('ai_kv_migrated', '1');
  }

  /* ================= التشغيل ================= */
  async function init(){
    if (S.mode !== 'pending') return S.mode;
    let ok = false;
    try{ ok = await detect(); }catch{ ok = false; }
    if (ok){
      try{
        let snap = await apiJson('store/snapshot');
        if (!snap.migrated){ await migrate(); snap = await apiJson('store/snapshot'); }
        Object.entries(snap.items || {}).forEach(([k, v]) => { if (typeof v === 'string') mem.set(k, v); });
        loadChats(Array.isArray(snap.chats) ? snap.chats : []);
        S.mode = 'server';
      }catch(e){
        console.warn('QuarkKV: server mode failed, using browser storage', e);
        S.migrationFailed = true; S.mode = 'local';
      }
    } else S.mode = 'local';
    if (S.mode === 'local') await restoreNativeState();      /* أندرويد بلا خادم: نستعيد نسخة الملفات القديمة كما كان */
    overlayOff();
    const bye = () => { if (server() && hasPending()) flush(true); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') bye(); });
    window.addEventListener('pagehide', bye);
    return S.mode;
  }

  /* ================= إحصاءات وصيانة ================= */
  const stats = () => apiJson('store/stats');
  const legacyCount = () => legacyKeys().length;
  async function clearLegacy(){
    legacyKeys().forEach(k => ls.del(k));
    try{ indexedDB.deleteDatabase('quark-ai-img'); }catch{}
    try{ const Cap = window.Capacitor; if (isNative() && Cap.Plugins?.Filesystem) await Cap.Plugins.Filesystem.rmdir({ path:'quark', directory:'DATA', recursive:true }); }catch{}
  }
  async function wipe(){
    if (server()){ try{ await api('store/wipe', { method:'POST', body:'{}' }); }catch{} }
    ls.keys().filter(k => k.startsWith('ai_')).forEach(k => ls.del(k));
    try{ indexedDB.deleteDatabase('quark-ai-img'); }catch{}
  }

  return {
    init, get, set, remove, keys, size, setChats, chatsArray, flush, stats, wipe, files, setBoot, call,
    legacyCount, clearLegacy, isLocalKey,
    get mode(){ return S.mode; }, get server(){ return server(); }, get status(){ return S.status; },
    get base(){ return S.base; }, get migrationFailed(){ return S.migrationFailed; },
  };
})();
