/* QUARK AI — تصدير المحادثة (PDF / Markdown) */
'use strict';

/* ================= تصدير المحادثة (PDF / Markdown) ================= */
const safeName = t => String(t || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'chat';
function downloadBlob(blob, name){ return saveFile(blob, name); }
/* نص الرسالة للتصدير: يشمل الملفات المرفقة، وفي المقارنة بلا اختيار تُدرج الإجابتان */
function exportText(m){
  let t = fullContent(m);
  if (m.imgs && m.imgs.length) t = m.imgs.map(i => '[صورة: ' + i.name + ']').join('\n') + (t ? '\n\n' + t : '');
  if (!t.trim() && Array.isArray(m.cmp)) t = m.cmp.filter(x => x && x.content).map(x => `**${shortModel(x.model)}:**\n\n${x.content}`).join('\n\n');
  return t.trim();
}
const exportDate = () => new Date().toLocaleDateString('ar', { year:'numeric', month:'long', day:'numeric' });

/* ----- Markdown ----- */
function chatToMarkdown(c){
  /* الأكواد تبقى LTR داخل مستند RTL */
  const ltrCode = t => t.replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, b => `\n<div dir="ltr">\n\n${b}\n\n</div>\n`);
  const msgs = c.messages.map(m => ({ m, t: exportText(m) })).filter(x => x.t);
  const meta = ['QUARK AI', 'تاريخ التصدير: ' + exportDate(), msgs.length + ' رسالة'].join(' · ');
  const body = msgs.map(({ m, t }) => `**${m.role === 'user' ? 'أنت' : 'المساعد'}:**${m.error ? ' (خطأ)' : ''}\n\n${ltrCode(t)}`).join('\n\n---\n\n');
  return `<div dir="rtl" align="right">\n\n# ${c.title}\n\n> ${meta}\n\n---\n\n${body}\n\n</div>\n`;
}
function exportMarkdown(c){
  downloadBlob(new Blob([chatToMarkdown(c)], { type:'text/markdown;charset=utf-8' }), safeName(c.title) + '.md');
  toast('تم تصدير الملف');
}

/* ----- PDF: مستند RTL مستقل يُطبع/يُحفظ عبر المتصفح (يضمن وصل الحروف العربية وترتيب الاتجاهات) ----- */
const PRINT_CSS = `
@page{size:A4;margin:16mm 15mm 18mm;@bottom-center{content:counter(page);font:9pt "IBM Plex Sans Arabic",Tahoma,sans-serif;color:#8a867b}}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html{direction:rtl}
body{margin:0;font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,system-ui,sans-serif;font-size:11pt;line-height:1.9;color:#1f1e1c;background:#fff;text-align:start}
.page{max-width:820px;margin:0 auto;padding:28px 20px 60px}
.doc-h{padding-bottom:14px;margin-bottom:18px;border-bottom:2px solid #d97757}
.brand{font-weight:700;letter-spacing:.12em;font-size:10pt;color:#d97757;direction:ltr;text-align:start}
.doc-h h1{font-size:20pt;line-height:1.5;margin:6px 0 4px;font-weight:700}
.meta{font-size:9.5pt;color:#6b675d}
.m{margin:0 0 14px;padding:10px 14px 4px;border-radius:10px;border:1px solid #e2dfd4;border-inline-start:4px solid #b9b4a4}
.m.u{background:#f3f1ea;border-inline-start-color:#1f1e1c}
.m.a{background:#fff;border-inline-start-color:#d97757}
.m.err{border-inline-start-color:#e5484d;background:#fff5f5}
.who{font-weight:700;font-size:9.5pt;color:#55524b;margin-bottom:4px;break-after:avoid}
.bd>*:first-child{margin-top:0}
p{margin:0 0 .7em;overflow-wrap:anywhere}
h1,h2,h3{line-height:1.5;margin:1em 0 .4em;break-after:avoid}
h1{font-size:15pt}h2{font-size:13.5pt}h3{font-size:12pt}
ul,ol{margin:0 0 .8em;padding-inline-start:1.6em}
li{margin:.15em 0}
hr{border:0;border-top:1px solid #d6d2c4;margin:1em 0}
blockquote{margin:0 0 .8em;padding:.2em .9em;border-inline-start:3px solid #d97757;background:#faf6f2;color:#55524b}
a{color:#1d5fd1;text-decoration:none;overflow-wrap:anywhere}
code{font-family:"SF Mono",Consolas,Menlo,"Courier New",monospace;font-size:.88em;background:#ece9df;padding:1px 5px;border-radius:4px;direction:ltr;unicode-bidi:isolate}
.code{direction:ltr;text-align:left;margin:0 0 .9em;border:1px solid #d6d2c4;border-radius:8px;background:#f7f6f1;overflow:hidden}
.code-head{padding:3px 10px;font:600 8.5pt/1.7 Consolas,Menlo,monospace;color:#6b675d;background:#ece9df;border-bottom:1px solid #d6d2c4;direction:ltr;text-align:left;break-after:avoid}
.code pre{margin:0;padding:8px 12px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;direction:ltr;text-align:left;unicode-bidi:isolate}
.code pre code{background:none;padding:0;font-size:9pt;line-height:1.6;unicode-bidi:normal}
.tk-c{color:#7a8394;font-style:italic}.tk-s{color:#2f7d32}.tk-n{color:#c25b12}.tk-k{color:#8a3fc2}
.tbl-wrap{margin:0 0 .9em;overflow:visible}
table{border-collapse:collapse;width:100%;font-size:10pt}
th,td{border:1px solid #d6d2c4;padding:5px 9px;text-align:start;vertical-align:top}
th{background:#ece9df;font-weight:700}
thead{display:table-header-group}tr{break-inside:avoid}
.noprint{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 16px;background:#1f1e1c;color:#fff;font-size:13px;direction:rtl}
.noprint button{font:inherit;font-weight:600;background:#d97757;color:#fff;border:0;border-radius:10px;padding:8px 16px;cursor:pointer}
@media print{.noprint{display:none!important}.page{max-width:none;padding:0}body{font-size:10.5pt}}
`;
function chatToPrintHTML(c){
  const msgs = c.messages.map(m => ({ m, t: exportText(m) })).filter(x => x.t);
  const body = msgs.map(({ m, t }) => {
    const box = document.createElement('div');
    box.innerHTML = markdown(t);
    box.querySelectorAll('.ch-acts, [data-copy], [data-prev], [data-pexp]').forEach(n => n.remove());
    /* اتجاه تلقائي لكل فقرة: العربية RTL والإنجليزية LTR داخل المستند نفسه */
    box.querySelectorAll('p,li,h1,h2,h3,blockquote,th,td,ul,ol').forEach(n => n.setAttribute('dir', 'auto'));
    const user = m.role === 'user';
    return `<section class="m ${user ? 'u' : 'a'}${m.error ? ' err' : ''}"><div class="who">${user ? 'أنت' : 'المساعد'}${m.error ? ' · خطأ' : ''}</div><div class="bd">${box.innerHTML}</div></section>`;
  }).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(safeName(c.title))}</title>` +
    `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet"><style>${PRINT_CSS}</style></head><body>` +
    `<div class="noprint"><span>اختر «حفظ كـ PDF» من نافذة الطباعة</span><button onclick="window.print()">طباعة / حفظ PDF</button></div>` +
    `<div class="page"><header class="doc-h"><div class="brand">QUARK AI</div><h1 dir="auto">${esc(c.title)}</h1><div class="meta">${esc(exportDate())} · ${msgs.length} رسالة</div></header>${body}</div></body></html>`;
}
function exportPDF(c){
  const html = chatToPrintHTML(c);
  /* داخل التطبيق لا توجد نافذة طباعة: نشارك الصفحة كملف HTML ليُفتح في المتصفح ويُحفظ كـ PDF */
  if (window.__native){
    saveFile(new Blob([html], { type:'text/html;charset=utf-8' }), safeName(c.title) + '.html');
    toast('افتح الملف في المتصفح ثم اختر «طباعة ← حفظ كـ PDF»');
    return;
  }
  const printWhenReady = win => {
    const fonts = win.document.fonts && win.document.fonts.ready ? win.document.fonts.ready : Promise.resolve();
    Promise.race([fonts, new Promise(r => setTimeout(r, 2500))]).then(() => setTimeout(() => { try{ win.focus(); win.print(); }catch{} }, 150));
  };
  const w = window.open('', '_blank');
  if (w){
    w.document.open(); w.document.write(html); w.document.close();
    printWhenReady(w);
    toast('اختر «حفظ كـ PDF» من نافذة الطباعة');
    return;
  }
  /* بديل إن حُجبت النافذة المنبثقة: إطار مخفي */
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;bottom:0;visibility:hidden';
  document.body.appendChild(f);
  const d = f.contentDocument; d.open(); d.write(html); d.close();
  printWhenReady(f.contentWindow);
  setTimeout(() => f.remove(), 120000);
  toast('اختر «حفظ كـ PDF» من نافذة الطباعة');
}

/* ----- نافذة اختيار الصيغة ----- */
let exChat = null;
function exportChat(c){
  if (!c || !c.messages.length){ toast('لا توجد رسائل لتصديرها'); return; }
  exChat = c; $('exOv').classList.add('show');
}
$('exMd').addEventListener('click', () => { const c = exChat; $('exOv').classList.remove('show'); exChat = null; if (c) exportMarkdown(c); });
$('exPdf').addEventListener('click', () => { const c = exChat; $('exOv').classList.remove('show'); exChat = null; if (c) exportPDF(c); });
ctx.addEventListener('click', e => {
  e.stopPropagation();
  const b = e.target.closest('button'); if (!b) return;
  const c = chats.find(x => x.id === ctxId); closeMenus();
  if (!c) return;
  const act = b.dataset.act;
  if (act === 'export') exportChat(c);
  else if (act === 'delete') deleteChat(c.id);
  else if (act === 'rename') renameChat(c.id);
  else if (act === 'fav') toggleFav(c.id);
  else if (act === 'tag') openTagPicker([c.id]);
  else if (act === 'retitle'){ if (busy) toast('انتظر انتهاء الرد'); else { toast('جارٍ توليد العنوان…'); makeTitle(c, activeModel(), true); } }
  else if (act === 'link') copyText(chatUrl(c.id)).then(ok => toast(ok ? 'تم نسخ رابط المحادثة' : 'تعذّر النسخ'));
});
topMenu.addEventListener('click', e => {
  e.stopPropagation();
  const b = e.target.closest('button'); if (!b) return;
  const c = current(); closeMenus();
  if (!c) return;
  if (b.dataset.act === 'export') exportChat(c); else if (b.dataset.act === 'delete') deleteChat(c.id); else if (b.dataset.act === 'tag') openTagPicker([c.id]);
});
$('filterBtn').addEventListener('click', e => { e.stopPropagation(); filterView = 'main'; paintFilter(); openMenu($('filterMenu'), $('filterBtn')); });
$('filterMenu').addEventListener('click', e => {
  e.stopPropagation();
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.f === 'all'){ closeMenus(); openChats(); return; }
  if (b.dataset.f === 'tags'){ filterView = 'tags'; paintFilter(); return; }
  if ('back' in b.dataset){ filterView = 'main'; paintFilter(); return; }
  if ('manage' in b.dataset){ closeMenus(); closeDrawer(); openTagPicker(null); return; }
  if (b.dataset.tag) chatFilter = 'tag:' + b.dataset.tag;
  else if (b.dataset.f) chatFilter = b.dataset.f;
  else return;
  store.set('ai_chat_filter', chatFilter);
  closeMenus(); paintFilter(); showAll = false; renderList();
});
$('topMore').addEventListener('click', e => { e.stopPropagation(); openMenu(topMenu, $('topMore')); });
document.addEventListener('click', closeMenus);
el.chatList.addEventListener('scroll', closeMenus, { passive:true });
window.addEventListener('resize', closeMenus);

