/* QUARK AI — البحث والشريط الجانبي والأحداث العامة */
'use strict';

/* ================= البحث ================= */
const searchWrap = $('searchWrap'), searchBtn = $('searchBtn'), searchLine = $('searchLine');
function setSearch(open){
  searchWrap.classList.toggle('open', open);
  if (open) setTimeout(() => el.chatSearch.focus(), 120);
  else { el.chatSearch.value = ''; query = ''; searchLine.classList.remove('has'); renderList(); }
}
searchBtn.addEventListener('click', () => setSearch(!searchWrap.classList.contains('open')));
$('searchClear').addEventListener('click', () => { el.chatSearch.value = ''; query = ''; searchLine.classList.remove('has'); renderList(); el.chatSearch.focus(); });
el.chatSearch.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.stopPropagation(); setSearch(false); } });
el.chatSearch.addEventListener('input', () => {
  query = el.chatSearch.value; searchLine.classList.toggle('has', !!query); renderList();
});

/* ================= أحداث عامة ================= */
const isMobile = () => matchMedia('(max-width:860px)').matches;
const closeDrawer = () => { el.sidebar.classList.remove('open'); el.backdrop.classList.remove('show'); };
$('toggleSidebar').addEventListener('click', () => {
  if (isMobile()){ el.sidebar.classList.add('open'); el.backdrop.classList.add('show'); }
  else el.app.classList.toggle('collapsed');
});
el.backdrop.addEventListener('click', closeDrawer);
$('newChat').addEventListener('click', newChat);
$('topNew').addEventListener('click', newChat);
$('topIncog').addEventListener('click', () => {
  if (busy) return;
  incog = !incog; renderMessages();
  
});

