/* QUARK AI — متغيرات القوالب */
'use strict';

/* متغيرات القوالب {{اسم}} أو {{اسم|افتراضي}} */
const TPL_RE = /\{\{\s*([^{}|]+?)\s*(?:\|\s*([^{}]*?)\s*)?\}\}/g;
function tplVars(text){
  const m = new Map();
  for (const x of String(text).matchAll(TPL_RE)) if (!m.has(x[1])) m.set(x[1], x[2] || '');
  return m;
}
function fillTemplate(text, name, cb){
  const vars = tplVars(text);
  if (!vars.size){ cb(text); return; }
  const ov = $('tvOv'), box = $('tvFields'), ins = [];
  $('tvTitle').textContent = name || 'قالب';
  box.innerHTML = '';
  vars.forEach((def, k) => {
    const l = document.createElement('label'); l.className = 'lib-f'; l.textContent = k;
    const t = document.createElement('textarea'); t.className = 'tx tv-in'; t.rows = 2; t.placeholder = def || '';
    t.dataset.k = k; l.appendChild(t); box.appendChild(l); ins.push(t);
  });
  const close = () => { ov.classList.remove('show'); ov.removeEventListener('keydown', onKey, true); };
  const submit = () => {
    const vals = {};
    for (const t of ins){
      const v = t.value.trim() || vars.get(t.dataset.k);
      if (!v){ toast('املأ الحقل: ' + t.dataset.k); t.focus(); return; }
      vals[t.dataset.k] = v;
    }
    close(); cb(text.replace(TPL_RE, (_, k) => vals[k] ?? ''));
  };
  function onKey(e){
    if (e.key === 'Escape'){ e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); submit(); }
  }
  ov.addEventListener('keydown', onKey, true);
  $('tvOk').onclick = submit;
  ov.classList.add('show'); ins[0].focus();
}

