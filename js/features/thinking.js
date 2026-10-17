/* QUARK AI — عرض التفكير (reasoning) */
'use strict';

/* ----- التفكير ----- */
function splitThink(raw){
  let think = '', ans = raw || '', open = false, m;
  if ((m = ans.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/i))){
    think = m[1].trim(); open = !m[2]; ans = ans.slice(m[0].length).replace(/^\s+/, '');
  } else if (!/<think>/i.test(ans) && (m = ans.match(/^([\s\S]*?)<\/think>/i))){
    think = m[1].trim(); ans = ans.slice(m[0].length).replace(/^\s+/, '');
  }
  return { think, ans, open };
}
function thinkSteps(text){
  const paras = String(text).split(/\n{2,}/).map(x => x.trim()).filter(Boolean), out = [];
  for (let i = 0; i < paras.length; i++){
    const p = paras[i]; let m;
    if ((m = p.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/))){
      let body = m[2].trim();
      if (!body && paras[i + 1] && !/^\*\*/.test(paras[i + 1])) body = paras[++i];
      out.push({ title:m[1].trim(), body });
    } else if ((m = p.match(/^([^\n]{16,110}?[.!?؟:])(\s|$)/))){
      out.push({ title:m[1].trim(), body:p.slice(m[1].length).trim() });
    } else {
      const one = p.replace(/\s+/g, ' ');
      out.push({ title: one.length > 90 ? one.slice(0, 90).replace(/\s+\S*$/, '') + '…' : one, body: one.length > 90 ? p : '' });
    }
  }
  return out;
}
let thinkSheet = { tk:null, open:new Set() };
function renderSheet(){
  const d = thinkSheet.tk?._d; if (!d) return;
  const body = $('tkBody'), stick = body.scrollHeight - body.scrollTop - body.clientHeight < 48;
  let h = '<div class="tl">';
  d.steps.forEach((st, i) => {
    const has = !!st.body;
    h += `<div class="tl-item${has ? ' has' : ''}${thinkSheet.open.has(i) ? ' open' : ''}" data-i="${i}"><span class="tl-dot"></span><div class="tl-txt"><div class="tl-title" dir="auto">${esc(st.title)}</div>${has ? `<div class="tl-body" dir="auto">${esc(st.body)}</div>` : ''}</div></div>`;
  });
  h += d.live
    ? '<div class="tl-item active"><span class="tl-dot"></span><div class="tl-txt"><div class="tl-title">يفكّر…</div></div></div>'
    : `<div class="tl-item done"><span class="tl-dot"></span><div class="tl-txt"><div class="tl-title">${d.secs ? `اكتمل التفكير خلال ${d.secs} ثانية` : 'اكتمل التفكير'}</div></div></div>`;
  body.innerHTML = h + '</div>';
  if (d.live && stick) body.scrollTop = body.scrollHeight;
}
function openThink(tk){
  thinkSheet = { tk, open:new Set() }; renderSheet(); $('tkOv').classList.add('show');
}
function closeThink(){ $('tkOv').classList.remove('show'); thinkSheet.tk = null; }
function paintBubble(bubble, think, answer, live = false, secs = 0){
  let tk = bubble.querySelector(':scope > .think'), an = bubble.querySelector(':scope > .ans');
  if (!an){ bubble.innerHTML = ''; an = document.createElement('div'); an.className = 'ans'; bubble.appendChild(an); tk = null; }
  if (think){
    if (!tk){
      tk = document.createElement('div'); tk.className = 'think'; tk.tabIndex = 0; tk.setAttribute('role', 'button');
      tk.innerHTML = `<span class="tk-dots"><i></i><i></i><i></i></span><span class="tk-t" dir="auto"></span>${ic('chevron-left', 'chev')}`;
      tk.addEventListener('click', () => openThink(tk));
      tk.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openThink(tk); } });
      bubble.insertBefore(tk, an);
    }
    const steps = thinkSteps(think);
    tk._d = { steps, live, secs };
    tk.classList.toggle('live', live);
    tk.querySelector('.tk-t').textContent = live ? (steps.length ? steps[steps.length - 1].title : 'يفكّر…') : (secs ? `فكّر لمدة ${secs} ثانية` : 'التفكير');
    if (thinkSheet.tk === tk) renderSheet();
  } else if (tk){ if (thinkSheet.tk === tk) closeThink(); tk.remove(); }
  an.innerHTML = answer ? markdown(answer) : '';
  an.querySelectorAll('.code.streaming pre').forEach(p => { p.scrollTop = p.scrollHeight; });
}
