/* QUARK AI — معاملات النموذج */
'use strict';

/* ----- معاملات النموذج ----- */
let prmScope = 'global';
const PRM_RANGE = { temperature:[0,2], top_p:[0,1], max_tokens:[1,1000000] };
const prmRows = () => [...document.querySelectorAll('.prm[data-p]')];
function prmRead(scope){
  if (scope === 'global') return cleanParams(settings.params.global);
  if (scope === 'model'){ const k = modelKey(activeModel()); return k ? cleanParams(settings.params.models[k]) : {}; }
  return cleanParams(current()?.params);
}
function prmForm(){
  const o = {};
  prmRows().forEach(r => {
    const v = r.querySelector('.prm-in').value.trim(), k = r.dataset.p;
    if (v === '' || isNaN(+v)) return;
    const [lo, hi] = PRM_RANGE[k]; let n = Math.min(hi, Math.max(lo, +v));
    if (k === 'max_tokens') n = Math.round(n);
    o[k] = n;
  });
  return o;
}
const sameParams = (a, b) => PRM_KEYS.every(k => a[k] === b[k]);
function prmDirty(){ $('prmSave').disabled = sameParams(prmForm(), prmRead(prmScope)); }
function prmFill(o){
  prmRows().forEach(r => {
    const k = r.dataset.p, v = o[k], inp = r.querySelector('.prm-in'), rg = r.querySelector('input[type=range]');
    inp.value = v ?? ''; if (rg) rg.value = v ?? (k === 'temperature' ? 1 : 1);
  });
}
function renderPrm(){
  const am = activeModel(), c = current();
  const avail = { global:true, model:!!am, chat:!!c };
  if (!avail[prmScope]) prmScope = 'global';
  $('prmScope').querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.sc === prmScope); b.disabled = !avail[b.dataset.sc];
  });
  $('prmTarget').innerHTML = prmScope === 'global' ? 'تُطبَّق على كل المحادثات والنماذج ما لم يوجد تخصيص أدق.'
    : prmScope === 'model' ? 'تُطبَّق كلما استخدمت النموذج: <b>' + esc(am.model) + '</b>'
    : 'تُطبَّق على المحادثة الحالية فقط: <b>' + esc(c.title || 'محادثة') + '</b>';
  prmFill(prmRead(prmScope));
  const e = resolveParams(c);
  $('prmEff').textContent = 'الفعّالة الآن — ' + PRM_KEYS.map(k => k + ': ' + (e[k] ?? (k === 'max_tokens' && am?.ep.proto === 'anthropic' ? '4096' : 'default'))).join(' · ');
  prmDirty();
}
$('prmScope').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; prmScope = b.dataset.sc; renderPrm(); });
document.querySelector('[data-panel="custom"]').addEventListener('input', e => {
  const r = e.target.closest('.prm[data-p]'); if (!r) return;
  const inp = r.querySelector('.prm-in'), rg = r.querySelector('input[type=range]');
  if (e.target === rg) inp.value = rg.value;
  else if (rg && inp.value !== '' && !isNaN(+inp.value)) rg.value = inp.value;
  prmDirty();
});
function prmWrite(scope, o){
  if (scope === 'global') settings.params.global = o;
  else if (scope === 'model'){ const k = modelKey(activeModel()); if (!k) return; if (Object.keys(o).length) settings.params.models[k] = o; else delete settings.params.models[k]; }
  else { const c = current(); if (!c) return; if (Object.keys(o).length) c.params = o; else delete c.params; save(); return; }
  persistSettings();
}
$('prmSave').addEventListener('click', () => { prmWrite(prmScope, prmForm()); renderPrm(); toast('تم حفظ المعاملات'); });
$('prmReset').addEventListener('click', () => { prmWrite(prmScope, {}); renderPrm(); toast('تم مسح المعاملات لهذا النطاق'); });

