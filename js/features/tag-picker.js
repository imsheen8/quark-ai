/* QUARK AI — نافذة الوسوم */
'use strict';

/* ----- نافذة الوسوم ----- */
let tgIds = null;
function openTagPicker(ids){
  tgIds = ids && ids.length ? ids.slice() : null;
  $('tgTitle').textContent = !tgIds ? 'إدارة الوسوم' : tgIds.length > 1 ? `وسوم ${tgIds.length} محادثات` : 'وسوم المحادثة';
  $('tgNew').value = ''; renderTagPicker(); $('tgOv').classList.add('show');
}
function renderTagPicker(){
  const box = $('tgList');
  if (!tags.length){ box.innerHTML = '<div class="pop-empty">لا توجد وسوم بعد — أضف أول وسم من الحقل أعلاه</div>'; return; }
  const sel = tgIds ? chats.filter(c => tgIds.includes(c.id)) : [];
  box.innerHTML = tags.map(t => {
    const n = chats.filter(c => c.tags?.includes(t.id)).length;
    if (tgIds){
      const have = sel.filter(c => c.tags?.includes(t.id)).length, st = !have ? '' : have === sel.length ? ' on' : ' some';
      return `<div class="tg-row"><button type="button" class="tg-pick${st}" data-pick="${t.id}"><span class="tg-ck">${ic('check')}</span><i class="tg-dot" style="background:${t.color}"></i><span class="tg-name">${esc(t.name)}</span><small>${n}</small></button></div>`;
    }
    return `<div class="tg-row man"><i class="tg-dot" style="background:${t.color}"></i><input class="tg-rn" data-rn="${t.id}" value="${esc(t.name)}" maxlength="24" aria-label="اسم الوسم"><small>${n}</small><button type="button" class="tg-ico dng" data-del="${t.id}" aria-label="حذف الوسم">${ic('trash')}</button></div>`;
  }).join('');
}
function tgCreate(){
  const t = addTag($('tgNew').value);
  if (!t){ toast('اكتب اسم الوسم'); return; }
  if (tgIds) setChatTag(tgIds, t.id, true);
  $('tgNew').value = ''; renderTagPicker(); afterTagChange();
  toast(tgIds ? 'تمت إضافة الوسم' : 'تم إنشاء الوسم');
}
$('tgAdd').addEventListener('click', tgCreate);
$('tgNew').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); tgCreate(); } });
$('tgList').addEventListener('click', async e => {
  const pk = e.target.closest('[data-pick]');
  if (pk){ setChatTag(tgIds, pk.dataset.pick, !pk.classList.contains('on')); renderTagPicker(); afterTagChange(); return; }
  const dl = e.target.closest('[data-del]');
  if (dl){
    const t = tags.find(x => x.id === dl.dataset.del); if (!t) return;
    if (!await qConfirm(`حذف الوسم «${t.name}»؟ سيُزال من كل المحادثات.`, { ok:'حذف' })) return;
    deleteTag(t.id); renderTagPicker(); afterTagChange(); toast('تم حذف الوسم');
  }
});
$('tgList').addEventListener('change', e => {
  const rn = e.target.closest('[data-rn]'); if (!rn) return;
  const t = tags.find(x => x.id === rn.dataset.rn); if (!t) return;
  const v = rn.value.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!v || tags.some(x => x !== t && x.name.toLowerCase() === v.toLowerCase())){ rn.value = t.name; toast(v ? 'هذا الوسم موجود مسبقًا' : 'الاسم لا يمكن أن يكون فارغًا'); return; }
  t.name = v; saveTags(); afterTagChange();
});
$('tgList').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-rn]')){ e.preventDefault(); e.target.blur(); } });


/* ----- نافذة إنشاء وسم: الاسم والوصف واللون ----- */
let tcColor = TAG_COLORS[0], tcEditId = null;
function tcPaint(){
  $('tcColors').innerHTML = TAG_COLORS.map(c => `<button type="button" class="tc-sw${c === tcColor ? ' on' : ''}" data-c="${c}" style="background:${c}" aria-label="لون">${ic('check')}</button>`).join('') +
    `<label class="tc-sw tc-custom${TAG_COLORS.includes(tcColor) ? '' : ' on'}" style="${TAG_COLORS.includes(tcColor) ? '' : 'background:' + tcColor}" aria-label="لون مخصص">${ic('check')}<input type="color" id="tcCustom" value="${tcColor}"></label>`;
  const p = $('tcPrev'); p.firstElementChild.style.background = tcColor;
  p.lastElementChild.textContent = $('tcName').value.trim() || 'اسم الوسم';
}
function openTagCreate(id){
  const t = typeof id === 'string' ? tags.find(x => x.id === id) : null;
  tcEditId = t ? t.id : null;
  $('tcTitle').textContent = t ? 'تعديل الوسم' : 'إنشاء وسم';
  $('tcOk').textContent = t ? 'حفظ' : 'إنشاء';
  tcColor = t ? t.color : TAG_COLORS[tags.length % TAG_COLORS.length];
  $('tcName').value = t ? t.name : ''; $('tcDesc').value = t?.desc || ''; tcPaint(); $('tcOv').classList.add('show');
  setTimeout(() => $('tcName').focus(), 60);
}
function tcSave(){
  const name = $('tcName').value.trim().replace(/\s+/g, ' ');
  if (!name){ toast('اكتب اسم الوسم'); $('tcName').focus(); return; }
  if (tags.some(t => t.id !== tcEditId && t.name.toLowerCase() === name.toLowerCase())){ toast('هذا الوسم موجود مسبقًا'); return; }
  if (tcEditId) updateTag(tcEditId, name, tcColor, $('tcDesc').value); else addTag(name, tcColor, $('tcDesc').value);
  $('tcOv').classList.remove('show'); afterTagChange(); toast(tcEditId ? 'تم حفظ التعديل' : 'تم إنشاء الوسم');
}
$('tcColors').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; tcColor = b.dataset.c; tcPaint(); });
$('tcColors').addEventListener('input', e => { if (e.target.id === 'tcCustom'){ tcColor = e.target.value; const l = e.target.parentElement; l.classList.add('on'); l.style.background = tcColor; $('tcColors').querySelectorAll('[data-c]').forEach(x => x.classList.remove('on')); $('tcPrev').firstElementChild.style.background = tcColor; } });
$('tcName').addEventListener('input', tcPaint);
$('tcName').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); tcSave(); } });
$('tcOk').addEventListener('click', tcSave);
