/* QUARK AI — نسخ/نطق الرسائل + البحث داخل المحادثة */
'use strict';

/* ================= البحث داخل المحادثة مع تظليل النتائج ================= */
(() => {
  const bar = $('csearch'), inp = $('csQ'), cnt = $('csCnt'), prev = $('csPrev'), next = $('csNext');
  let hits = [], idx = -1, tmr = 0, open = false;
  const SKIP = '.code-head, .actions, .u-tools, .ver-nav, .u-badge, .att-row, .think, button, script, style, svg';
  /* توحيد الكتابة: حذف التشكيل والتطويل وتوحيد الألف والياء، مع خريطة للمواضع الأصلية */
  const DIA = /[\u064B-\u065F\u0670\u0640\u06D6-\u06ED]/;
  function fold(str){
    let out = '', map = [];
    for (let i = 0; i < str.length; i++){
      let ch = str[i];
      if (DIA.test(ch)) continue;
      if ('أإآٱ'.includes(ch)) ch = 'ا'; else if (ch === 'ى') ch = 'ي'; else if (ch === 'ؤ') ch = 'و'; else ch = ch.toLowerCase();
      out += ch; map.push(i);
    }
    return { out, map };
  }
  function clearMarks(){
    const parents = new Set();
    el.messages.querySelectorAll('mark.sr-hit').forEach(m => {
      const par = m.parentNode; if (!par) return;
      par.replaceChild(document.createTextNode(m.textContent), m); parents.add(par);
    });
    parents.forEach(p => p.normalize());
    hits = []; idx = -1;
  }
  function textNodes(){
    const w = document.createTreeWalker(el.messages, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeValue && n.nodeValue.trim() && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    const a = []; while (w.nextNode()) a.push(w.currentNode); return a;
  }
  function paintCount(){
    const q = inp.value.trim();
    cnt.textContent = !q ? '' : hits.length ? `${idx + 1}/${hits.length}` : 'لا نتائج';
    prev.disabled = next.disabled = hits.length < 2;
  }
  function go(i, scroll = true){
    if (!hits.length) return;
    hits[idx]?.classList.remove('cur');
    idx = (i + hits.length) % hits.length;
    const m = hits[idx]; m.classList.add('cur'); paintCount();
    if (scroll){
      const box = el.messages, r = m.getBoundingClientRect(), b = box.getBoundingClientRect();
      box.scrollTo({ top: box.scrollTop + (r.top - b.top) - box.clientHeight / 2 + r.height / 2, behavior: 'smooth' });
    }
  }
  function run(preserve){
    const old = idx; clearMarks();
    const q = fold(inp.value.trim()).out;
    if (!q){ paintCount(); return; }
    for (const node of textNodes()){
      const src = node.nodeValue, f = fold(src);
      const ranges = []; let from = 0, at;
      while ((at = f.out.indexOf(q, from)) > -1){
        let a = f.map[at], e = f.map[at + q.length - 1] + 1;
        while (e < src.length && DIA.test(src[e])) e++;
        ranges.push([a, e]); from = at + q.length;
      }
      const made = [];
      for (let k = ranges.length - 1; k >= 0; k--){
        const r = document.createRange(); r.setStart(node, ranges[k][0]); r.setEnd(node, ranges[k][1]);
        const mk = document.createElement('mark'); mk.className = 'sr-hit';
        try{ r.surroundContents(mk); made.push(mk); }catch{}
      }
      hits.push(...made.reverse());
    }
    idx = -1;
    if (hits.length) go(preserve && old >= 0 ? Math.min(old, hits.length - 1) : 0, !preserve); else paintCount();
    obs.takeRecords();
  }
  function openBar(){
    if (!current()?.messages.length) return;
    open = true; bar.hidden = false; inp.focus(); inp.select();
  }
  function closeBar(){
    open = false; bar.hidden = true; clearTimeout(tmr); clearMarks(); inp.value = ''; paintCount();
  }
  $('topSearch').addEventListener('click', () => open ? closeBar() : openBar());
  $('csClose').addEventListener('click', closeBar);
  prev.addEventListener('click', () => go(idx - 1));
  next.addEventListener('click', () => go(idx + 1));
  inp.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => run(), 120); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); e.shiftKey ? go(idx - 1) : go(idx + 1); }
    else if (e.key === 'Escape'){ e.preventDefault(); closeBar(); }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && current()?.messages.length && !document.querySelector('.main.lib-open, .main.set-open, .main.pf-open, .main.ch-open, .main.md-open, .main.vo-open')){
      e.preventDefault(); openBar();
    }
  });
  /* تُستدعى بعد كل إعادة رسم للرسائل: تُغلق في المحادثة الفارغة وإلا يُعاد التظليل */
  window.__csActive = () => open && !!inp.value.trim();
  window.__csRefresh = () => {
    if (!open) return;
    if (!current()?.messages.length){ closeBar(); return; }
    if (inp.value.trim()) run(false);
  };
  /* عند اكتمال بث رد جديد تتغير العقد؛ أعد التظليل مع الحفاظ على النتيجة الحالية */
  const obs = new MutationObserver(() => {
    if (!open || !inp.value.trim() || busy) return;
    clearTimeout(tmr); tmr = setTimeout(() => run(true), 250);
  });
  obs.observe(el.messages, { childList:true, subtree:true });
})();


async function copyText(t){
  if (await nativeCopy(t)) return true;
  try{ await navigator.clipboard.writeText(t); return true; }
  catch{
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    let ok = false; try{ ok = document.execCommand('copy'); }catch{} ta.remove(); return ok;
  }
}
function flash(btn, html, ms = 1600){
  const old = btn.innerHTML; btn.innerHTML = html; btn.classList.add('ok');
  setTimeout(() => { btn.innerHTML = old; btn.classList.remove('ok'); }, ms);
}
/* القراءة الصوتية: تعتمد على المزوّد المختار في الإعدادات ← الصوت */
const toggleSpeak = (btn, text) => speakText(text, btn);
