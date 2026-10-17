/* QUARK AI — صفحة النماذج: الأحداث */
'use strict';

/* ----- أحداث ----- */
$('navModels').addEventListener('click', openModels);
$('mdMenu').addEventListener('click', () => $('toggleSidebar').click());
$('mdSearchBtn').addEventListener('click', () => {
  const s = $('mdSearch'); s.classList.toggle('show');
  if (s.classList.contains('show')) $('mdQ').focus(); else { mdUi.q = ''; $('mdQ').value = ''; mdUi.limit = 120; mdRender(); }
});
$('mdQ').addEventListener('input', e => { mdUi.q = e.target.value; mdUi.limit = 120; mdRender(); });
$('mdMulti').addEventListener('click', () => { mdUi.multi = !mdUi.multi; mdSel.clear(); mdRender(); });
$('mdSync').addEventListener('click', mdSyncAll);
$('mdAdd').addEventListener('click', mdAddDialog);
$('mdAll').addEventListener('click', () => {
  const v = mdFiltered(), every = v.length && v.every(x => mdSel.has(x.key));
  v.forEach(x => every ? mdSel.delete(x.key) : mdSel.add(x.key)); mdRender();
});
const mdSelItems = () => [...mdSel].map(itemOf).filter(Boolean);
$('mdBOn').addEventListener('click', () => { mdSelItems().forEach(x => { x.m.on = true; }); persistSettings(); mdRender(); toast('تم التفعيل'); });
$('mdBOff').addEventListener('click', () => { mdSelItems().forEach(x => { x.m.on = false; }); persistSettings(); mdRender(); toast('تم التعطيل'); });
$('mdBFav').addEventListener('click', () => {
  const l = mdSelItems(), all = l.every(x => modelFav.has(x.key));
  l.forEach(x => all ? modelFav.delete(x.key) : modelFav.add(x.key)); saveFav(); mdRender(); toast(all ? 'أُزيلت من المفضلة' : 'أُضيفت للمفضلة');
});
$('mdBTest').addEventListener('click', () => { const l = mdSelItems(); if (l.length){ toast(`يختبر ${l.length} نموذجًا…`); mdTestMany(l); } });
$('mdBDel').addEventListener('click', () => { if (mdSel.size) mdAskDelete([...mdSel]); });
$('mdBBench').addEventListener('click', () => { const l = mdSelItems().filter(x => x.ep.enabled); if (l.length < 2){ toast('حدّد نموذجين على الأقل'); return; } if (l.length > 8) toast('تُقارن أول 8 نماذج فقط'); window.__mdPro.bench(l); });
$('mdSt').addEventListener('change', e => { mdUi.st = e.target.value; mdUi.limit = 120; saveMdUi(); mdRender(); });
$('mdFam').addEventListener('change', e => { mdUi.fam = e.target.value; mdUi.limit = 120; saveMdUi(); mdRender(); });
$('mdVm').addEventListener('click', e => { const b = e.target.closest('[data-vm]'); if (!b) return; mdUi.view = b.dataset.vm; saveMdUi(); mdRender(); });
$('mdReset').addEventListener('click', () => { Object.assign(mdUi, { q:'', cap:'all', ep:'all', st:'all', fam:'all', limit:120 }); $('mdQ').value = ''; saveMdUi(); mdRender(); });
document.addEventListener('keydown', e => {
  if (!mainEl.classList.contains('md-open') || e.target.closest('input,textarea,select,[contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/'){ e.preventDefault(); $('mdSearch').classList.add('show'); $('mdQ').focus(); }
});
$('mdCap').addEventListener('change', e => { mdUi.cap = e.target.value; mdUi.limit = 120; saveMdUi(); mdRender(); });
$('mdSort').addEventListener('change', e => { mdUi.sort = e.target.value; saveMdUi(); mdRender(); });
$('mdTabs').addEventListener('click', e => { const b = e.target.closest('[data-mt]'); if (!b) return; mdUi.tab = b.dataset.mt; mdUi.limit = 120; saveMdUi(); mdRender(); });
$('mdChips').addEventListener('click', e => { const b = e.target.closest('[data-ce]'); if (!b) return; mdUi.ep = b.dataset.ce; mdUi.limit = 120; saveMdUi(); mdRender(); });
$('mdGrid').addEventListener('click', async e => {
  const more = e.target.closest('[data-a="more"]');
  if (more){ mdUi.limit += 120; mdRender(); return; }
  const card = e.target.closest('.lib-card'); if (!card) return;
  const key = card.dataset.k;
  if (mdUi.multi){ mdSel.has(key) ? mdSel.delete(key) : mdSel.add(key); mdRender(); return; }
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'menu'){
    const p = card.querySelector('.lib-pop'), was = p.classList.contains('show');
    document.querySelectorAll('#mdGrid .lib-pop.show').forEach(x => x.classList.remove('show'));
    if (!was) p.classList.add('show'); return;
  }
  document.querySelectorAll('#mdGrid .lib-pop.show').forEach(x => x.classList.remove('show'));
  const it = itemOf(key); if (!it) return;
  if (!a || a === 'info') return window.__mdPro.detail(it);
  if (a === 'play') return window.__mdPro.play(it);
  if (a === 'use') mdUse(it);
  else if (a === 'second') mdSecond(it);
  else if (a === 'fav') mdToggleFav(it);
  else if (a === 'test') mdTestOne(it);
  else if (a === 'params') mdParams(it);
  else if (a === 'toggle'){ it.m.on = !it.m.on; persistSettings(); mdRender();  }
  else if (a === 'copy') toast(await copyText(it.m.id) ? 'تم نسخ المعرّف' : 'تعذّر النسخ');
  else if (a === 'del') mdAskDelete([key]);
});
document.addEventListener('click', e => {
  if (!mainEl.classList.contains('md-open') || e.target.closest('.lib-menu')) return;
  document.querySelectorAll('#mdGrid .lib-pop.show').forEach(p => p.classList.remove('show'));
});

