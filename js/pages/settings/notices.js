/* QUARK AI — صفحة «الإشعارات» (القائمة ⓘ في الإعدادات ← الإشعارات)
   تعرض الإشعارات التي يرسلها المطوّر من لوحة تحكم الوسيط (GET /notices). نصوص فقط، وتُحفظ نسخة محليًا لتظهر بلا اتصال.
   «غير المقروء» = إشعار لم تُفتح صفحة الإشعارات منذ وصوله؛ يظهر عدّاده بجانب «الإشعارات» ونقطة على زر ⓘ. */
'use strict';

(() => {
  const KEY = 'ai_notices';
  const LOC = 'ar-u-nu-latn';
  const E = s => esc(String(s == null ? '' : s));
  const root = () => document.getElementById('ntRoot');
  const load = () => { try{ const o = store.get(KEY, null); return o && Array.isArray(o.items) ? o : { items:[], seen:[], at:0 }; }catch{ return { items:[], seen:[], at:0 }; } };
  let st = load(), loading = false, failed = false, fresh = new Set();
  const save = () => { try{ store.set(KEY, { items:st.items.slice(0, 50), seen:st.seen.slice(-200), at:st.at }); }catch{} };
  const unread = () => st.items.filter(n => !st.seen.includes(n.id)).length;
  const base = () => String(typeof MANAGED_URL === 'string' ? MANAGED_URL : '').replace(/\/+$/, '');

  const when = ts => {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'الآن';
    if (s < 3600) return 'قبل ' + Math.round(s / 60) + ' د';
    if (s < 86400) return 'قبل ' + Math.round(s / 3600) + ' س';
    return new Date(ts).toLocaleDateString(LOC, { day:'numeric', month:'short', year:'numeric' });
  };

  function paintDots(){
    const n = unread(), d = document.getElementById('ntTabDot'), b = document.getElementById('setInfo');
    if (d){ d.hidden = !n; d.textContent = n > 9 ? '9+' : String(n); }
    if (b) b.classList.toggle('has-nt', n > 0);
  }

  function render(){
    const r = root(); if (!r) return;
    const items = st.items;
    const head = `<div class="nt-head"><span>${items.length ? E(items.length) + ' إشعار' : ''}</span><button type="button" class="lib-btn" data-nt="refresh"${loading ? ' disabled' : ''}><svg class="i" aria-hidden="true"><use href="#i-refresh"/></svg>${loading ? 'جارٍ التحديث…' : 'تحديث'}</button></div>`;
    const note = failed ? `<div class="nt-note">تعذّر تحديث الإشعارات. تحقق من الإنترنت${items.length ? ' — يعرض ما وصلك سابقًا' : ''}.</div>` : '';
    const list = items.length
      ? items.map(n => `<article class="nt-card${fresh.has(n.id) ? ' new' : ''}"><div class="nt-top"><b>${E(n.title)}</b>${fresh.has(n.id) ? '<span class="nt-new">جديد</span>' : ''}</div><div class="nt-time">${E(when(n.at))}</div><div class="nt-body">${E(n.body)}</div></article>`).join('')
      : `<div class="nt-empty"><svg class="i" aria-hidden="true"><use href="#i-bell"/></svg><p>${loading ? 'جارٍ التحميل…' : 'لا توجد إشعارات حاليًا'}</p><small>ستظهر هنا رسائل المطوّر والتحديثات المهمة.</small></div>`;
    r.innerHTML = `<div class="nt">${head}${note}<div class="nt-list">${list}</div></div>`;
  }

  async function fetchNow(){
    if (!base() || loading) return;
    loading = true; failed = false;
    if (root() && visible()) render();
    try{
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
      const res = await fetch(base() + '/notices', { cache:'no-store', signal:ctl.signal }).finally(() => clearTimeout(t));
      if (!res.ok) throw new Error('http ' + res.status);
      const j = await res.json();
      const items = (Array.isArray(j.items) ? j.items : []).filter(n => n && n.id && n.title).map(n => ({ id:String(n.id), title:String(n.title), body:String(n.body || ''), at:Number(n.at) || 0 }));
      st.items = items; st.at = Date.now();
      st.seen = st.seen.filter(id => items.some(n => n.id === id));      /* لا نحتفظ بمعرّفات إشعارات حُذفت */
      save();
    }catch{ failed = true; }
    loading = false; paintDots();
    if (visible()) render();
  }

  const visible = () => { const p = document.querySelector('.tab-panel[data-panel="notices"]'); return !!(p && !p.hidden && root() && root().offsetParent !== null); };

  window.__ntOpen = () => {
    fresh = new Set(st.items.filter(n => !st.seen.includes(n.id)).map(n => n.id));
    render();
    fetchNow().then(() => {
      /* ما ظهر الآن اعتُبر مقروءًا؛ الجديد يبقى بعلامة «جديد» حتى تغادر الصفحة */
      st.items.filter(n => !st.seen.includes(n.id)).forEach(n => { fresh.add(n.id); });
      if (visible()) { st.items.forEach(n => { if (!st.seen.includes(n.id)) st.seen.push(n.id); }); save(); paintDots(); render(); }
    });
    if (visible()) { st.items.forEach(n => { if (!st.seen.includes(n.id)) st.seen.push(n.id); }); save(); paintDots(); }
  };
  window.__ntUnread = unread;

  document.addEventListener('click', e => { if (e.target.closest('[data-nt="refresh"]')) fetchNow(); });

  /* جلب هادئ بعد الإقلاع ثم كل 15 دقيقة ليظهر عدّاد غير المقروء دون فتح الصفحة */
  paintDots();
  setTimeout(fetchNow, 3000);
  setInterval(() => { if (!document.hidden) fetchNow(); }, 15 * 60 * 1000);
})();
