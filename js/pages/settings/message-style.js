/* QUARK AI — نمط وحجم الرسائل */
'use strict';

$('msgStyleSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.mstyle === 'container' && !isPro()){ openPlans('نمط الحاوية متاح في خطة برو.'); return; }
  settings.msgStyle = b.dataset.mstyle === 'container' ? 'container' : 'plain'; persistSettings(); applyTheme();
});
$('sizeSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  settings.fontSize = b.dataset.size; persistSettings(); applyTheme();
});

