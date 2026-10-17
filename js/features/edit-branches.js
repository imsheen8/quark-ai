/* QUARK AI — تعديل الرسالة وتفريع المحادثة */
'use strict';

/* ================= تعديل الرسالة وتفريع المحادثة ================= */
/* كل رسالة مستخدم لها m.vers (نُسخ الذيل من هذه الرسالة فصاعدًا) و m.vi (النسخة الحالية، وخانتها null لأنها هي c.messages) */
const editFrom = new WeakMap();
function startEdit(node){
  if (busy){ toast('انتظر انتهاء الرد الحالي'); return; }
  if (node.classList.contains('editing')) return;
  const m = node._m;
  node.classList.add('editing');
  const box = document.createElement('div'); box.className = 'edit-box';
  box.innerHTML = '<textarea class="edit-ta" dir="auto" rows="1"></textarea><div class="edit-row"><button type="button" class="edit-btn pri" data-esave>حفظ وإرسال</button><button type="button" class="edit-btn" data-ecancel>إلغاء</button></div>';
  const ta = box.querySelector('textarea'); ta.value = m.content || '';
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, innerHeight * .42) + 'px'; };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape'){ e.preventDefault(); cancelEdit(node); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); saveEdit(node); }
  });
  node.classList.remove('tools-on');
  node.insertBefore(box, node.querySelector('.u-tools'));
  fit(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}
function cancelEdit(node){
  node.classList.remove('editing');
  node.querySelector('.edit-box')?.remove();
}
async function saveEdit(node){
  if (busy){ toast('انتظر انتهاء الرد الحالي'); return; }
  const m = node._m, text = node.querySelector('.edit-ta').value.trim();
  if (!text && !(m.files && m.files.length) && !(m.imgs && m.imgs.length)){ toast('الرسالة فارغة'); return; }
  if (text === (m.content || '').trim()){ cancelEdit(node); return; }
  const am = activeModel();
  if (!am){ toast('أضف نقطة اتصال واختر نموذجًا أولًا'); openSettings(); return; }
  if (am.ep.kind !== 'local' && !am.ep.key){ toast('أدخل مفتاح API أولًا'); openSettings(); return; }
  if (!cmpReady()) return;
  const c = current(); if (!c) return;
  const i = c.messages.indexOf(m); if (i < 0) return;
  const live = c.messages.splice(i);
  const vers = m.vers || [null], vi = m.vers ? m.vi : 0;
  delete m.vers; delete m.vi;
  vers[vi] = live;
  const um = { role:'user', content:text };
  if (m.files && m.files.length) um.files = m.files.map(f => ({ ...f }));
  if (m.imgs && m.imgs.length) um.imgs = m.imgs.map(i => ({ ...i }));
  vers.push(null); um.vers = vers; um.vi = vers.length - 1;
  editFrom.set(um, vi);
  c.messages.push(um); c.ts = Date.now(); save(); renderMessages(); renderList();
  await runGen(c);
}
function undoEdit(c, u){            // عند إيقاف التوليد قبل وصول أي رد: ارجع للنسخة السابقة
  const vers = u.vers, from = editFrom.get(u);
  vers.pop();
  const t = vers[from]; vers[from] = null;
  if (vers.length > 1){ t[0].vers = vers; t[0].vi = from; }
  c.messages.push(...t);
}
function switchVer(node, d){
  if (busy){ toast('انتظر انتهاء الرد الحالي'); return; }
  const c = current(); if (!c) return;
  const m = node._m, i = c.messages.indexOf(m), vers = m.vers, j = m.vi + d;
  if (i < 0 || !vers || j < 0 || j >= vers.length) return;
  const live = c.messages.splice(i), vi = m.vi;
  delete m.vers; delete m.vi;
  vers[vi] = live;
  const t = vers[j]; vers[j] = null; t[0].vers = vers; t[0].vi = j;
  c.messages.push(...t);
  save(); renderMessages();
  el.messages.children[i]?.scrollIntoView({ block:'start' });
}

async function regenerate(){
  if (busy) return;
  const c = current(); if (!c) return;
  const lastA = c.messages[c.messages.length - 1];
  let pair = null;
  if (lastA && lastA.cmp){
    pair = lastA.cmp.map(x => { const ep = epOf(x.ep); return ep && ep.enabled ? { ep, model:x.model } : null; });
    if (pair.some(p => !p)) pair = null;
  }
  if (!pair && !cmpReady()) return;
  while (c.messages.length && c.messages[c.messages.length - 1].role === 'assistant') c.messages.pop();
  if (!c.messages.length) return;
  save(); renderMessages(); await runGen(c, pair);
}

