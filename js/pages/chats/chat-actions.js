/* QUARK AI — إجراءات المحادثات (مفضلة، إعادة تسمية) */
'use strict';

/* ================= إجراءات المحادثات ================= */
function toggleFav(id){
  const c = chats.find(x => x.id === id); if (!c) return;
  if (c.fav) delete c.fav; else c.fav = true;
  save(); renderList(); renderChats(); toast(c.fav ? 'أُضيفت للمفضلة' : 'أُزيلت من المفضلة');
}
function renameChat(id){
  const c = chats.find(x => x.id === id); if (!c) return;
  window.__dlg('إعادة تسمية', `<label class="lib-f">الاسم الجديد<input type="text" id="lbRn" value="${esc(c.title)}" maxlength="80"></label>`, () => {
    const n = $('lbRn').value.trim(); if (!n) return;
    c.title = n; c.autoTitle = false; save(); renderList(); renderChats();
    if (c.id === currentId) el.title.textContent = n;
    toast('تمت إعادة التسمية');
  });
}

