/* QUARK AI — صفحة المحادثات */
'use strict';

/* ----- صفحة المحادثات ----- */
let chTab = 'all', chQuery = '', chMulti = false;
const chSel = new Set();
const chatsAll = () => [...chats].filter(c => !c.temp).sort((a, b) => (b.ts || 0) - (a.ts || 0));
function chVisible(){
  let a = chatsAll();
  if (chTab === 'fav') a = a.filter(c => c.fav);
  else if (chTab.startsWith('tag:')) a = a.filter(c => c.tags?.includes(chTab.slice(4)));
  if (chQuery) a = a.filter(c => (c.title + ' ' + c.messages.map(m => m.content).join(' ')).toLowerCase().includes(chQuery));
  return a;
}
function chCard(c){
  const tg = tagsOf(c), last = c.messages[c.messages.length - 1];
  const prev = (last?.content || '').replace(/\s+/g, ' ').trim().slice(0, 220) || 'محادثة فارغة';
  const chips = tg.length ? `<span class="tg-chips">${tg.slice(0, 3).map(t => `<span class="lib-badge tgb"><i class="tg-dot" style="background:${t.color}"></i>${esc(t.name)}</span>`).join('')}${tg.length > 3 ? `<span class="lib-badge">+${tg.length - 3}</span>` : ''}</span>` : '';
  const star = c.fav ? '<span class="lib-star"><svg class="i" style="fill:currentColor;width:16px;height:16px" aria-hidden="true"><use href="#i-lib-star"/></svg></span>' : '';
  const items = `<button data-a="open">${ic('message')}فتح</button><button data-a="rename">${ic('lib-edit')}إعادة تسمية</button><button data-a="fav">${ic('lib-star')}${c.fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}</button><button data-a="tag">${ic('tag')}إضافة وسم</button><button data-a="export">${ic('download')}تصدير</button><button class="d" data-a="del">${ic('trash')}حذف</button>`;
  const date = new Date(c.ts || Date.now()).toLocaleDateString('ar', { day:'numeric', month:'short' });
  return `<div class="lib-card ${chSel.has(c.id) ? 'sel' : ''}" data-id="${c.id}">
    <div class="lib-row"><span class="lib-chk">${ic('check')}</span>${chips}${star}
      <div class="lib-menu" ${c.fav ? '' : 'style="margin-inline-start:auto"'}><button class="lib-ib" data-a="menu" aria-label="المزيد" style="width:34px;height:34px">${ic('more')}</button><div class="lib-pop">${items}</div></div></div>
    <h3>${esc(c.title)}</h3><p>${esc(prev)}</p>
    <div class="lib-foot"><span class="meta">${c.messages.length} رسالة · ${date}</span><button class="lib-btn" data-a="open" style="height:34px">فتح</button></div></div>`;
}
function paintChTagBtn(){
  const t = chTab.startsWith('tag:') ? tags.find(x => x.id === chTab.slice(4)) : null, b = $('chTagBtn');
  b.classList.toggle('on', !!t);
  b.title = t ? 'الوسم: ' + t.name : 'الوسوم';
  b.style.setProperty('--tgc', t ? t.color : 'transparent');
}
function paintChTagMenu(){
  const all = chatsAll(), m = $('chTagMenu');
  m.innerHTML = (chTab.startsWith('tag:') ? `<button data-ctag="">${ic('lib-list')} <span>كل المحادثات</span></button>` : '') +
    (tags.length ? tags.map(t => {
      const on = chTab === 'tag:' + t.id, n = all.filter(c => c.tags?.includes(t.id)).length;
      return `<div class="tg-mrow"><button data-ctag="${t.id}" class="${on ? 'sel' : ''}"><i class="tg-dot" style="background:${t.color}"></i><span class="tg-txt"><b>${esc(t.name)}</b>${t.desc ? `<em>${esc(t.desc)}</em>` : ''}</span><small class="cnt">${n}</small>${on ? ic('check', 'ck') : ''}</button><button class="tg-mi" data-cedit="${t.id}" aria-label="تعديل الوسم" title="تعديل">${ic('lib-edit')}</button><button class="tg-mi dng" data-cdel="${t.id}" aria-label="حذف الوسم" title="حذف">${ic('trash')}</button></div>`;
    }).join('') : `<div class="pop-empty">لا توجد وسوم بعد</div>`);
}
function renderChats(){
  if (!mainEl.classList.contains('ch-open')) return;
  const all = chatsAll();
  if (chTab.startsWith('tag:') && !tags.some(t => t.id === chTab.slice(4))) chTab = 'all';
  $('chTabs').innerHTML =
    `<button class="lib-tab ${chTab === 'all' ? 'on' : ''}" data-ct="all">الكل<small>${all.length}</small></button>` +
    `<button class="lib-tab ${chTab === 'fav' ? 'on' : ''}" data-ct="fav">المفضلة<small>${all.filter(c => c.fav).length}</small></button>`;
  paintChTagBtn();
  [...chSel].forEach(id => { if (!chats.some(c => c.id === id)) chSel.delete(id); });
  const v = chVisible();
  $('chView').classList.toggle('lib-sm', chMulti);
  $('chMulti').classList.toggle('on', chMulti);
  $('chBar').classList.toggle('show', chMulti);
  $('chAll').textContent = v.length && v.every(c => chSel.has(c.id)) ? 'إلغاء التحديد' : 'تحديد الكل';
  $('chTagSel').disabled = $('chDel').disabled = !chSel.size;
  $('chCnt').textContent = chSel.size ? chSel.size + ' محدد' : '';
  $('chGrid').innerHTML = v.length ? v.map(chCard).join('') : `<div class="lib-empty">${
    chQuery ? 'لا نتائج مطابقة' : !chats.length ? 'لا توجد محادثات بعد.<br>ابدأ محادثة جديدة من الشريط الجانبي.'
    : chTab === 'fav' ? 'لا توجد محادثات مفضلة.' : 'لا توجد محادثات بهذا الوسم.<br>أضف الوسم من قائمة ⋮ في أي محادثة.'}</div>`;
}
function openChats(){
  mainEl.classList.remove('lib-open', 'set-open', 'pf-open', 'md-open', 'vo-open'); mainEl.classList.add('ch-open');
  chMulti = false; chSel.clear(); renderChats(); closeDrawer(); $('chGrid').scrollTop = 0;
}
function openChatFromPage(id){
  if (busy){ toast('انتظر انتهاء الرد الحالي'); return; }
  currentId = id; save(); mainEl.classList.remove('ch-open'); renderAll();
}
$('chMenu').addEventListener('click', () => $('toggleSidebar').click());
$('chSearchBtn').addEventListener('click', () => {
  const s = $('chSearch'); s.classList.toggle('show');
  if (s.classList.contains('show')) $('chQ').focus(); else { chQuery = ''; $('chQ').value = ''; renderChats(); }
});
$('chQ').addEventListener('input', e => { chQuery = e.target.value.trim().toLowerCase(); renderChats(); });
$('chMulti').addEventListener('click', () => { chMulti = !chMulti; chSel.clear(); renderChats(); });
$('chAll').addEventListener('click', () => {
  const v = chVisible(), every = v.length && v.every(c => chSel.has(c.id));
  v.forEach(c => every ? chSel.delete(c.id) : chSel.add(c.id)); renderChats();
});
$('chTagBtn').addEventListener('click', e => { e.stopPropagation(); paintChTagMenu(); openMenu($('chTagMenu'), $('chTagBtn')); });
$('chTagAdd').addEventListener('click', openTagCreate);
$('chTagMenu').addEventListener('click', e => {
  e.stopPropagation();
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.cedit){ closeMenus(); openTagCreate(b.dataset.cedit); return; }
  if (b.dataset.cdel){
    const t = tags.find(x => x.id === b.dataset.cdel); closeMenus(); if (!t) return;
    qConfirm(`حذف الوسم «${t.name}»؟ سيُزال من كل المحادثات.`, { ok:'حذف' }).then(ok => {
      if (!ok) return; deleteTag(t.id); afterTagChange(); toast('تم حذف الوسم');
    });
    return;
  }
  if (!('ctag' in b.dataset)) return;
  chTab = b.dataset.ctag ? 'tag:' + b.dataset.ctag : 'all';
  closeMenus(); renderChats();
});
$('chTagSel').addEventListener('click', () => { if (chSel.size) openTagPicker([...chSel]); });
$('chDel').addEventListener('click', () => {
  if (!chSel.size) return;
  window.__dlg(`حذف ${chSel.size} محادثة؟`, '<p style="color:var(--text-2);line-height:1.8">لا يمكن التراجع عن الحذف.</p>', () => {
    if (busy && chSel.has(currentId)){ toast('انتظر انتهاء الرد الحالي'); return; }
    chats = chats.filter(c => !chSel.has(c.id));
    if (!chats.some(c => c.id === currentId)) currentId = null;
    chSel.clear(); chMulti = false; save(); renderList(); renderChats(); paintFilter(); toast('تم الحذف');
  }, true);
});
$('chTabs').addEventListener('click', e => { const b = e.target.closest('[data-ct]'); if (!b) return; chTab = b.dataset.ct; renderChats(); });
$('chGrid').addEventListener('click', e => {
  const card = e.target.closest('.lib-card'); if (!card) return;
  const id = card.dataset.id;
  if (chMulti){ chSel.has(id) ? chSel.delete(id) : chSel.add(id); renderChats(); return; }
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'menu'){
    const p = card.querySelector('.lib-pop'), was = p.classList.contains('show');
    document.querySelectorAll('#chGrid .lib-pop.show').forEach(x => x.classList.remove('show'));
    if (!was) p.classList.add('show'); return;
  }
  document.querySelectorAll('#chGrid .lib-pop.show').forEach(x => x.classList.remove('show'));
  const c = chats.find(x => x.id === id); if (!c) return;
  if (!a || a === 'open') openChatFromPage(id);
  else if (a === 'rename') renameChat(id);
  else if (a === 'fav') toggleFav(id);
  else if (a === 'tag') openTagPicker([id]);
  else if (a === 'export') exportChat(c);
  else if (a === 'del') window.__dlg('حذف «' + c.title + '»؟', '<p style="color:var(--text-2);line-height:1.8">لا يمكن التراجع عن الحذف.</p>', () => {
    if (busy && id === currentId){ toast('انتظر انتهاء الرد الحالي'); return; }
    deleteChat(id); renderChats(); toast('تم الحذف');
  }, true);
});
document.addEventListener('click', e => {
  if (!mainEl.classList.contains('ch-open') || e.target.closest('.lib-menu')) return;
  document.querySelectorAll('#chGrid .lib-pop.show').forEach(p => p.classList.remove('show'));
});

