/* QUARK AI — الصور: حفظها (ملفات في بايثون، أو IndexedDB عند غياب الخادم) ومعالجتها */
'use strict';

/* ================= الصور (ملفات على الخادم + معالجة) ================= */
const IMG_MAX = 8, imgCache = new Map();
/* مع الخادم: ملف لكل صورة في مجلد البيانات. بدونه: IndexedDB كما كان. الواجهة واحدة (put/get/del/keys). */
const imgDB = QuarkKV.server ? QuarkKV.files : (() => {
  let p = null;
  const open = () => p || (p = new Promise((res, rej) => {
    try{
      const r = indexedDB.open('quark-ai-img', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('imgs');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }catch(e){ rej(e); }
  }));
  const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const tx = db.transaction('imgs', mode), rq = fn(tx.objectStore('imgs'));
    tx.oncomplete = () => res(rq && rq.result); tx.onerror = tx.onabort = () => rej(tx.error);
  }));
  return { put:(k, v) => run('readwrite', s => s.put(v, k)), get:k => run('readonly', s => s.get(k)),
    del:k => run('readwrite', s => s.delete(k)), keys:() => run('readonly', s => s.getAllKeys()) };
})();
async function imgSave(i){ imgCache.set(i.id, i.data); try{ await imgDB.put(i.id, i.data); }catch{} }
async function imgData(id){
  if (imgCache.has(id)) return imgCache.get(id);
  try{ const v = await imgDB.get(id); if (v){ imgCache.set(id, v); return v; } }catch{}
  return null;
}
function eachMsg(c, fn){
  const seen = new Set();
  const walk = arr => arr.forEach(m => { if (!m || seen.has(m)) return; seen.add(m); fn(m); (m.vers || []).forEach(v => v && walk(v)); });
  walk(c.messages);
}
async function ensureImgs(c){
  const ids = []; c.messages.forEach(m => (m.imgs || []).forEach(i => ids.push(i.id)));
  await Promise.all(ids.map(imgData));
}
async function gcImgs(){
  try{
    const keys = await imgDB.keys(), used = new Set();
    chats.forEach(c => eachMsg(c, m => { (m.imgs || []).forEach(i => used.add(i.id)); (m.gen || []).forEach(i => i.id && used.add(i.id)); }));
    for (const k of keys) if (!used.has(k)){ await imgDB.del(k); imgCache.delete(k); }
  }catch{}
}
let gcT = 0;
function queueGc(){ clearTimeout(gcT); gcT = setTimeout(gcImgs, 4000); }
function hydrateImgs(root){
  root.querySelectorAll('img[data-iid]').forEach(im => {
    const id = im.dataset.iid, d = imgCache.get(id);
    if (d){ im.src = d; return; }
    imgData(id).then(v => { if (v) im.src = v; else im.classList.add('gone'); });
  });
}
function processImage(file){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const MAX = 1568, k = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const data = c.toDataURL('image/jpeg', .85); res({ data, w, h, size:Math.round(data.length * .75) });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
    img.src = url;
  });
}
async function addImages(files){
  for (const f of [...files].filter(f => f.type.startsWith('image/'))){
    if (pending.filter(p => p.kind === 'image').length >= IMG_MAX){ toast(`الحد الأقصى ${IMG_MAX} صور في الرسالة`); break; }
    if (f.size > 25 * 1024 * 1024){ toast(`الصورة ${f.name} كبيرة جدًا`); continue; }
    try{ const o = await processImage(f); pending.push({ kind:'image', id:uid(), name:f.name || 'photo.jpg', mime:'image/jpeg', ...o }); }
    catch{ toast(`تعذّر قراءة الصورة ${f.name || ''}`); }
  }
  renderPending(); el.input.focus();
}
function restorePending(u){
  el.input.value = u.content;
  pending = [...(u.files || []).map(f => ({ ...f })), ...(u.imgs || []).map(i => ({ kind:'image', ...i, data:imgCache.get(i.id) })).filter(i => i.data)];
  renderPending(); autosize(); updateSendState();
}
