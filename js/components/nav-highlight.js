/* QUARK AI — تظليل التنقل */
'use strict';

/* ================= تظليل التنقل ================= */
(function(){
  const m = document.querySelector('.main');
  const sync = () => {
    const lib = m.classList.contains('lib-open'), set = m.classList.contains('set-open'), pf = m.classList.contains('pf-open'), ch = m.classList.contains('ch-open'), md = m.classList.contains('md-open'), vo = m.classList.contains('vo-open'), tk = m.classList.contains('tasks-panel-open'), sk = m.classList.contains('sk-open'), mm = m.classList.contains('mm-open'), ml = m.classList.contains('ml-open');
    $('filterBtn').classList.toggle('active', ch);
    $('navModels').classList.toggle('active', md);
    $('navVoices').classList.toggle('active', vo);
    $('navMail').classList.toggle('active', ml);
    $('navLib').classList.toggle('active', lib);
    $('avatarBtn').classList.toggle('active', set || pf);
    el.sidebar.classList.toggle('view-open', lib || set || pf || ch || md || vo || ml);
  };
  new MutationObserver(sync).observe(m, { attributes:true, attributeFilter:['class'] });
  sync();
})();

