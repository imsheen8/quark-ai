/* QUARK AI — خانة الكتابة والأوامر السريعة بـ / */
'use strict';

/* ================= الأوامر السريعة بـ / (القوالب والشخصيات من المكتبة) ================= */
(() => {
  const pop = $('slashPop'), list = $('slashList');
  let items = [], sel = 0;
  const fold = x => String(x).replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
  const isOpen = () => !pop.hidden;
  function close(){ pop.hidden = true; items = []; }
  function paint(){
    list.innerHTML = items.length ? '' : '<div class="pop-empty">لا توجد نتائج في المكتبة</div>';
    const act = window.__libActive?.();
    items.forEach((x, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sl-item' + (i === sel ? ' on' : ''); b.setAttribute('role', 'option');
      const per = x.kind === 'persona', skl = x.kind === 'skill';
      b.innerHTML = `<span class="sl-k ${per || skl ? 'persona' : ''}">${per ? 'شخصية' : skl ? 'مهارة' : 'قالب'}</span><span class="sl-t"><b>${esc(x.name)}${per && x.id === act ? '<em>مفعّلة</em>' : ''}</b><small>${esc(x.text.replace(/\s+/g, ' ').trim())}</small></span>`;
      b.addEventListener('mousedown', e => e.preventDefault());   /* لا تُفقد التركيز من خانة الكتابة */
      b.addEventListener('click', () => pick(x));
      b.addEventListener('mousemove', () => { if (sel !== i){ list.children[sel]?.classList.remove('on'); sel = i; b.classList.add('on'); } });
      list.appendChild(b);
    });
    list.children[sel]?.scrollIntoView({ block:'nearest' });
  }
  function refresh(){
    const m = /^\/(\S*)$/.exec(el.input.value);
    if (!m){ if (isOpen()) close(); return; }
    const q = fold(m[1]);
    items = [...(window.__libItems?.() || []), ...(window.__skItems?.() || [])].filter(x => !q || fold(x.name).includes(q) || fold(x.text).includes(q))
      .sort((a, b) => (fold(b.name).startsWith(q) ? 1 : 0) - (fold(a.name).startsWith(q) ? 1 : 0));
    sel = 0; closePop(); closeAttach(); paint(); pop.hidden = false;
  }
  function pick(x){
    close(); el.input.value = ''; autosize(); updateSendState();
    if (x.kind === 'template'){
      fillTemplate(x.text, x.name, txt => {
        el.input.value = txt; autosize(); updateSendState(); el.input.focus();
        el.input.setSelectionRange(txt.length, txt.length);
      });
    } else if (x.kind === 'skill'){ window.__skPin?.(x.id); el.input.focus(); toast('ثُبّتت المهارة للرسالة التالية'); }
    else { window.__libTogglePersona?.(x.id); el.input.focus(); }
  }
  el.input.addEventListener('keydown', e => {
    if (!isOpen() || e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault(); if (!items.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; paint();
    } else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab'){
      if (!items.length){ close(); return; }
      e.preventDefault(); e.stopImmediatePropagation(); pick(items[sel]);
    } else if (e.key === 'Escape'){ e.preventDefault(); close(); }
  }, true);
  document.addEventListener('click', e => { if (isOpen() && !e.target.closest('#slashPop') && e.target !== el.input) close(); });
  window.__slashRefresh = refresh;
})();
el.input.addEventListener('input', () => { autosize(); updateSendState(); });
el.input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isMobile()){ e.preventDefault(); sendMessage(); }
});
el.send.addEventListener('click', sendMessage);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){ closeThink(); closeFile(); $('tgOv').classList.remove('show'); closePop(); closeAttach(); closeMenus(); if (mainEl.classList.contains('set-open')) closeSettings(); if (mainEl.classList.contains('pf-open')) closeProfile(); closeDrawer(); }
});

