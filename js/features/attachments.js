/* QUARK AI — إرفاق الملفات */
'use strict';

/* إرفاق ملفات نصية */
const attachPop = $('attachPop');
const addSheet = attachPop.querySelector('.add-sheet'), sheetBody = addSheet.querySelector('.sheet-body');

/* ===== سحب ورقة الإضافة: لأعلى = توسيع، لأسفل = تصغير ثم إغلاق، والمحتوى قابل للتمرير ===== */
const sh = { drag:false, moved:false, expanded:false, y0:0, h0:0, minH:0, maxH:0, dy:0, last:0, lastT:0, v:0, src:'' };
function resetSheet(){
  sh.expanded = false; sh.drag = false;
  addSheet.classList.remove('expanded','snap','dragging');
  addSheet.style.height = addSheet.style.transform = ''; attachPop.style.background = '';
}
function naturalH(){                       /* ارتفاع الورقة المصغّرة (حسب المحتوى حتى 74dvh) */
  const h = addSheet.style.height, e = addSheet.classList.contains('expanded');
  addSheet.style.height = ''; addSheet.classList.remove('expanded');
  const n = addSheet.offsetHeight;
  addSheet.style.height = h; if (e) addSheet.classList.add('expanded');
  return n;
}
function sheetFade(){
  const b = sheetBody, t = b.scrollTop, mx = b.scrollHeight - b.clientHeight;
  b.style.setProperty('--ft', t > 4 ? '22px' : '0px');
  b.style.setProperty('--fb', mx - t > 4 ? '30px' : '0px');
}
sheetBody.addEventListener('scroll', sheetFade, { passive:true });
new MutationObserver(() => requestAnimationFrame(sheetFade)).observe(sheetBody, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden'] });
new MutationObserver(() => { if (attachPop.classList.contains('show')) requestAnimationFrame(sheetFade); else if (sh.expanded || addSheet.style.height) resetSheet(); }).observe(attachPop, { attributes:true, attributeFilter:['class'] });
addEventListener('resize', sheetFade);

function sheetStart(y, src){
  sh.drag = true; sh.moved = false; sh.src = src; sh.y0 = y; sh.last = y; sh.lastT = performance.now(); sh.v = 0;
  sh.h0 = addSheet.offsetHeight; sh.minH = sh.expanded ? naturalH() : sh.h0;
  sh.maxH = Math.round(innerHeight * .94);
  if (sh.maxH < sh.minH) sh.maxH = sh.minH;
}
function sheetMove(y){
  const dy = y - sh.y0, now = performance.now();
  if (!sh.moved && Math.abs(dy) < 6) return false;
  if (!sh.moved){ sh.moved = true; addSheet.classList.remove('snap'); addSheet.classList.add('dragging', 'expanded'); }
  sh.v = (y - sh.last) / Math.max(1, now - sh.lastT); sh.last = y; sh.lastT = now;
  let h = sh.h0 - dy, ty = 0;
  if (h > sh.maxH) h = sh.maxH + (h - sh.maxH) * .15;       /* مقاومة عند أعلى حد */
  if (h < sh.minH){ ty = sh.minH - h; h = sh.minH; }          /* ما دون الحد الأدنى = تحريك للأسفل */
  addSheet.style.height = h + 'px'; addSheet.style.transform = ty ? `translateY(${ty}px)` : '';
  sh.dy = ty;
  attachPop.style.background = `rgba(0,0,0,${.5 * Math.max(0, 1 - ty / (sh.minH * .9))})`;
  return true;
}
function sheetEnd(){
  if (!sh.drag) return; sh.drag = false;
  if (!sh.moved) return;
  setTimeout(() => { sh.moved = false; }, 400);
  addSheet.classList.remove('dragging'); addSheet.classList.add('snap');
  const h = parseFloat(addSheet.style.height) || sh.h0, v = sh.v;     /* v>0 = لأسفل (px/ms) */
  const close = sh.dy > sh.minH * .28 || (sh.dy > 12 && v > .6) || (sh.dy > 0 && !sh.expanded && v > .35);
  if (close){
    addSheet.style.transform = 'translateY(100%)'; attachPop.style.background = 'rgba(0,0,0,0)';
    setTimeout(closeAttach, 220); return;
  }
  const mid = (sh.minH + sh.maxH) / 2;
  const up = v < -.35 || (Math.abs(v) <= .35 && h > mid);
  const dn = v > .35;
  sh.expanded = up && !dn && sh.maxH > sh.minH + 24;
  addSheet.style.transform = ''; attachPop.style.background = '';
  if (sh.expanded){ addSheet.style.height = sh.maxH + 'px'; }
  else { addSheet.style.height = sh.minH + 'px'; setTimeout(() => { if (!sh.expanded && !sh.drag){ addSheet.style.height = ''; addSheet.classList.remove('expanded'); } }, 300); }
  setTimeout(() => addSheet.classList.remove('snap'), 320);
  sheetBody.scrollTop = Math.min(sheetBody.scrollTop, sheetBody.scrollHeight);
  setTimeout(sheetFade, 330);
}
/* مقبض + رأس الورقة (مؤشر) */
const dragZone = [addSheet.querySelector('.sheet-handle'), addSheet.querySelector('.sheet-head')];
dragZone.forEach(z => {
  z.addEventListener('pointerdown', e => { if (e.button > 0) return; sheetStart(e.clientY, 'bar'); z.__pid = e.pointerId; });
  z.addEventListener('pointermove', e => {
    if (!sh.drag || sh.src !== 'bar') return;
    if (sheetMove(e.clientY) && !z.hasPointerCapture(e.pointerId)) { try { z.setPointerCapture(e.pointerId); } catch (_) {} }
  });
  ['pointerup', 'pointercancel'].forEach(t => z.addEventListener(t, () => { if (sh.src === 'bar') sheetEnd(); }));
});
/* جسم الورقة (لمس): السحب لأسفل من أعلى القائمة يغلق/يصغّر، والسحب لأعلى يوسّع قبل أن يبدأ التمرير */
let bodyMode = '';
sheetBody.addEventListener('touchstart', e => {
  bodyMode = ''; sheetStart(e.touches[0].clientY, 'body');
}, { passive:true });
sheetBody.addEventListener('touchmove', e => {
  if (!sh.drag || sh.src !== 'body') return;
  const y = e.touches[0].clientY, dy = y - sh.y0;
  if (!bodyMode){
    if (Math.abs(dy) < 6) return;
    const atTop = sheetBody.scrollTop <= 0, canGrow = !sh.expanded && sh.maxH > sh.minH + 24;
    bodyMode = (dy > 0 && atTop) || (dy < 0 && canGrow) ? 'sheet' : 'scroll';
    if (bodyMode === 'sheet'){ sh.y0 = y; sh.last = y; }       /* ابدأ من هنا بلا قفزة */
  }
  if (bodyMode === 'sheet'){ e.preventDefault(); sheetMove(y); }
}, { passive:false });
['touchend', 'touchcancel'].forEach(t => sheetBody.addEventListener(t, () => { if (sh.src === 'body'){ if (bodyMode === 'sheet') sheetEnd(); else sh.drag = false; bodyMode = ''; } }));
/* لا تُفعّل النقرة بعد سحب */
attachPop.addEventListener('click', e => { if (sh.moved){ e.stopPropagation(); e.preventDefault(); sh.moved = false; } }, true);

function closeAttach(){ attachPop.classList.remove('show'); resetSheet(); }
function showAttach(v){
  attachView = v;
  $('attachMain').hidden = v !== 'main'; $('attachTpl').hidden = v !== 'tpl'; $('attachModel').hidden = v !== 'model';
  const fine = !matchMedia('(pointer:coarse)').matches;
  if (v === 'tpl'){ $('tplSearch').value = ''; renderTpls(); if (fine) setTimeout(() => $('tplSearch').focus(), 40); }
  if (v === 'model'){
    $('modelSearch').value = ''; $('amModelTitle').textContent = popTarget === 'B' ? 'النموذج الثاني' : 'اختيار النموذج';
    renderPop(); if (fine) setTimeout(() => $('modelSearch').focus(), 40);
  }
}
function renderTpls(){
  const nf = x => String(x).replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
  const all = window.__libTemplates?.() || [], q = nf($('tplSearch').value.trim()), box = $('tplList');
  const list = q ? all.filter(t => nf(t.name).includes(q) || nf(t.text).includes(q)) : all;
  box.innerHTML = list.length ? '' : `<div class="pop-empty">${all.length ? 'لا نتائج مطابقة' : 'لا توجد قوالب — أضف من المكتبة'}</div>`;
  list.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'am-row tpl';
    b.innerHTML = `<span class="tx"><b>${esc(t.name)}</b><small>${esc(t.text.replace(/\s+/g, ' ').trim())}</small></span>`;
    b.addEventListener('click', () => {
      closeAttach();
      fillTemplate(t.text, t.name, txt => {
        el.input.value = el.input.value.trim() ? el.input.value.replace(/\s+$/, '') + '\n' + txt : txt;
        autosize(); updateSendState(); el.input.focus();
        el.input.setSelectionRange(el.input.value.length, el.input.value.length);
      });
    });
    box.appendChild(b);
  });
}
$('tplSearch').addEventListener('input', renderTpls);
$('attachBtn').addEventListener('click', e => {
  e.stopPropagation();
  closePop(); showAttach('main'); attachPop.classList.add('show');
});
attachPop.addEventListener('click', e => {
  e.stopPropagation();
  if (e.target === attachPop || e.target.closest('#amX')){ closeAttach(); return; }
  const b = e.target.closest('[data-am]'); if (!b) return;
  const a = b.dataset.am;
  if (a === 'cam'){ closeAttach(); openCamera(); }
  else if (a === 'photo'){ closeAttach(); $('imgInput').click(); }
  else if (a === 'file'){ closeAttach(); $('fileInput').click(); }
  else if (a === 'mic'){ closeAttach(); voiceToggle(); }
  else if (a === 'cmp'){ closeAttach(); toggleCompare(); }
  else if (a === 'tpl') showAttach('tpl');
  else if (a === 'model' || a === 'modelB'){ popTarget = a === 'modelB' ? 'B' : 'A'; showAttach('model'); }
  else if (a === 'back') showAttach('main');
});
document.addEventListener('click', closeAttach);
function renderPending(){
  $('attRow').innerHTML = pending.map((f, i) => chipHTML(f, i, true)).join('');
  updateSendState();
}
async function addFiles(list){
  const imgs = list.filter(f => f.type.startsWith('image/'));
  if (imgs.length) await addImages(imgs);
  for (const f of list.filter(f => !f.type.startsWith('image/'))){
    if (f.size > 300 * 1024){ toast(`الملف ${f.name} كبير (الحد 300KB)`); continue; }
    const t = await f.text();
    if (t.includes('\u0000')){ toast(`الملف ${f.name} ليس نصيًا`); continue; }
    pending.push({ name:f.name, ext:(f.name.split('.').pop() || '').toLowerCase(), text:t, size:f.size });
  }
  renderPending(); el.input.focus();
}
$('fileInput').addEventListener('change', async e => { const fs = [...e.target.files]; e.target.value = ''; await addFiles(fs); });
$('imgInput').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; addImages(fs); });
$('camInput').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; addImages(fs); });

