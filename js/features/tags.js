/* QUARK AI — الوسوم */
'use strict';

/* ================= عرض القائمة والرسائل ================= */
/* ----- الوسوم ----- */
const TAG_COLORS = ['#d97757','#4f9d69','#5b8def','#b66dd6','#d4a017','#e0527a','#2fa5a5','#8a7bd8'];
let tags = store.get('ai_tags', []).filter(t => t && t.id && t.name);
const saveTags = () => store.set('ai_tags', tags);
const tagsOf = c => (c.tags || []).map(id => tags.find(t => t.id === id)).filter(Boolean);
function addTag(name, color, desc){
  name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24); if (!name) return null;
  const ex = tags.find(t => t.name.toLowerCase() === name.toLowerCase()); if (ex) return ex;
  const t = { id:uid(), name, color:/^#[0-9a-f]{6}$/i.test(color || '') ? color : TAG_COLORS[tags.length % TAG_COLORS.length] };
  desc = String(desc || '').trim().replace(/\s+/g, ' ').slice(0, 120); if (desc) t.desc = desc;
  tags.push(t); saveTags(); return t;
}
function updateTag(id, name, color, desc){
  const t = tags.find(x => x.id === id); if (!t) return null;
  name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24); if (!name) return null;
  t.name = name;
  if (/^#[0-9a-f]{6}$/i.test(color || '')) t.color = color;
  desc = String(desc || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (desc) t.desc = desc; else delete t.desc;
  saveTags(); return t;
}
function setChatTag(ids, tagId, on){
  chats.filter(c => ids.includes(c.id)).forEach(c => {
    c.tags = c.tags || []; const i = c.tags.indexOf(tagId);
    if (on && i < 0) c.tags.push(tagId); if (!on && i > -1) c.tags.splice(i, 1);
    if (!c.tags.length) delete c.tags;
  });
  save();
}
function deleteTag(id){
  tags = tags.filter(t => t.id !== id); saveTags();
  chats.forEach(c => { if (c.tags){ c.tags = c.tags.filter(x => x !== id); if (!c.tags.length) delete c.tags; } });
  if (chatFilter === 'tag:' + id){ chatFilter = 'recent'; store.set('ai_chat_filter', chatFilter); }
  save();
}
const tagDots = c => { const tg = tagsOf(c).slice(0, 3); return tg.length ? `<span class="tg-dots">${tg.map(t => `<i style="background:${t.color}"></i>`).join('')}</span>` : ''; };
function afterTagChange(){ renderList(); paintFilter(); renderChats(); }

