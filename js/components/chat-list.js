/* QUARK AI — قائمة المحادثات في الشريط الجانبي والتصفية */
'use strict';

const FILTERS = [
  { k:'recent', label:'الأخيرة',        icon:'message' },
  { k:'today',  label:'اليوم',          icon:'clock' },
  { k:'week',   label:'هذا الأسبوع',    icon:'calendar' },
  { k:'month',  label:'هذا الشهر',      icon:'calendar' },
  { k:'fav',    label:'المفضلة',        icon:'lib-star' },
];
let filterView = 'main';
let chatFilter = store.get('ai_chat_filter', 'recent');
if (!(FILTERS.some(f => f.k === chatFilter) || (chatFilter.startsWith('tag:') && tags.some(t => t.id === chatFilter.slice(4))))) chatFilter = 'recent';
function passFilter(c){
  if (chatFilter === 'recent') return true;
  if (chatFilter === 'fav') return !!c.fav;
  if (chatFilter.startsWith('tag:')) return !!c.tags?.includes(chatFilter.slice(4));
  const now = new Date(), ts = c.ts || 0;
  if (chatFilter === 'today'){ const d = new Date(now); d.setHours(0,0,0,0); return ts >= d.getTime(); }
  if (chatFilter === 'week') return ts >= now.getTime() - 7 * 864e5;
  if (chatFilter === 'month') return ts >= now.getTime() - 30 * 864e5;
  return true;
}
function filterLabel(){
  if (chatFilter.startsWith('tag:')) return 'وسم: ' + (tags.find(t => t.id === chatFilter.slice(4))?.name || '');
  return FILTERS.find(x => x.k === chatFilter).label;
}
function paintFilter(){
  $('recentsLabel').textContent = filterLabel();
  $('filterBtn').classList.toggle('on', chatFilter !== 'recent');
  const m = $('filterMenu');
  if (filterView === 'tags'){
    m.innerHTML = `<button data-back>${ic('lib-back')} <span>الوسوم</span></button>` + (tags.length
      ? tags.map(t => {
          const on = chatFilter === 'tag:' + t.id, n = chats.filter(c => c.tags?.includes(t.id)).length;
          return `<button data-tag="${t.id}" class="${on ? 'sel' : ''}"><i class="tg-dot" style="background:${t.color}"></i><span>${esc(t.name)}</span><small class="cnt">${n}</small>${on ? ic('check', 'ck') : ''}</button>`;
        }).join('')
      : `<div class="pop-empty">لا توجد وسوم بعد</div><button data-manage>${ic('tag-plus')} <span>إضافة وسم</span></button>`);
  } else {
    m.innerHTML = `<button data-f="all">${ic('lib-list')} <span>الكل</span>${ic('chevron-left', 'go')}</button>` + FILTERS.map(x =>
      `<button data-f="${x.k}" class="${x.k === chatFilter ? 'sel' : ''}">${ic(x.icon)} <span>${x.label}</span>${x.k === chatFilter ? ic('check', 'ck') : ''}</button>`).join('') +
      `<button data-f="tags" class="${chatFilter.startsWith('tag:') ? 'sel' : ''}">${ic('tag')} <span>الوسوم</span>${ic('chevron-left', 'go')}</button>`;
  }
}
function renderList(){
  el.chatList.innerHTML = '';
  const q = query.trim().toLowerCase();
  const list = [...chats].filter(c => !c.temp).sort((a,b) => (b.ts||0) - (a.ts||0))
    .filter(passFilter)
    .filter(c => !q || c.title.toLowerCase().includes(q) || c.messages.some(m => m.content.toLowerCase().includes(q)));
  if (!list.length){
    el.chatList.innerHTML = `<div class="empty-list">${q ? 'لا نتائج مطابقة' : chatFilter === 'recent' ? 'لا توجد محادثات بعد' : chatFilter === 'fav' ? 'لا توجد محادثات مفضلة' : chatFilter.startsWith('tag:') ? 'لا توجد محادثات بهذا الوسم' : 'لا توجد محادثات في هذه الفترة'}</div>`;
    return;
  }
  const LIMIT = 7;
  const shown = (q || showAll) ? list : list.slice(0, LIMIT);
  shown.forEach(c => {
    const d = document.createElement('div');
    d.className = 'chat-item' + (c.id === currentId ? ' active' : '');
    d.innerHTML = `${ic('message')}<span>${esc(c.title)}</span>${tagDots(c)}<button class="more" title="المزيد" aria-label="المزيد">${ic('more')}</button>`;
    d.addEventListener('click', e => {
      const mb = e.target.closest('.more');
      if (mb){ e.stopPropagation(); openMenu(ctx, mb, c.id); return; }
      const go = () => { currentId = c.id; save(); renderAll(); closeDrawer(); };
      if (busy){ interruptGen().then(go); return; }
      go();
    });
    el.chatList.appendChild(d);
  });
  if (!q && list.length > LIMIT){
    const b = document.createElement('button');
    b.className = 'view-all' + (showAll ? ' open' : '');
    b.innerHTML = `${showAll ? 'عرض أقل' : 'عرض الكل'} ${ic('chevron-left')}`;
    b.addEventListener('click', () => { showAll = !showAll; renderList(); });
    el.chatList.appendChild(b);
  }
}

