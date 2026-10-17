/* QUARK AI — صفحة النماذج: الإجراءات */
'use strict';

/* ----- إجراءات ----- */
const itemOf = key => mdItems().find(x => x.key === key);
function mdUse(it){
  if (!it.ep.enabled){ toast('نقطة الاتصال معطّلة — فعّلها من الإعدادات'); return; }
  it.m.on = true; settings.sel = { ep:it.ep.id, model:it.m.id }; persistSettings(); updateModelLabels(); mdRender();
  toast('تم اختيار النموذج: ' + shortModel(it.m.id));
}
function mdSecond(it){
  if (!it.ep.enabled){ toast('نقطة الاتصال معطّلة — فعّلها من الإعدادات'); return; }
  it.m.on = true; cmpState.sel = { ep:it.ep.id, model:it.m.id }; cmpState.on = true; saveCmp(); persistSettings(); updateModelLabels(); mdRender();
  toast('النموذج الثاني: ' + shortModel(it.m.id));
}
function mdToggleFav(it){
  modelFav.has(it.key) ? modelFav.delete(it.key) : modelFav.add(it.key); saveFav(); mdRender();
  toast(modelFav.has(it.key) ? 'أُضيف للمفضلة' : 'أُزيل من المفضلة');
}
async function mdTestOne(it){
  const { ep, m, key } = it;
  if (ep.kind !== 'local' && !ep.key){ mdTest[key] = { ok:false, err:'لا يوجد مفتاح API لهذه النقطة' }; mdRepaint(key); return; }
  mdTest[key] = { busy:true }; mdRepaint(key);
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ep.proto === 'ondevice' ? 180000 : 25000), t0 = performance.now();
  try{
    await completeOnce({ ep, model:m.id }, 'Reply with the single word: OK', ctl.signal);
    mdTest[key] = { ok:true, ms:Math.round(performance.now() - t0) };
  }catch(e){
    mdTest[key] = { ok:false, err:e.name === 'AbortError' ? 'انتهت المهلة (25 ثانية)' : niceErr(e) };
  }finally{ clearTimeout(tm); }
  window.__mdPro.record(key, mdTest[key]);
  mdRepaint(key);
}
async function mdTestMany(list){
  const q = [...list]; let ok = 0, bad = 0;
  const worker = async () => { for (let it; (it = q.shift());){ await mdTestOne(it); mdTest[it.key]?.ok ? ok++ : bad++; } };
  await Promise.all([worker(), worker(), worker()]);
  toast(`اكتمل الاختبار — ناجح: ${ok} · فاشل: ${bad}`);
}
function mdParams(it){
  if (!it.ep.enabled){ toast('نقطة الاتصال معطّلة — فعّلها من الإعدادات'); return; }
  settings.sel = { ep:it.ep.id, model:it.m.id }; persistSettings(); updateModelLabels();
  prmScope = 'model'; openSettings('custom'); toast('تعديل معاملات: ' + shortModel(it.m.id));
}
function mdRemove(keys){
  const set = new Set(keys);
  settings.endpoints.filter(e => e.proto === 'ondevice').forEach(ep => ep.models.forEach(m => { if (set.has(mkey(ep, m.id))) window.__od.store.remove(m.id); }));
  settings.endpoints.forEach(ep => { ep.models = ep.models.filter(m => !set.has(mkey(ep, m.id))); });
  keys.forEach(k => { modelFav.delete(k); delete modelUse[k]; delete mdTest[k]; mdSel.delete(k); delete settings.params.models[k]; });
  if (settings.sel && set.has(settings.sel.ep + '|' + settings.sel.model)) settings.sel = null;
  if (cmpState.sel && set.has(cmpState.sel.ep + '|' + cmpState.sel.model)){ cmpState.sel = null; cmpState.on = false; saveCmp(); }
  saveFav(); store.set('ai_model_use', modelUse);
  if (!settings.sel){ outer: for (const e of settings.endpoints){ if (!e.enabled) continue; const m = e.models.find(x => x.on); if (m){ settings.sel = { ep:e.id, model:m.id }; break outer; } } }
  persistSettings(); updateModelLabels(); mdRender();
}
function mdAskDelete(keys){
  window.__dlg(`حذف ${keys.length} ${keys.length > 10 ? 'نموذجًا' : keys.length === 1 ? 'نموذج' : 'نماذج'}؟`,
    '<p style="color:var(--text-2);line-height:1.8">' + (keys.some(k => k.includes('|') && settings.endpoints.some(e => e.proto === 'ondevice' && k.startsWith(e.id + '|'))) ? 'النماذج المحلية يُحذف ملفها من الجهاز أيضًا (يمكن تنزيلها مجددًا). ' : '') + 'يُحذف من قائمتك فقط، ويمكن جلبه مجددًا من نقطة الاتصال.</p>',
    () => { mdRemove(keys); toast('تم الحذف'); }, true);
}
/* زر «+»: إضافة نموذج يدويًا لنقطة اتصال (الأصوات لها صفحتها الخاصة) */
function mdAddDialog(){
  const eps = settings.endpoints;
  if (!eps.length){ toast('أضف نقطة اتصال أولًا'); openSettings('keys'); return; }
  const ov = document.createElement('div'); ov.className = 'lib-ov q-confirm show';
  ov.innerHTML = `<div class="lib-dlg" role="dialog" aria-modal="true"><h2>إضافة نموذج</h2>` +
    `<label class="lib-f">نقطة الاتصال<select class="fld" id="mdAddEp">${eps.map(x => `<option value="${x.id}">${esc(hostOf(x.url))}</option>`).join('')}</select></label>` +
    '<label class="lib-f">معرّف النموذج<input type="text" id="mdAddId" dir="ltr" autocomplete="off" spellcheck="false" placeholder="مثل gpt-4o-mini"></label>' +
    '<div class="lib-acts"><button type="button" class="lib-btn" data-cx>إلغاء</button><button type="button" class="lib-btn pri" data-cok>إضافة</button></div></div>';
  const q = s => ov.querySelector(s);
  const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
  const save = () => {
    const ep = epOf(q('#mdAddEp').value), id = q('#mdAddId').value.trim();
    if (!ep || !id){ toast('اكتب معرّف النموذج'); q('#mdAddId').focus(); return; }
    const ex = ep.models.find(m => m.id === id); if (ex) ex.on = true; else ep.models.push({ id, on:true });
    persistSettings(); close();
    mdUi.ep = 'all'; mdUi.q = ''; $('mdQ').value = ''; mdRender(); toast('تمت إضافة النموذج');
  };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-cx]')) return close(); if (e.target.closest('[data-cok]')) save(); });
  ov.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'mdAddId') save(); });
  document.body.appendChild(ov); setTimeout(() => q('#mdAddId').focus(), 40);
}
async function mdSyncAll(){
  const eps = settings.endpoints.filter(e => e.enabled);
  if (!eps.length){ toast('لا توجد نقاط اتصال مفعّلة'); return; }
  const b = $('mdSync'); b.disabled = true; toast('جارٍ جلب النماذج…');
  let n = 0, f = 0;
  for (const ep of eps){ try{ await syncModels(ep); n++; }catch{ f++; } }
  b.disabled = false; persistSettings(); mdRender(); updateModelLabels();
  toast(f ? `جُلبت ${n} نقطة، وتعذّر جلب ${f}` : `تم تحديث النماذج من ${n} نقطة`);
}

