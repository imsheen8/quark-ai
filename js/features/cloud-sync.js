/* QUARK AI — المزامنة السحابية (لمن سجّل الدخول بحساب Google فقط).
   تحفظ كل شيء عدا المفاتيح (مفاتيح API والرموز وكلمات المرور) على وسيط QUARK ضمن مساحة الحساب (5MB مجانًا).
   بدون حساب Google لا تعمل، ويبقى تبويب التخزين يعرض مساحة الجهاز. */
'use strict';

const QuarkCloud = (() => {
  const META = 'ai_kv_cloud';                         /* محلي فقط (ai_kv_) ولا يدخل النسخة */
  const SKIP = /^(ai_lock|ai_account|ai_device_id|ai_auth|ai_sub|ai_onboarded|ai_intro|ai_gw_boot|ai_kv_|ai_od_|ai_errlog|ai_current)/;
  const SECRET = /^(key|api_?key|apikey|token|secret|password|pass|authorization|idtoken|access_?token|refresh_?token)$/i;
  let INFO = null, SIZES = null, STATUS = 'idle', pushing = false, lastErr = '';
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

  /* حذف أي حقل سرّي (يُفرَّغ فقط) */
  function strip(v, d = 0){
    if (d > 14 || v == null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(x => strip(x, d + 1));
    const o = {}; for (const k of Object.keys(v)) o[k] = SECRET.test(k) && typeof v[k] === 'string' ? '' : strip(v[k], d + 1);
    return o;
  }
  /* يملأ الحقول السرّية الفارغة في القادم من السحابة بما عندنا محليًا */
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
  /* لقطة بلا صور: العناصر + الأحجام + البصمة */
  function items(){
    const out = {}, sz = { chats:0, imgs:0, other:0 };
    for (const k of userKeys()){
      let v;
      if (k === 'ai_chats') v = store.get('ai_chats', []).filter(c => !c.temp);
      else { const raw = QuarkKV.get(k); if (raw == null) continue; try{ v = JSON.parse(raw); }catch{ continue; } }
      v = strip(v);
      if (k === 'ai_settings_v3' && v && Array.isArray(v.endpoints)) v.endpoints = v.endpoints.filter(e => !e.managed);
      out[k] = v; const n = bytes(JSON.stringify(v)); if (k === 'ai_chats') sz.chats += n; else sz.other += n;
    }
    const ids = imgIds(out.ai_chats || []);
    return { items:out, sz, ids, sig:hash(JSON.stringify(out) + '|' + ids.join(',')) };
  }
  async function build(quota){
    const b = items(); let used = b.sz.chats + b.sz.other + 4096; const imgs = {}; let skipped = 0;
    for (const id of b.ids){
      const d = await imgData(id); if (!d) continue;
      const n = d.length + id.length + 8;
      if (used + n > quota){ skipped++; continue; }
      imgs[id] = d; used += n; b.sz.imgs += n;
    }
    return { ...b, imgs, skipped, tooBig:b.sz.chats + b.sz.other + 4096 > quota };
  }

  async function refreshInfo(){ const r = await api('GET', '/sync', null, 8000); if (r && r.s === 200) INFO = r.j; return INFO; }

  async function push(force){
    if (!active() || pushing) return false;
    pushing = true; setStatus('syncing');
    try{
      if (!INFO) await refreshInfo();
      const quota = (INFO && INFO.quota) || 5 * 1048576;
      const snap = await build(quota);
      if (snap.tooBig){ SIZES = snap.sz; setStatus('full'); return false; }
      if (!force && snap.sig === meta().sig){ setStatus('ok'); return true; }
      const r = await api('PUT', '/sync', JSON.stringify({ v:1, at:Date.now(), items:snap.items, imgs:snap.imgs }), 40000);
      if (!r){ setStatus('error', 'تعذّر الاتصال'); return false; }
      if (r.s === 200){ INFO = r.j; SIZES = snap.sz; setMeta({ owner:owner(), sig:snap.sig, at:r.j.updated, skipped:snap.skipped }); setStatus('ok'); return true; }
      if (r.s === 413){ setStatus('full'); return false; }
      if (r.s === 401){ setStatus('auth', 'انتهت الجلسة'); return false; }
      setStatus('error', (r.j && r.j.error && r.j.error.message) || 'تعذّرت المزامنة'); return false;
    }finally{ pushing = false; }
  }

  /* تطبيق نسخة سحابية: replace = السحابة تستبدل (لا تغييرات محلية غير مرفوعة)، merge = دمج بلا حذف */
  async function apply(snap, mode){
    const it = snap.items || {}, first = mode === 'merge';
    for (const k of Object.keys(it)){
      if (!/^ai_/.test(k) || SKIP.test(k)) continue;
      const v = it[k];
      if (k === 'ai_chats'){
        const loc = store.get('ai_chats', []), rem = Array.isArray(v) ? v : [];
        if (mode === 'replace'){ store.set(k, [...rem, ...loc.filter(c => c.temp)]); continue; }
        const map = new Map(loc.map(c => [c.id, c]));
        rem.forEach(c => { const l = map.get(c.id); if (!l || (c.messages || []).length > (l.messages || []).length || ((c.ts || 0) > (l.ts || 0) && (c.messages || []).length >= (l.messages || []).length)) map.set(c.id, c); });
        store.set(k, [...map.values()]); continue;
      }
      const rawLoc = QuarkKV.get(k); let loc = null; try{ loc = rawLoc == null ? null : JSON.parse(rawLoc); }catch{}
      if (k === 'ai_settings_v3' && v && loc){
        const lE = loc.endpoints || [], rE = (v.endpoints || []).filter(e => !lE.some(x => x.id === e.id));
        const merged = first ? { ...v, ...loc } : { ...v };
        merged.endpoints = [...lE, ...rE]; if (!merged.sel && v.sel) merged.sel = v.sel;
        store.set(k, merged); continue;
      }
      if (first && loc != null) continue;            /* أول مزامنة: ما على الجهاز يبقى */
      store.set(k, loc != null ? fill(v, loc) : v);
    }
    for (const [id, d] of Object.entries(snap.imgs || {})){
      if (typeof d === 'string' && d.startsWith('data:image/') && !(await imgData(id))) await imgSave({ id, data:d });
    }
  }
  function cover(msg){
    const d = document.createElement('div'); d.id = 'qcCover'; d.dir = 'rtl';
    d.style.cssText = 'position:fixed;inset:0;z-index:100001;display:grid;place-items:center;background:var(--bg,#161616);color:var(--text,#eee);font:16px/1.9 system-ui,Tahoma,sans-serif;text-align:center';
    d.textContent = msg; document.body.appendChild(d); return d;
  }
  const reload = async () => { try{ await QuarkKV.flush(); }catch{} location.reload(); };

  /* مسح بيانات المستخدم السابق من الجهاز (حساب Google مختلف) */
  async function wipeLocal(){
    for (const k of userKeys()){ if (k === 'ai_chats') store.set(k, []); else store.remove(k); }
    try{ for (const id of await imgDB.keys()) await imgDB.del(id); imgCache.clear(); }catch{}
    store.set(META, { owner:owner(), at:0, sig:'' });
    await reload();
  }

  /* عند الفتح (بعد تسجيل الدخول): استعادة ما هو أحدث في السحابة */
  async function boot(){
    if (!active()) return;
    let m = meta();
    if (m.owner && owner() && m.owner !== owner()){ cover('جارٍ تبديل الحساب…'); await wipeLocal(); return new Promise(() => {}); }
    const info = await api('GET', '/sync', null, 6000);
    if (!info || info.s !== 200){ if (info && info.s === 401) setStatus('auth'); return; }
    INFO = info.j;
    if (!m.owner) setMeta({ owner:owner() });
    if (INFO.used > 0 && INFO.updated > (m.at || 0) + 1500){
      const c = cover('جارٍ استعادة بياناتك من حسابك…');
      const r = await api('GET', '/sync/data', null, 30000);
      if (r && r.s === 200 && r.j && r.j.items){
        const dirty = items().sig !== m.sig;
        await apply(r.j, !m.at ? 'merge' : (dirty ? 'merge' : 'replace'));
        setMeta({ owner:owner(), at:INFO.updated, sig:'' });
        await reload(); return new Promise(() => {});
      }
      c.remove();
    }
  }
  async function restoreNow(){
    const r = await api('GET', '/sync/data', null, 30000);
    if (!r || r.s !== 200 || !r.j || !r.j.items) return false;
    await apply(r.j, 'merge'); setMeta({ at:(INFO && INFO.updated) || Date.now(), sig:'' }); await reload(); return true;
  }
  /* تسجيل الخروج: نرفع آخر التغييرات أولًا ثم نخرج من الحساب */
  async function logout(){
    if (active()){
      const ok = await push(true);
      if (!ok && !(await qConfirm('تعذّر حفظ آخر تغييراتك في السحابة. إن خرجت الآن فقد لا تظهر على الأجهزة الأخرى. متابعة؟', { ok:'خروج' }))) return false;
    }
    try{ QuarkAuth.signOut(); }catch{}
    await reload(); return true;
  }

  setInterval(() => { if (active() && !document.hidden) push(false); }, 30000);
  setTimeout(() => { if (active()) { refreshInfo().then(emit); push(false); } }, 9000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && active()) push(false); });

  return { active, boot, push, syncNow:() => push(true), restoreNow, logout, refreshInfo,
    info:() => INFO, status:() => STATUS, error:() => lastErr, lastAt:() => meta().at || 0, skipped:() => meta().skipped || 0,
    sizes:() => SIZES || items().sz, onChange:f => { subs.add(f); } };
})();
window.QuarkCloud = QuarkCloud;
