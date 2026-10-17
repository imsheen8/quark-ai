/* QUARK AI — حجم الرسائل */
'use strict';

$('sizeSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  settings.fontSize = b.dataset.size; persistSettings(); applyTheme();
});

