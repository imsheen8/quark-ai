/* QUARK AI — المزامنة السحابية (لمن سجّل الدخول بحساب Google فقط).
   • تحفظ كل شيء عدا المفاتيح على وسيط QUARK ضمن مساحة الحساب (5MB مجانًا).
   • تشفير اختياري بكلمة سر (AES-256-GCM + PBKDF2) على الجهاز نفسه: الخادم لا يرى إلا بيانات مشفّرة، وعندها يمكن مزامنة المفاتيح بأمان.
   • مزامنة ذكية: حذف المحادثة يصل إلى بقية الأجهزة (شواهد حذف)، وكل عنصر يُدمج بحسب آخر تعديل، والصور تُصغَّر قبل الرفع. */
'use strict';

const QuarkCloud = (() => {
  const META = 'ai_kv_cloud', CKEY = 'ai_kv_ckey';          /* محليان فقط (ai_kv_) ولا يدخلان النسخة */
  const SKIP = /^(ai_lock|ai_account|ai_device_id|ai_auth|ai_sub|ai_onboarded|ai_intro|ai_gw_boot|ai_kv_|ai_od_|ai_errlog|ai_current)/;
  const SECRET = /^(key|api_?key|apikey|token|secret|password|pass|authorization|idtoken|access_?token|refresh_?token)$/i;
  const ITER = 600000, AAD = new TextEncoder().encode('quark-sync-v2');
  let INFO = null, SIZES = null, STATUS = 'idle', pushing = false, pulling = false, lastErr = '', locked = false, needsPull = false;
  const subs = new Set();
  const emit = () => subs.forEach(f => { try{ f(); }catch{} });
  const setStatus = (s, e) => { STATUS = s; lastErr = e || ''; emit(); };

  const meta = () => store.get(META, {}) || {};
  const setMeta = o => store.set(META, { ...meta(), ...o });
  const sess = () => { try{ return QuarkAuth.session(); }catch{ return null; } };
  const active = () => !!(window.QuarkAuth && MANAGED_URL && sess());
  const owner = () => (sess() && sess().email) || '';
  const base = () => String(MANAGED_URL || '').replace(/\/+$/, '');
  const bytes = s => new Blob([s]).size;
  const busyNow = () => { try{ return typeof busy !== 'undefined' && busy; }catch{ return false; } };

  async function api(method, path, body, ms = 20000){
    const a = sess(); if (!a) return null;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try{
      const r = await fetch(base() + path, { method, signal:ctl.signal, cache:'no-store', body,
        headers:{ authorization:'Bearer ' + ((MANAGED_SECRET ? MANAGED_SECRET + ':' : '') + a.token), ...(body ? { 'content-type':'application/json' } : {}) } });
      const j = await r.json().catch(() => ({}));
      return { s:r.status, j };
    }catch{ return null; }
    finally{ clearTimeout(t); }
  }

  /* ================= التشفير (WebCrypto) ================= */
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const pipe = async (u8, st) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(st)).arrayBuffer());
  const gzip = u8 => typeof CompressionStream === 'function' ? pipe(u8, new CompressionStream('gzip')) : null;
  const gunzip = u8 => pipe(u8, new DecompressionStream('gzip'));
  const ckey = () => store.get(CKEY, null);                  /* { salt, iter, raw, keys } — المفتاح المشتق (لا كلمة السر) */
  async function deriveKey(pass, salt, iter){
    const m = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name:'PBKDF2', hash:'SHA-256', salt, iterations:iter }, m, { name:'AES-GCM', length:256 }, true, ['encrypt', 'decrypt']);
  }
  const keyFromRaw = raw => crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function seal(inner, key, ck){
    const raw = new TextEncoder().encode(JSON.stringify(inner));
    let data = raw, z = 0; const g = await gzip(raw); if (g && g.length < raw.length){ data = g; z = 1; }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:AAD }, key, data));
    return { v:2, enc:'aes-gcm', kdf:'pbkdf2-sha256', iter:ck.iter, salt:ck.salt, iv:b64(iv), ct:b64(ct), z };
  }
  async function open(env, key){
    if (!(env.iter >= 100000 && env.iter <= 5000000)) throw new Error('iter');
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name:'AES-GCM', iv:unb64(env.iv), additionalData:AAD }, key, unb64(env.ct)));
    return JSON.parse(new TextDecoder().decode(env.z ? await gunzip(pt) : pt));
  }
  async function pack(inner){
    const ck = ckey(); if (!ck) return JSON.stringify(inner);
    return JSON.stringify(await seal(inner, await keyFromRaw(ck.raw), ck));
  }

  /* ================= واجهة كلمة السر ================= */
  function askPass(o = {}){
    return new Promise(res => {
      const set = o.mode === 'set', E = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
      const ov = document.createElement('div'); ov.dir = 'rtl';
      ov.style.cssText = 'position:fixed;inset:0;z-index:100002;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.6)';
      const inp = 'width:100%;box-sizing:border-box;margin-top:10px;padding:12px;border-radius:12px;border:1px solid var(--border,#444);background:var(--surface-2,#222);color:var(--text,#eee);font:inherit;font-size:16px';
      ov.innerHTML = `<div role="dialog" aria-modal="true" style="width:100%;max-width:380px;background:var(--surface,#1e1e1e);color:var(--text,#eee);border:1px solid var(--border,#333);border-radius:20px;padding:20px;font:15px/1.8 system-ui,Tahoma,sans-serif">`
        + `<h3 style="margin:0 0 6px;font-size:18px">${E(o.title || (set ? 'تشفير النسخة بكلمة سر' : 'النسخة السحابية مشفّرة'))}</h3>`
        + `<p style="margin:0;color:var(--text-2,#aaa);font-size:13.5px">${E(o.text || (set ? 'تُشفَّر بياناتك على جهازك قبل رفعها، فلا يقرؤها الخادم. كلمة السر لا تُحفظ عندنا ولا يمكن استرجاعها: إن نسيتَها فلن تُفكّ النسخة السحابية.' : 'أدخل كلمة السر لفكّ النسخة واستعادة بياناتك.'))}</p>`
        + `<input id="qcP1" type="password" dir="ltr" autocomplete="off" placeholder="كلمة السر" style="${inp}">`
        + (set ? `<input id="qcP2" type="password" dir="ltr" autocomplete="off" placeholder="أعد كتابة كلمة السر" style="${inp}">` : '')
        + (set && o.withKeys !== false ? `<label style="display:flex;gap:10px;align-items:flex-start;margin-top:12px;font-size:13.5px"><input id="qcK" type="checkbox" ${o.keys ? 'checked' : ''} style="margin-top:5px"><span>مزامنة المفاتيح أيضًا (مفاتيح API وغيرها) — تُرفع مشفّرة فقط</span></label>` : '')
        + `<p id="qcE" style="margin:10px 0 0;color:#d9534f;font-size:13px" ${o.error ? '' : 'hidden'}>${E(o.error || '')}</p>`
        + `<div style="display:flex;gap:8px;margin-top:16px"><button id="qcNo" type="button" style="flex:1;padding:12px;border:0;border-radius:12px;background:var(--surface-3,#333);color:var(--text,#eee);font:inherit">${E(o.skip || (set ? 'إلغاء' : 'تخطي'))}</button>`
        + `<button id="qcOk" type="button" style="flex:1;padding:12px;border:0;border-radius:12px;background:var(--accent,#5b8def);color:#fff;font:inherit">${E(o.ok || (set ? 'تشفير' : 'فك التشفير'))}</button></div></div>`;
      const q = s => ov.querySelector(s), err = m => { q('#qcE').textContent = m; q('#qcE').hidden = false; };
      const done = v => { ov.remove(); res(v); };
      const submit = () => {
        const p = q('#qcP1').value;
        if (set){
          if (p.length < 8) return err('كلمة السر قصيرة: 8 أحرف على الأقل.');
          if (p !== q('#qcP2').value) return err('كلمتا السر غير متطابقتين.');
        }else if (!p) return err('اكتب كلمة السر.');
        done({ pass:p, keys:!!(q('#qcK') && q('#qcK').checked) });
      };
      q('#qcOk').onclick = submit; q('#qcNo').onclick = () => done(null);
      ov.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
      document.body.appendChild(ov); setTimeout(() => { try{ q('#qcP1').focus(); }catch{} }, 50);
    });
  }

  /* ================= اللقطة ================= */
  function strip(v, d = 0){
    if (d > 14 || v == null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(x => strip(x, d + 1));
    const o = {}; for (const k of Object.keys(v)) o[k] = SECRET.test(k) && typeof v[k] === 'string' ? '' : strip(v[k], d + 1);
    return o;
  }
  /* يملأ الحقول السرّية الفارغة في rem مما عند loc */
  function fill(rem, loc, d = 0){
    if (d > 14 || rem == null || typeof rem !== 'object' || loc == null || typeof loc !== 'object') return rem;
    if (Array.isArray(rem)){
      rem.forEach((x, i) => { const l = Array.isArray(loc) ? ((x && x.id != null && loc.find(y => y && y.id === x.id)) || loc[i]) : null; if (l) rem[i] = fill(x, l, d + 1); });
      return rem;
    }
    for (const k of Object.keys(rem)){
      if (SECRET.test(k) && rem[k] === '' && typeof loc[k] === 'string' && loc[k]) rem[k] = loc[k];
      else rem[k] = fill(rem[k], loc[k], d + 1);
    }
    return rem;
  }
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h) + ':' + s.length; };
  const userKeys = () => { const s = new Set(QuarkKV.keys().filter(k => /^ai_/.test(k) && !SKIP.test(k))); s.add('ai_chats'); return [...s]; };

  function imgIds(list){
    const ids = [];
    [...list].sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach(c => eachMsg(c, m => { (m.imgs || []).forEach(i => i && i.id && ids.push(i.id)); (m.gen || []).forEach(i => i && i.id && ids.push(i.id)); }));
    return [...new Set(ids)];
  }
  /* لقطة بلا صور: العناصر + الأحجام + البصمات. المفاتيح تُحذف إلا لو فُعّل التشفير مع «مزامنة المفاتيح». */
  function items(){
    const ck = ckey(), keepSecrets = !!(ck && ck.keys);
    const out = {}, hs = {}, sz = { chats:0, imgs:0, other:0 };
    for (const k of userKeys()){
      let v;
      if (k === 'ai_chats') v = store.get('ai_chats', []).filter(c => !c.temp);
      else { const raw = QuarkKV.get(k); if (raw == null) continue; try{ v = JSON.parse(raw); }catch{ continue; } }
      if (!keepSecrets) v = strip(v);
      if (k === 'ai_settings_v3' && v && Array.isArray(v.endpoints)) v.endpoints = v.endpoints.filter(e => !e.managed);
      out[k] = v; const s = JSON.stringify(v), n = bytes(s); hs[k] = hash(s);
      if (k === 'ai_chats') sz.chats += n; else sz.other += n;
    }
    const ids = imgIds(out.ai_chats || []);
    return { items:out, hashes:hs, sz, ids, sig:hash(JSON.stringify(hs) + '|' + ids.join(',') + '|' + (keepSecrets ? 'k' : '') + (ck ? 'e' : '')) };
  }

  /* وقت آخر تعديل لكل عنصر (للدمج بحسب الأحدث) */
  function track(h){
    const m = meta(), kh = { ...(m.kh || {}) }, kt = { ...(m.kt || {}) }, now = Date.now(); let ch = false;
    for (const k of Object.keys(h)) if (kh[k] !== h[k]){ kh[k] = h[k]; kt[k] = now; ch = true; }
    for (const k of Object.keys(kh)) if (!(k in h)){ delete kh[k]; delete kt[k]; ch = true; }
    if (ch) setMeta({ kh, kt });
  }
  /* شواهد الحذف: محادثة كانت مرفوعة ثم اختفت محليًا = حُذفت */
  function updateTombs(){
    const m = meta(), cur = new Set(store.get('ai_chats', []).filter(c => !c.temp).map(c => c.id)), tomb = { ...(m.tomb || {}) }, now = Date.now();
    (m.known || []).forEach(id => { if (!cur.has(id) && !tomb[id]) tomb[id] = now; });
    cur.forEach(id => { delete tomb[id]; });
    const kept = Object.fromEntries(Object.entries(tomb).filter(([, t]) => now - t < 90 * 864e5).sort((a, b) => b[1] - a[1]).slice(0, 400));
    setMeta({ tomb:kept }); return { tomb:kept, cur:[...cur] };
  }

  /* تصغير الصور قبل الرفع (النسخة المحلية الأصلية لا تُمسّ) */
  const shrunk = new Map();
  function loadImg(src){ return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  async function shrink(id, d, side, q){
    const key = id + '|' + side + '|' + d.length; if (shrunk.has(key)) return shrunk.get(key);
    let out = d;
    try{
      if (typeof Image !== 'undefined' && /^data:image\/(png|jpe?g|webp)/i.test(d) && d.length > 40000){
        const img = await loadImg(d), sc = Math.min(1, side / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        const o = c.toDataURL('image/jpeg', q); if (o && o.length < d.length) out = o;
      }
    }catch{}
    if (shrunk.size > 30) shrunk.clear();
    shrunk.set(key, out); return out;
  }

  async function refreshInfo(){ const r = await api('GET', '/sync', null, 8000); if (r && r.s === 200) INFO = r.j; return INFO; }
  const remoteNewer = () => !!(INFO && INFO.used > 0 && INFO.updated > (meta().at || 0) + 1500);

  async function push(force){
    if (!active() || pushing) return false;
    if (locked){ setStatus('locked'); return false; }
    pushing = true; setStatus('syncing');
    try{
      if (!INFO) await refreshInfo();
      const quota = (INFO && INFO.quota) || 5 * 1048576;
      const t = updateTombs(), b = items(); track(b.hashes);
      if (!force && b.sig === meta().sig){ setStatus('ok'); return true; }
      await refreshInfo();
      if (remoteNewer()){ needsPull = true; setStatus('pending'); return false; }   /* جهاز آخر رفع قبلنا: ندمج أولًا ثم نرفع */
      const ck = ckey(); let overhead = 4096 + 600;
      let itemsCost = b.sz.chats + b.sz.other;
      if (ck){ const g = await gzip(new TextEncoder().encode(JSON.stringify(b.items))); if (g) itemsCost = Math.ceil(g.length * 1.34); }
      if (itemsCost + overhead > quota){ SIZES = b.sz; setStatus('full'); return false; }
      let used = itemsCost + overhead, skipped = 0; const list = [];
      for (const id of b.ids){
        const d = await imgData(id); if (!d) continue;
        let s = await shrink(id, d, 1024, .72);
        if (used + s.length > quota) s = await shrink(id, d, 640, .55);
        if (used + s.length > quota){ skipped++; continue; }
        list.push([id, s]); used += s.length;
      }
      const kt = {}; Object.keys(b.items).forEach(k => { if ((meta().kt || {})[k]) kt[k] = meta().kt[k]; });
      let body = null, cur = list;
      for (let i = 0; i < 6; i++){
        const inner = { v:1, at:Date.now(), items:b.items, imgs:Object.fromEntries(cur), tomb:t.tomb, kt, ...(ck ? { keys:!!ck.keys } : {}) };
        body = await pack(inner);
        if (bytes(body) <= quota) break;
        body = null; if (!cur.length) break;
        skipped += cur.length - Math.floor(cur.length / 2); cur = cur.slice(0, Math.floor(cur.length / 2));
      }
      if (!body){ SIZES = b.sz; setStatus('full'); return false; }
      b.sz.imgs = cur.reduce((n, [, s]) => n + s.length, 0);
      const r = await api('PUT', '/sync', body, 40000);
      if (!r){ setStatus('error', 'تعذّر الاتصال'); return false; }
      if (r.s === 200){ INFO = r.j; SIZES = b.sz; needsPull = false; setMeta({ owner:owner(), sig:b.sig, at:r.j.updated, skipped, known:t.cur }); setStatus('ok'); return true; }
      if (r.s === 413){ setStatus('full'); return false; }
      if (r.s === 401){ setStatus('auth', 'انتهت الجلسة'); return false; }
      setStatus('error', (r.j && r.j.error && r.j.error.message) || 'تعذّرت المزامنة'); return false;
    }finally{ pushing = false; }
  }

  /* ================= استقبال نسخة من السحابة ================= */
  /* يفكّ تشفير النسخة القادمة إن لزم. interactive: يسأل عن كلمة السر. يعيد المحتوى أو null (والمزامنة تتوقف حتى الفك). */
  async function decodeRemote(env, interactive){
    if (!env || typeof env !== 'object') return null;
    if (!env.enc) return env.items ? env : null;
    const ck = ckey();
    if (ck && ck.salt === env.salt){
      try{ const inner = await open(env, await keyFromRaw(ck.raw)); if (inner && inner.keys !== undefined && !!inner.keys !== !!ck.keys) store.set(CKEY, { ...ck, keys:!!inner.keys }); locked = false; return inner; }catch{}
    }
    if (!interactive){ locked = true; setStatus('locked'); return null; }
    let error = ck ? 'كلمة السر تغيّرت على جهاز آخر. أدخل الجديدة.' : '';
    for (;;){
      const a = await askPass({ mode:'unlock', error });
      if (!a){ locked = true; setStatus('locked'); return null; }
      try{
        const key = await deriveKey(a.pass, unb64(env.salt), env.iter), inner = await open(env, key);
        store.set(CKEY, { salt:env.salt, iter:env.iter, raw:b64(new Uint8Array(await crypto.subtle.exportKey('raw', key))), keys:!!inner.keys });
        locked = false; return inner;
      }catch{ error = 'كلمة السر غير صحيحة.'; }
    }
  }

  /* دمج نسخة السحابة مع الجهاز: المحادثات اتحاد ناقص المحذوف (الأحدث يفوز)، وباقي العناصر الأحدث تعديلًا يفوز */
  async function apply(remote){
    updateTombs(); track(items().hashes);
    const m = meta(), lkt = m.kt || {}, rkt = remote.kt || {}, it = remote.items || {};
    const tomb = { ...(remote.tomb || {}), ...(m.tomb || {}) };
    for (const k of Object.keys(it)){
      if (!/^ai_/.test(k) || SKIP.test(k)) continue;
      const v = it[k];
      if (k === 'ai_chats'){
        const loc = store.get('ai_chats', []), map = new Map(loc.filter(c => !c.temp).map(c => [c.id, c]));
        (Array.isArray(v) ? v : []).forEach(c => {
          if (!c || tomb[c.id]) return;
          const l = map.get(c.id);
          if (!l || (c.ts || 0) > (l.ts || 0) || ((c.ts || 0) === (l.ts || 0) && (c.messages || []).length > (l.messages || []).length)) map.set(c.id, c);
        });
        tomb && [...map.keys()].forEach(id => { if (tomb[id]) map.delete(id); });
        store.set(k, [...[...map.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)), ...loc.filter(c => c.temp)]); continue;
      }
      const rawLoc = QuarkKV.get(k); let loc = null; try{ loc = rawLoc == null ? null : JSON.parse(rawLoc); }catch{}
      const newer = loc == null || (rkt[k] || 0) > (lkt[k] || 0);
      if (k === 'ai_settings_v3' && v && loc){
        const base2 = newer ? { ...loc, ...v } : { ...v, ...loc };
        const lE = loc.endpoints || [], rE = v.endpoints || [];
        base2.endpoints = lE.map(e => { const r = rE.find(x => x.id === e.id); return r ? (newer ? fill({ ...r }, e) : fill({ ...e }, r)) : e; }).concat(rE.filter(r => !lE.some(e => e.id === r.id)));
        if (!base2.sel && v.sel) base2.sel = v.sel;
        store.set(k, base2); continue;
      }
      if (newer) store.set(k, loc != null ? fill(v, loc) : v);
    }
    for (const [id, d] of Object.entries(remote.imgs || {})){
      if (typeof d === 'string' && d.startsWith('data:image/') && !(await imgData(id))) await imgSave({ id, data:d });
    }
    if (remote.keys !== undefined && ckey() && !!ckey().keys !== !!remote.keys) store.set(CKEY, { ...ckey(), keys:!!remote.keys });
    setMeta({ tomb, known:store.get('ai_chats', []).filter(c => !c.temp).map(c => c.id) });
  }
  function cover(msg){
    const d = document.createElement('div'); d.id = 'qcCover'; d.dir = 'rtl';
    d.style.cssText = 'position:fixed;inset:0;z-index:100001;display:grid;place-items:center;background:var(--bg,#161616);color:var(--text,#eee);font:16px/1.9 system-ui,Tahoma,sans-serif;text-align:center';
    d.textContent = msg; document.body.appendChild(d); return d;
  }
  const reload = async () => { try{ await QuarkKV.flush(); }catch{} location.reload(); };

  /* يجلب ما في السحابة ويدمجه. opts.reload: يعيد تشغيل الواجهة بعد الدمج (الافتراضي نعم) · opts.interactive: يسأل عن كلمة السر */
  async function pullNow(opts = {}){
    if (pulling) return false; pulling = true;
    try{
      const r = await api('GET', '/sync/data', null, 30000);
      if (!r || r.s !== 200 || !r.j) return false;
      const inner = await decodeRemote(r.j, !!opts.interactive);
      if (!inner || !inner.items) return false;
      await apply(inner);
      setMeta({ owner:owner(), at:(INFO && INFO.updated) || Date.now(), sig:'' }); needsPull = false;
      if (opts.reload !== false){ await reload(); return new Promise(() => {}); }
      return true;
    }finally{ pulling = false; }
  }
  /* هل رفع جهاز آخر شيئًا جديدًا؟ نستقبله (يتجنّب الاستقبال أثناء توليد رد) */
  async function checkRemote(opts = {}){
    if (!active() || locked || pulling) return false;
    await refreshInfo(); if (!remoteNewer()) return false;
    if (opts.reload !== false && busyNow()) return false;
    return pullNow(opts);
  }

  /* مسح بيانات المستخدم من الجهاز (حساب مختلف أو حذف الحساب) */
  async function clearLocal(){
    for (const k of userKeys()){ if (k === 'ai_chats') store.set(k, []); else store.remove(k); }
    try{ for (const id of await imgDB.keys()) await imgDB.del(id); imgCache.clear(); }catch{}
    store.remove('ai_sub'); store.remove('ai_sub_used'); store.remove(CKEY); shrunk.clear();
  }
  async function wipeLocal(){ await clearLocal(); store.set(META, { owner:owner(), at:0, sig:'' }); await reload(); }
  /* حذف الحساب نهائيًا: النسخة السحابية والاشتراك من الخادم، ثم كل بيانات هذا الجهاز (بما فيها المفاتيح) والخروج */
  async function deleteAccount(){
    const r = await api('DELETE', '/account', null, 20000);
    if (!r || r.s !== 200) return { ok:false, msg:(r && r.j && r.j.error && r.j.error.message) || 'تعذّر الاتصال بالخدمة. لم يُحذف شيء.' };
    await clearLocal(); store.remove(META);
    try{ QuarkAuth.signOut(); }catch{}
    await reload(); return { ok:true };
  }

  /* عند الفتح (بعد تسجيل الدخول): استعادة ما هو أحدث في السحابة */
  async function boot(){
    if (!active()) return;
    const m = meta();
    if (m.owner && owner() && m.owner !== owner()){ cover('جارٍ تبديل الحساب…'); await wipeLocal(); return new Promise(() => {}); }
    const info = await api('GET', '/sync', null, 6000);
    if (!info || info.s !== 200){ if (info && info.s === 401) setStatus('auth'); return; }
    INFO = info.j;
    if (!m.owner) setMeta({ owner:owner() });
    if (remoteNewer()){
      const c = cover('جارٍ استعادة بياناتك من حسابك…');
      const r = await api('GET', '/sync/data', null, 30000);
      if (r && r.s === 200 && r.j){
        if (r.j.enc && !(ckey() && ckey().salt === r.j.salt)) c.remove();     /* نحتاج كلمة السر: نُظهر النافذة فوق الشاشة */
        const inner = await decodeRemote(r.j, true);
        if (inner && inner.items){
          await apply(inner); setMeta({ owner:owner(), at:INFO.updated, sig:'' });
          await reload(); return new Promise(() => {});
        }
      }
      c.remove();
    }
  }
  async function restoreNow(){
    await refreshInfo(); if (!INFO || !INFO.used) return false;
    const r = await api('GET', '/sync/data', null, 30000);
    if (!r || r.s !== 200 || !r.j) return false;
    const inner = await decodeRemote(r.j, true);
    if (!inner || !inner.items) return false;
    await apply(inner); setMeta({ at:INFO.updated || Date.now(), sig:'' }); await reload(); return true;
  }
  async function unlock(){ locked = false; const ok = await restoreNow(); if (!ok) { locked = true; setStatus('locked'); } return ok; }
  /* تسجيل الخروج: ندمج ما رُفع من أجهزة أخرى، ثم نرفع آخر التغييرات، ثم نخرج */
  async function logout(){
    if (active()){
      await checkRemote({ reload:false });
      const ok = await push(true);
      if (!ok && !(await qConfirm('تعذّر حفظ آخر تغييراتك في السحابة. إن خرجت الآن فقد لا تظهر على الأجهزة الأخرى. متابعة؟', { ok:'خروج' }))) return false;
    }
    try{ QuarkAuth.signOut(); }catch{}
    await reload(); return true;
  }
  /* مزامنة الآن (زر المستخدم): نستقبل أولًا إن لزم ثم نرفع */
  async function syncNow(){ if (await checkRemote({ interactive:true })) return true; return push(true); }

  /* ================= إدارة التشفير ================= */
  async function newKey(pass, keys){
    const salt = crypto.getRandomValues(new Uint8Array(16)), key = await deriveKey(pass, salt, ITER);
    store.set(CKEY, { salt:b64(salt), iter:ITER, raw:b64(new Uint8Array(await crypto.subtle.exportKey('raw', key))), keys:!!keys });
    setMeta({ sig:'' });
  }
  async function enableEnc(pass, keys){ if (locked) return false; await newKey(pass, keys); return push(true); }
  async function changePass(pass){ const ck = ckey(); if (!ck || locked) return false; await newKey(pass, ck.keys); return push(true); }
  async function disableEnc(){ if (locked) return false; store.remove(CKEY); setMeta({ sig:'' }); return push(true); }
  async function setKeysSync(on){ const ck = ckey(); if (!ck) return false; store.set(CKEY, { ...ck, keys:!!on }); setMeta({ sig:'' }); return push(true); }

  setInterval(() => { if (active() && !document.hidden) push(false); }, 30000);
  setTimeout(() => { if (active()) { refreshInfo().then(emit); push(false); } }, 9000);
  document.addEventListener('visibilitychange', () => {
    if (!active()) return;
    if (document.hidden){ if (needsPull) checkRemote(); else push(false); }
    else checkRemote();
  });

  return { active, boot, push, syncNow, restoreNow, unlock, logout, deleteAccount, refreshInfo, checkRemote, askPass,
    enableEnc, changePass, disableEnc, setKeysSync,
    encOn:() => !!ckey(), keysOn:() => !!(ckey() && ckey().keys), locked:() => locked,
    info:() => INFO, status:() => STATUS, error:() => lastErr, lastAt:() => meta().at || 0, skipped:() => meta().skipped || 0,
    sizes:() => SIZES || items().sz, onChange:f => { subs.add(f); },
    _t:{ apply, items, seal, open, deriveKey, keyFromRaw, decodeRemote, updateTombs, shrink, meta, setMeta, b64, unb64 } };
})();
window.QuarkCloud = QuarkCloud;
