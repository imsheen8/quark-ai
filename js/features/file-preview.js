/* QUARK AI — معاينة الملف المرفق */
'use strict';

/* معاينة الملف */
$('tkClose').addEventListener('click', closeThink);
$('tkOv').addEventListener('click', e => { if (e.target === $('tkOv')) closeThink(); });
$('tkBody').addEventListener('click', e => {
  const it = e.target.closest('.tl-item.has'); if (!it) return;
  const i = +it.dataset.i; thinkSheet.open.has(i) ? thinkSheet.open.delete(i) : thinkSheet.open.add(i);
  it.classList.toggle('open', thinkSheet.open.has(i));
});
let fvCtx = null;
function openFile(f, onDelete){
  fvCtx = { f, onDelete };
  $('fvTitle').innerHTML = ic('file') + '<span>' + esc(f.name) + '</span>';
  $('fvBody').textContent = f.text;
  $('fvDel').hidden = !onDelete;
  $('fvOv').classList.add('show');
}
const closeFile = () => { $('fvOv').classList.remove('show'); fvCtx = null; };
$('fvClose').addEventListener('click', closeFile);
$('fvOv').addEventListener('click', e => { if (e.target === $('fvOv')) closeFile(); });
$('fvCopy').addEventListener('click', async () => { if (fvCtx) toast(await copyText(fvCtx.f.text) ? 'تم نسخ المحتوى' : 'تعذّر النسخ'); });
$('fvDel').addEventListener('click', () => { const c = fvCtx; closeFile(); c?.onDelete?.(); });
$('attRow').addEventListener('click', e => {
  const rm = e.target.closest('[data-frm]');
  if (rm){ e.stopPropagation(); pending.splice(+rm.dataset.frm, 1); renderPending(); return; }
  const ch = e.target.closest('[data-fi]'); if (!ch) return;
  const f = pending[+ch.dataset.fi]; if (!f) return;
  if (f.kind === 'image'){ openImg(f.data); return; }
  openFile(f, () => { const i = pending.indexOf(f); if (i > -1){ pending.splice(i, 1); renderPending(); toast('تم حذف الملف'); } });
});
el.messages.addEventListener('click', e => {
  const ch = e.target.closest('.att-chip[data-fi]'); if (!ch) return;
  const f = ch.closest('.msg')?._m?.files?.[+ch.dataset.fi]; if (f) openFile(f, null);
});

function autosize(){ el.input.style.height = 'auto'; el.input.style.height = Math.min(el.input.scrollHeight, 200) + 'px'; window.__slashRefresh?.(); }
