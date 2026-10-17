/* QUARK AI — أقسام مدمجة في أماكنها، دون نسخ البيانات أو واجهة التطبيق. */
'use strict';
(() => {
  $('memoryMount').appendChild($('mmView'));
  $('skillsMount').appendChild($('skView'));
  $('skillsMount').appendChild($('tkTasksView'));
  $('manageSkills').addEventListener('click', () => window.__openSkills());
  $('memoryDetails').addEventListener('toggle', () => {
    if ($('memoryDetails').open) window.__mmRefresh?.();
  });
  $('skillsSettingsDetails').addEventListener('toggle', () => {
    if ($('skillsSettingsDetails').open) window.__renderSkillSettings?.();
  });
})();
