/* QUARK AI — معاينة مباشرة لكود HTML / SVG */
'use strict';

/* ================= معاينة مباشرة لكود HTML / SVG ================= */
/* تُعرض داخل iframe معزول (sandbox بدون allow-same-origin) فلا يصل الكود لمفاتيحك أو بيانات التطبيق، وبسياسة CSP تمنع أي اتصال شبكي */
const PV_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; img-src data: blob: https:; font-src data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; media-src data: blob: https:">`;
function previewDoc(code, lang){
  const isSvg = lang === 'svg' || (/^\s*<svg[\s>]/i.test(code) && !/<html[\s>]/i.test(code));
  if (isSvg) return `<!doctype html><html><head><meta charset="utf-8">${PV_CSP}<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100%}</style></head><body>${code}</body></html>`;
  if (/<head[^>]*>/i.test(code)) return code.replace(/<head[^>]*>/i, m => m + PV_CSP);
  if (/<html[^>]*>/i.test(code)) return code.replace(/<html[^>]*>/i, m => m + '<head>' + PV_CSP + '</head>');
  return `<!doctype html><html><head><meta charset="utf-8">${PV_CSP}<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${code}</body></html>`;
}
function previewFrame(box){
  const fr = document.createElement('iframe');
  fr.setAttribute('sandbox', 'allow-scripts'); fr.setAttribute('title', 'معاينة');
  fr.srcdoc = previewDoc(box.querySelector('code').textContent, box.dataset.lang || '');
  return fr;
}
function togglePreview(btn){
  const box = btn.closest('.code'), node = btn.closest('.msg');
  if (node && node.dataset.live){ toast('انتظر اكتمال الرد'); return; }
  let pane = box.querySelector(':scope > .code-prev');
  if (!pane){
    pane = document.createElement('div'); pane.className = 'code-prev';
    pane.appendChild(previewFrame(box));
    box.insertBefore(pane, box.querySelector('pre'));
  }
  const on = !box.classList.contains('prev-on');
  box.classList.toggle('prev-on', on);
  btn.innerHTML = on ? `${ic('code')} الكود` : `${ic('eye')} معاينة`;
  box.querySelector('[data-pexp]').hidden = !on;
}
function expandPreview(box){
  const ov = document.createElement('div'); ov.className = 'pv-ov';
  ov.innerHTML = `<div class="pv-bar"><span>معاينة</span><button type="button" class="pv-x" aria-label="إغلاق">${ic('x')}</button></div>`;
  ov.appendChild(previewFrame(box));
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  ov.querySelector('.pv-x').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

el.messages.addEventListener('click', async e => {
  const gd = e.target.closest('[data-gdl]');
  if (gd){
    const src = gd.dataset.gdl ? await imgData(gd.dataset.gdl) : gd.dataset.gurl;
    if (src){
      const name = 'quark-image-' + Date.now() + '.png';
      try{ saveFile(await (await fetch(src)).blob(), name); }
      catch{ const a = document.createElement('a'); a.href = src; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    }
    else toast('الصورة غير متوفرة');
    return;
  }
  const pvb = e.target.closest('[data-prev]');
  if (pvb){ togglePreview(pvb); return; }
  const pxb = e.target.closest('[data-pexp]');
  if (pxb){ expandPreview(pxb.closest('.code')); return; }
  const cp = e.target.closest('[data-copy]');
  if (cp){ const ok = await copyText(cp.closest('.code').querySelector('code').textContent); flash(cp, ok ? `${ic('check')} تم النسخ` : 'فشل'); return; }
  const node = e.target.closest('.msg');
  const pk = e.target.closest('[data-pick]');
  if (pk){ pickCmp(node, +pk.dataset.pick); return; }
  const cc = e.target.closest('[data-ccopy]');
  if (cc){ const ok = await copyText(node._m.cmp[+cc.dataset.ccopy].content || ''); flash(cc, ok ? ic('check') : 'فشل'); return; }
  const cm = e.target.closest('[data-copymsg]');
  if (cm){ const ok = await copyText(node._raw || ''); flash(cm, ok ? ic('check') : 'فشل'); return; }
  const sh = e.target.closest('[data-share]');
  if (sh){
    const t = node._raw || '';
    shareSheet(t);
    return;
  }
  const sp = e.target.closest('[data-speak]');
  if (sp){ toggleSpeak(sp, node._raw || ''); return; }
  const fb = e.target.closest('[data-fb]');
  if (fb){
    const m = node._m, v = fb.dataset.fb;
    m.fb = m.fb === v ? null : v; save();
    node.querySelectorAll('[data-fb]').forEach(b => b.classList.toggle('on', b.dataset.fb === m.fb));
    return;
  }
  const ub = e.target.closest('.bubble');
  if (ub && node.querySelector(':scope > .u-tools') && !e.target.closest('a,button,.att-chip,.msg-img,.think,.code,pre,table,[data-copy]') && !node.classList.contains('editing')){
    if (!String(getSelection() || '')){
      const was = node.classList.contains('tools-on');
      document.querySelectorAll('.msg.tools-on').forEach(n => n.classList.remove('tools-on'));
      if (!was) node.classList.add('tools-on');
    }
    return;
  }
  if (e.target.closest('[data-edit]')){ startEdit(node); return; }
  const vb = e.target.closest('[data-ver]');
  if (vb){ if (!vb.disabled) switchVer(node, +vb.dataset.ver); return; }
  if (e.target.closest('[data-esave]')){ saveEdit(node); return; }
  if (e.target.closest('[data-ecancel]')){ cancelEdit(node); return; }
  if (e.target.closest('[data-regen]')){ regenerate(); return; }
  const card = e.target.closest('[data-prompt]');
  if (card){ el.input.value = card.dataset.prompt; autosize(); sendMessage(); }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.msg')) document.querySelectorAll('.msg.tools-on').forEach(n => n.classList.remove('tools-on'));
});

/* ----- مشاركة الرد: ورقة من تصميم التطبيق بدل قائمة النظام ----- */
function shareSheet(text){
  const ov = document.createElement('div');
  ov.className = 'sheet-ov q-sheet show';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-label="مشاركة الرد"><div class="sheet-handle"></div>` +
    `<div class="sheet-head"><span></span><h3>مشاركة الرد</h3><button type="button" class="sheet-x" data-sx aria-label="إغلاق">${ic('x')}</button></div>` +
    `<div class="sheet-body q-list">` +
    `<button type="button" class="q-opt" data-sh="copy"><span>نسخ النص</span>${ic('copy')}</button>` +
    `<button type="button" class="q-opt" data-sh="txt"><span>حفظ كملف نصي (.txt)</span>${ic('download')}</button>` +
    `<button type="button" class="q-opt" data-sh="md"><span>حفظ كملف Markdown (.md)</span>${ic('download')}</button>` +
    `</div></div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('click', async e => {
    if (e.target === ov || e.target.closest('[data-sx]')){ close(); return; }
    const b = e.target.closest('[data-sh]'); if (!b) return;
    const k = b.dataset.sh; close();
    if (k === 'copy'){ await copyText(text); toast('تم نسخ الرد'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type:'text/plain;charset=utf-8' }));
    a.download = 'reply.' + k; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('تم حفظ الملف');
  });
  document.body.appendChild(ov);
}
