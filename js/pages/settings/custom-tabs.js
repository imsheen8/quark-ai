/* QUARK AI — الإعدادات ← التخصيص: أربعة تبويبات (التفضيلات والتعليمات · الذاكرة · المهارات · معاملات النموذج) */
'use strict';

(() => {
  const CU = [['prefs', 'التفضيلات والتعليمات', 'user'], ['mem', 'الذاكرة', 'brain'], ['skills', 'المهارات', 'sparkles'], ['params', 'معاملات النموذج', 'sh-sliders']];
  let cur = store.get('ai_cu_tab', 'prefs'); if (!CU.some(x => x[0] === cur)) cur = 'prefs';
  const nav = () => document.getElementById('cuTabs');
  function paint(){
    const n = nav(); if (!n) return;
    n.innerHTML = CU.map(([k, l, i]) => `<button type="button" role="tab" class="vo-tab ${k === cur ? 'on' : ''}" aria-selected="${k === cur}" data-cu="${k}"><svg class="i" aria-hidden="true"><use href="#i-${i}"/></svg><span>${l}</span></button>`).join('');
    document.querySelectorAll('[data-panel="custom"] details[data-cu]').forEach(d => { d.hidden = d.dataset.cu !== cur; d.open = true; });
    if (cur === 'mem') window.__mmRefresh?.();
    if (cur === 'skills') window.__renderSkillSettings?.();
    if (cur === 'params') { try{ renderPrm(); }catch{} }
  }
  function go(k){ if (!CU.some(x => x[0] === k)) return; cur = k; try{ store.set('ai_cu_tab', k); }catch{} paint(); }
  document.addEventListener('click', e => { const b = e.target.closest('#cuTabs [data-cu]'); if (b) go(b.dataset.cu); });
  window.__cuPaint = paint; window.__cuGo = go; window.__cuTab = () => cur;
})();
