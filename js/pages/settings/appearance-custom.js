/* QUARK AI — ثيم مخصص + نمط الحاوية + حجب الرد */
'use strict';

/* ----- إنشاء/تعديل ثيم مخصص ----- */
(() => {
  const ov = $('thOv'), F = { bg:$('thBg'), surface:$('thSurface'), text:$('thText'), accent:$('thAccent') };
  let editId = null, dirty = false;
  const mode = () => ov.querySelector('input[name=thMode]:checked').value;
  const vals = () => ({ bg:F.bg.value, surface:F.surface.value, text:F.text.value, accent:F.accent.value });
  function setColors(c){ Object.keys(F).forEach(k => { F[k].value = c[k]; }); }
  function paint(){
    const t = { mode:mode(), ...vals() }, v = themeVars(t);
    $('thLive').innerHTML = `<div class="tl-side" style="background:${v['--sidebar']}"></div><div class="tl-main" style="background:${v['--bg']};color:${v['--text']}">` +
      `<div class="tl-bub" style="background:${v['--bubble']}">رسالتك هنا</div>` +
      `<div class="tl-ai" style="color:${v['--text-2']}">رد المساعد مع <b style="color:${t.accent}">لون مميز</b></div>` +
      `<div class="tl-btn" style="background:${t.accent};color:${onAccent(t.accent)}">إرسال</div></div>`;
    $('thWarn').hidden = contrast(t.text, t.bg) >= 4.5;
  }
  function open(id, m){
    const ex = id ? settings.customThemes.find(x => x.id === id) : null;
    editId = ex ? ex.id : null; dirty = !!ex;
    const md = ex ? ex.mode : m;
    $('thTitle').textContent = ex ? 'تعديل الثيم' : 'ثيم مخصص';
    $('thName').value = ex ? ex.name : '';
    ov.querySelector(`input[name=thMode][value=${md}]`).checked = true;
    setColors(ex || BASE_COLORS[md]); $('thDel').hidden = !ex; paint();
    ov.classList.add('show'); setTimeout(() => $('thName').focus(), 50);
  }
  Object.values(F).forEach(i => i.addEventListener('input', () => { dirty = true; paint(); }));
  ov.querySelectorAll('input[name=thMode]').forEach(r => r.addEventListener('change', () => { if (!dirty) setColors(BASE_COLORS[mode()]); paint(); }));
  $('thSave').addEventListener('click', () => {
    if (!editId && !isPro() && settings.customThemes.length >= FREE_THEMES){ openPlans('الخطة المجانية تتيح ثيمًا مخصصًا واحدًا.'); return; }
    if (settings.customThemes.length >= PRO_THEMES && !editId){ toast('وصلت للحد الأقصى (' + PRO_THEMES + ' ثيمًا مخصصًا)'); return; }
    const t = { id:editId || 'c_' + Math.random().toString(36).slice(2, 8), name:$('thName').value.trim().slice(0, 24) || 'ثيم مخصص', mode:mode(), ...vals() };
    const i = settings.customThemes.findIndex(x => x.id === t.id);
    if (i > -1){
      const old = settings.customThemes[i].mode; settings.customThemes[i] = t;
      if (old !== t.mode && settings.themeSel[old] === t.id) settings.themeSel[old] = 'default';
    } else settings.customThemes.push(t);
    settings.themeSel[t.mode] = t.id;
    if (settings.theme !== 'auto') settings.theme = t.mode;   /* ليظهر الثيم الجديد فورًا */
    persistSettings(); applyTheme(); ov.classList.remove('show'); toast('تم حفظ الثيم');
  });
  $('thDel').addEventListener('click', () => {
    if (!editId) return;
    settings.customThemes = settings.customThemes.filter(x => x.id !== editId);
    ['dark', 'light'].forEach(m => { if (settings.themeSel[m] === editId) settings.themeSel[m] = 'default'; });
    persistSettings(); applyTheme(); ov.classList.remove('show'); toast('تم حذف الثيم');
  });
  const act = e => {
    const ed = e.target.closest('[data-edit]');
    if (ed){ e.stopPropagation(); open(ed.dataset.edit); return; }
    const add = e.target.closest('[data-new]'); if (add){ if (!isPro() && settings.customThemes.length >= FREE_THEMES){ openPlans('الخطة المجانية تتيح ثيمًا مخصصًا واحدًا. رقّ إلى برو لإنشاء المزيد.'); return; } open(null, add.dataset.new); return; }
    const c = e.target.closest('[data-th]'); if (!c) return;
    settings.themeSel[c.dataset.mode] = c.dataset.th; persistSettings(); applyTheme();
  };
  $('themeBox').addEventListener('click', act);
  $('themeBox').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.th-card')){ e.preventDefault(); act(e); } });
})();
$('stripeSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  settings.cont.stripe = b.dataset.stripe; persistSettings(); applyTheme();
});
[['radiusSeg','radius','radius'],['borderSeg','bw','bw'],['alphaSeg','alpha','alpha']].forEach(([id,k,a]) => $(id).addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  settings.cont[k] = b.dataset[a]; persistSettings(); applyTheme();
}));
$('chatStyleSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); const c = current(); if (!b || !c) return;
  if (b.dataset.cs === 'container' && !isPro()){ openPlans('النمط المستقل لكل محادثة متاح في خطة برو.'); return; }
  if (b.dataset.cs === 'auto') delete c.mstyle; else c.mstyle = b.dataset.cs;
  save(); applyTheme();
});
$('stripeColor').addEventListener('input', e => { settings.cont.color = e.target.value; persistSettings(); applyTheme(); });
$('contBox').addEventListener('click', e => {
  const b = e.target.closest('[data-copt]'); if (!b) return;
  settings.cont[b.dataset.copt] = !settings.cont[b.dataset.copt]; persistSettings(); applyTheme();
});
/* حجب الرد: أول ضغطة تُظهره فقط */
el.messages.addEventListener('click', e => {
  const r = document.documentElement.dataset;
  if (r.msgstyle !== 'container' || r.cspoiler !== '1') return;
  const m = e.target.closest('.msg.ai');
  if (!m || m.dataset.live || m.classList.contains('error') || m.classList.contains('cmp-msg') || m.classList.contains('revealed')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  m.classList.add('revealed'); if (m._m) revealedMsgs.add(m._m);
}, true);
/* الأزرار السريعة */
el.messages.addEventListener('click', e => {
  const q = e.target.closest('.qrow button[data-q]'); if (!q) return;
  if (busy) return;
  if (pending.length){ toast('أرسل المرفقات أو أزلها أولًا'); return; }
  const draft = el.input.value;
  el.input.value = q.dataset.q; sendMessage();
  el.input.value = draft; autosize(); updateSendState();
});

