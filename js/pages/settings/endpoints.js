/* QUARK AI — الإعدادات: المفاتيح والنماذج */
'use strict';

/* ================= صفحة الإعدادات: المفاتيح والنماذج ================= */
const mainEl = document.querySelector('.main');
let draft = null, tested = null;
const openEps = new Set(), modelFilter = {};
const norm = u => u.trim().replace(/\/+$/,'');
const fKind = $('fKind'), fUrl = $('fUrl'), fPreset = $('fPreset'), fKey = $('fKey'), fProto = $('fProto');

fPreset.innerHTML = Object.entries(PRESETS).map(([k,p]) => `<option value="${k}">${esc(p.label)}</option>`).join('');
function applyPreset(k){
  const p = PRESETS[k]; fPreset.value = k;
  if (k !== 'custom'){ fUrl.value = p.url; fProto.value = p.proto; fKind.value = p.kind; }
  $('fHelp').innerHTML = p.help || '';
  fKey.placeholder = fKind.value === 'local' ? 'مفتاح API (اختياري)' : 'مفتاح API';
  tested = null;
}
fPreset.addEventListener('change', () => applyPreset(fPreset.value));
fKind.addEventListener('change', () => {
  const want = fKind.value;
  if (fPreset.value !== 'custom' && PRESETS[fPreset.value].kind !== want) applyPreset(want === 'local' ? 'ollama' : 'openrouter');
  else fKey.placeholder = want === 'local' ? 'مفتاح API (اختياري)' : 'مفتاح API';
});
[fUrl, fKey, fProto].forEach(i => i.addEventListener('input', () => { tested = null; }));

async function formFetch(){
  const url = norm(fUrl.value), key = fKey.value.trim(), proto = fProto.value;
  if (!/^https?:\/\/\S+/i.test(url)){ toast('أدخل عنوان API صحيحًا يبدأ بـ http'); return null; }
  if (fKind.value !== 'local' && !key){ toast('أدخل مفتاح API'); return null; }
  const ids = await fetchModelIds(url, key, proto, fKind.value);
  tested = { url, key, proto, ids };
  return ids;
}
$('fTest').addEventListener('click', async () => {
  const b = $('fTest'); b.disabled = true;
  try{ const ids = await formFetch(); if (ids) toast(`الاتصال ناجح — ${ids.length} نموذجًا`); }
  catch(e){ toast('فشل الاتصال: ' + niceErr(e)); }
  b.disabled = false;
});
$('fAdd').addEventListener('click', async () => {
  const url = norm(fUrl.value), key = fKey.value.trim(), proto = fProto.value;
  if (!/^https?:\/\/\S+/i.test(url)){ toast('أدخل عنوان API صحيحًا يبدأ بـ http'); return; }
  if (fKind.value !== 'local' && !key){ toast('أدخل مفتاح API'); return; }
  const b = $('fAdd'); b.disabled = true;
  let ids = [], warn = false;
  if (tested && tested.url === url && tested.key === key && tested.proto === proto) ids = tested.ids;
  else { try{ ids = await fetchModelIds(url, key, proto, fKind.value); }catch{ warn = true; } }
  const defOn = ids.length <= 40;
  const ep = { id:epId(), preset:fPreset.value, url, key, proto, kind:fKind.value, enabled:true, models:ids.map(i => { const m = { id:i, on:defOn, ...imgFlag(ids, i) }; applyMeta(m, ids); return m; }) };
  draft.endpoints.push(ep); openEps.add(ep.id); fKey.value = ''; tested = null; renderEps();
  $('epList').querySelector(`[data-id="${ep.id}"]`)?.scrollIntoView({ block:'nearest', behavior:'smooth' });
  toast(warn ? 'أُضيفت بدون جلب النماذج — أضفها يدويًا' : `تمت الإضافة (${ids.length} نموذجًا)`);
  b.disabled = false;
});

function modelsHTML(e){
  const q = (modelFilter[e.id] || '').trim().toLowerCase();
  const ms = e.models.filter(m => !q || m.id.toLowerCase().includes(q));
  if (!ms.length) return `<div class="pop-empty">${e.models.length ? 'لا نتائج' : 'لا توجد نماذج بعد — اضغط «جلب» أو أضف معرّفًا يدويًا'}</div>`;
  return ms.slice(0, 150).map(m =>
    `<button type="button" class="ep-m${m.on ? ' on' : ''}" data-a="m" data-m="${esc(m.id)}"><span class="ck">${ic('check')}</span><span>${esc(m.id)}</span></button>`).join('') +
    (ms.length > 150 ? '<div class="pop-empty">يظهر أول 150 نموذجًا — استخدم البحث</div>' : '');
}
const countText = e => `${e.models.filter(m => m.on).length}/${e.models.length} نماذج مفعّلة`;
function epCard(e){
  const d = document.createElement('div');
  d.className = 'ep-card' + (e.enabled ? '' : ' off');
  d.dataset.id = e.id;
  const keyTxt = e.key ? 'المفتاح: ••••' + esc(e.key.slice(-4)) : (e.kind === 'local' ? 'بدون مفتاح (محلي)' : 'لا يوجد مفتاح');
  d.innerHTML = `
    <div class="ep-top" style="cursor:default">
      <div class="ep-info">
        <div class="ep-name"><b dir="ltr">${esc(hostOf(e.url))}</b>${e.kind === 'local' ? '<span class="tag">محلي</span>' : ''}${e.enabled ? '' : '<span class="tag mute">معطّلة</span>'}</div>
        <small>${keyTxt}</small>
      </div>
      <button type="button" class="ep-btn" data-a="en">${e.enabled ? 'تعطيل' : 'تفعيل'}</button>
      <button type="button" class="ep-btn del" data-a="del">حذف</button>
    </div>
    <div class="ep-url"><span>${esc(e.url)}</span><button type="button" class="ep-copy" data-a="copy" aria-label="نسخ العنوان">${ic('copy')}</button></div>`;
  return d;
}
function renderEps(){
  const box = $('epList'); box.innerHTML = '';
  if (!draft.endpoints.length){
    box.innerHTML = '<div class="empty-list">لم تُضف أي نقطة اتصال بعد. استخدم النموذج أعلاه لإضافة أول نقطة.</div>'; return;
  }
  [['local','محلي','monitor'], ['api','API','globe']].forEach(([k, label, icn]) => {
    const list = draft.endpoints.filter(e => e.kind === k); if (!list.length) return;
    const g = document.createElement('div'); g.className = 'ep-group'; g.innerHTML = `${ic(icn)} ${label}`; box.appendChild(g);
    list.forEach(e => box.appendChild(epCard(e)));
  });
}
$('epList').addEventListener('click', async ev => {
  const card = ev.target.closest('.ep-card'); if (!card || ev.target.closest('input')) return;
  const e = draft.endpoints.find(x => x.id === card.dataset.id); if (!e) return;
  const t = ev.target.closest('[data-a]'); if (!t) return;
  const a = t.dataset.a;
  if (a === 'toggle'){ openEps.has(e.id) ? openEps.delete(e.id) : openEps.add(e.id); renderEps(); }
  else if (a === 'en'){ e.enabled = !e.enabled; renderEps(); }
  else if (a === 'del'){
    if (!await qConfirm('حذف نقطة الاتصال هذه؟', { ok:'حذف' })) return;
    draft.endpoints = draft.endpoints.filter(x => x.id !== e.id); openEps.delete(e.id); renderEps();
  }
  else if (a === 'copy'){ const ok = await copyText(e.url); toast(ok ? 'تم نسخ العنوان' : 'تعذّر النسخ'); }
  else if (a === 'm'){
    const m = e.models.find(x => x.id === t.dataset.m); if (!m) return;
    m.on = !m.on; t.classList.toggle('on', m.on); card.querySelector('.cnt').textContent = countText(e);
  }
  else if (a === 'all' || a === 'none'){
    const q = (modelFilter[e.id] || '').trim().toLowerCase();
    e.models.forEach(m => { if (!q || m.id.toLowerCase().includes(q)) m.on = a === 'all'; }); renderEps();
  }
  else if (a === 'addm') addManual(card, e);
  else if (a === 'sync'){
    t.disabled = true;
    try{ const n = await syncModels(e); renderEps(); toast(`تم جلب ${n} نموذجًا`); }
    catch(err){ toast('تعذّر الجلب: ' + niceErr(err)); t.disabled = false; }
  }
});
function addManual(card, e){
  const i = card.querySelector('[data-newm]'), v = i.value.trim(); if (!v) return;
  const ex = e.models.find(m => m.id === v);
  if (ex) ex.on = true; else e.models.push({ id:v, on:true });
  renderEps();
}
$('epList').addEventListener('input', ev => {
  const inp = ev.target.closest('[data-filter]'); if (!inp) return;
  const card = inp.closest('.ep-card'), e = draft.endpoints.find(x => x.id === card.dataset.id); if (!e) return;
  modelFilter[e.id] = inp.value; card.querySelector('.ep-models').innerHTML = modelsHTML(e);
});
$('epList').addEventListener('keydown', ev => {
  if (ev.key !== 'Enter' || !ev.target.matches('[data-newm]')) return;
  ev.preventDefault();
  const card = ev.target.closest('.ep-card'), e = draft.endpoints.find(x => x.id === card.dataset.id);
  if (e) addManual(card, e);
});

