/* QUARK AI — القوائم المنسدلة */
'use strict';

/* ================= القوائم المنسدلة ================= */
const ctx = $('ctxMenu'), topMenu = $('topMenu');
let menuEl = null, menuBtn = null, ctxId = null;
function closeMenus(){
  ctx.hidden = true; topMenu.hidden = true; $('filterMenu').hidden = true; $('chTagMenu').hidden = true; $('lbSortMenu').hidden = true;
  menuBtn?.classList.remove('open'); menuEl = null; menuBtn = null; ctxId = null;
}
function openMenu(menu, btn, id){
  if (menuEl === menu && menuBtn === btn){ closeMenus(); return; }
  closeMenus();
  menuEl = menu; menuBtn = btn; ctxId = id ?? null; btn.classList.add('open');
  if (menu === ctx) $('ctxFav').lastElementChild.textContent = chats.find(x => x.id === id)?.fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة';
  menu.hidden = false;
  const r = btn.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
}
