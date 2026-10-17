/* QUARK AI — قائمة النماذج السريعة */
'use strict';

/* ================= قائمة النماذج السريعة ================= */
let attachView = 'main';
function openPop(){ showAttach('model'); $('attachPop').classList.add('show'); }
function closePop(){ if (attachView === 'model') closeAttach(); }
function popItems(q){
  const out = [];
  settings.endpoints.filter(e => e.enabled).forEach(e => e.models.forEach(m => {
    if ((m.on || q) && (!q || m.id.toLowerCase().includes(q))) out.push({ ep:e, m });
  }));
  return out.slice(0, 80);
}
function renderPop(){
  const raw = el.modelSearch.value.trim(), q = raw.toLowerCase(), am = popTarget === 'B' ? cmpModel() : activeModel();
  const list = popItems(q);
  el.popList.innerHTML = '';
  list.forEach(({ ep, m }) => {
    const on = am && am.ep.id === ep.id && am.model === m.id;
    const b = document.createElement('button');
    b.className = 'pop-item' + (on ? ' sel' : '');
    b.innerHTML = `<span>${esc(m.id)}</span>${isImgModel(ep, m.id) ? '<span class="ph">صور</span>' : ''}<span class="ph">${esc(hostOf(ep.url))}</span>${on ? ic('check') : ''}`;
    b.addEventListener('click', () => pickModel(ep.id, m.id));
    el.popList.appendChild(b);
  });
  const target = am?.ep || settings.endpoints.find(e => e.enabled);
  if (raw && target && !list.some(x => x.m.id === raw)){
    const b = document.createElement('button');
    b.className = 'pop-item custom';
    b.innerHTML = `<span>استخدم «${esc(raw)}»</span>${ic('plus')}`;
    b.addEventListener('click', () => pickModel(target.id, raw));
    el.popList.appendChild(b);
  }
  if (!el.popList.children.length)
    el.popList.innerHTML = `<div class="pop-empty">${settings.endpoints.some(e => e.enabled) ? 'لا نماذج مفعّلة — اكتب معرّف نموذج أو فعّل نماذج من الإعدادات' : 'أضف نقطة اتصال من الإعدادات أولًا'}</div>`;
}
function pickModel(epid, id){
  const ep = epOf(epid); if (!ep) return;
  let m = ep.models.find(x => x.id === id);
  if (!m){ m = { id, on:true }; ep.models.push(m); }
  m.on = true;
  if (popTarget === 'B'){
    cmpState.sel = { ep:epid, model:id }; saveCmp(); persistSettings(); updateModelLabels(); closePop();
    toast('النموذج الثاني: ' + shortModel(id)); return;
  }
  settings.sel = { ep:epid, model:id };
  persistSettings(); updateModelLabels(); closePop(); toast('تم اختيار النموذج: ' + shortModel(id));
}
el.modelSearch.addEventListener('input', renderPop);
el.modelSearch.addEventListener('keydown', e => {
  if (e.key === 'Enter'){
    e.preventDefault(); const v = el.modelSearch.value.trim(); if (!v) return;
    const t = activeModel()?.ep || settings.endpoints.find(x => x.enabled);
    if (t) pickModel(t.id, v); else toast('أضف نقطة اتصال أولًا');
  }
});
$('popSettings').addEventListener('click', () => { closePop(); openSettings(); });

const niceErr = e => e.message === 'Failed to fetch' ? 'تعذّر الاتصال — تحقق من العنوان أو من إعداد CORS' : e.message;
async function fetchModelIds(url, key, proto, kind){
  if (proto === 'ondevice'){ const ids = window.__od.store.list().filter(r => r.state === 'ready').map(r => r.id); ids.img = new Map(); return ids; }
  if (await gwReady()){
    try{ return await gwModels({ url, key, proto, kind }); }
    catch(e){ if (!e.gwDown) throw e; }
  }
  if (['gemini', 'ollama'].includes(proto)) throw new Error('هذه الصيغة تتطلب تشغيل البوابة (python3 serve.py).');
  const base = url.trim().replace(/\/+$/,'');
  let headers = {};
  if (proto === 'anthropic') headers = { 'x-api-key':key, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true' };
  else if (key) headers.authorization = 'Bearer ' + key;
  const res = await fetch(base + '/models', { headers });
  if (!res.ok) throw new Error(await errText(res));
  const j = await res.json();
  const arr = j.data || j.models || (Array.isArray(j) ? j : []);
  const ids = [...new Set(arr.map(m => typeof m === 'string' ? m : (m.id || m.name)).filter(Boolean))].sort();
  ids.img = new Map();
  arr.forEach(m => { if (m && typeof m === 'object'){ const id = m.id || m.name, out = m.architecture?.output_modalities; if (id && Array.isArray(out)) ids.img.set(id, { img:out.includes('image'), only:out.includes('image') && !out.includes('text') }); } });
  return ids;
}
/* تفاصيل يصرّح بها المزوّد (نافذة السياق، الرؤية، التفكير) تُحفظ مع النموذج */
function applyMeta(m, ids){
  const d = ids.meta && ids.meta.get(m.id); if (!d) return;
  ['ctx', 'vision', 'think'].forEach(k => { if (d[k]) m[k] = d[k]; else delete m[k]; });
}
async function syncModels(ep){
  const ids = await fetchModelIds(ep.url, ep.key, ep.proto, ep.kind);
  const have = new Set(ep.models.map(m => m.id));
  const fresh = ids.filter(i => !have.has(i));
  const defOn = ep.models.length + fresh.length <= 40;
  fresh.forEach(i => ep.models.push({ id:i, on:defOn }));
  ep.models.forEach(m => { Object.assign(m, imgFlag(ids, m.id)); applyMeta(m, ids); });
  return ids.length;
}
$('popRefresh').addEventListener('click', async () => {
  const ep = activeModel()?.ep || settings.endpoints.find(e => e.enabled);
  if (!ep){ toast('أضف نقطة اتصال أولًا'); return; }
  const btn = $('popRefresh'); btn.disabled = true;
  try{ const n = await syncModels(ep); persistSettings(); renderPop(); toast(`تم جلب ${n} نموذجًا`); }
  catch(e){ toast('تعذّر الجلب: ' + niceErr(e)); }
  btn.disabled = false;
});

