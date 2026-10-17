/* QUARK AI — مقارنة نموذجين */
'use strict';

/* ================= مقارنة نموذجين ================= */
/* رد المقارنة: { role:'assistant', cmp:[{ep,model,host,content,thinking?,thinkSecs?,ms?,error?,stopped?}×2], pick:null|0|1, content:<الرد المعتمد> } */
function cmpModel(){
  const s = cmpState.sel, ep = s && epOf(s.ep);
  return ep && ep.enabled && s.model ? { ep, model:s.model } : null;
}
const cmpActive = () => cmpState.on && !!cmpModel() && !!activeModel();
function cmpReady(){
  if (!cmpState.on) return true;
  const b = cmpModel();
  if (!b){ toast('اختر النموذج الثاني للمقارنة'); popTarget = 'B'; openPop(); return false; }
  if (b.ep.kind !== 'local' && !b.ep.key){ toast('أدخل مفتاح API للنموذج الثاني'); openSettings(); return false; }
  return true;
}
function updateCmpUI(){
  const on = cmpState.on, a = activeModel(), b = cmpModel();
  $('amCmp').classList.toggle('on', on);
  $('amModelB').hidden = !on; $('amModels').classList.toggle('two', on);
  $('amModelT').textContent = on ? 'النموذج الأول' : 'النموذج';
  $('amModelS').textContent = a ? shortModel(a.model) : 'لم يُحدَّد بعد';
  $('amModelBS').textContent = b ? shortModel(b.model) : 'اختر النموذج الثاني';
  el.input.placeholder = a && !on && isImgModel(a.ep, a.model) ? 'صف الصورة التي تريد توليدها…' : 'اكتب رسالتك... أو / للأوامر';
}
function runGen(c, pair, imgAM){
  if (imgAM) return generateImage(c, imgAM);
  const am = activeModel();
  if (!pair && !cmpActive() && am && isImgModel(am.ep, am.model)) return generateImage(c);
  return cmpActive() || pair ? generateCompare(c, pair || [activeModel(), cmpModel()]) : generate(c);
}
function cmpNode(m, { last = false, noanim = false, stream = false } = {}){
  const w = document.createElement('div');
  w.className = 'msg ai cmp-msg' + (noanim ? ' noanim' : '');
  if (stream) w.dataset.live = '1';
  w._m = m; w._raw = m.content;
  const grid = document.createElement('div'); grid.className = 'cmp';
  m.cmp.forEach((x, i) => {
    const col = document.createElement('div'); col.className = 'cmp-col'; col.dataset.i = i;
    col.innerHTML = `<div class="cmp-head"><div class="cmp-nm" dir="ltr"><b>${esc(shortModel(x.model))}</b><small>${esc(x.host || '')}</small></div><span class="cmp-st"></span></div><div class="bubble"></div><div class="cmp-acts"></div>`;
    grid.appendChild(col);
  });
  w.appendChild(grid);
  const foot = document.createElement('div'); foot.className = 'cmp-foot'; w.appendChild(foot);
  m.cmp.forEach((x, i) => paintCol(w, i, stream));
  refreshCmp(w, { last, stream });
  return w;
}
function paintCol(w, i, live){
  const x = w._m.cmp[i], col = w.querySelector(`.cmp-col[data-i="${i}"]`);
  if (!col) return;
  const b = col.querySelector('.bubble'), st = col.querySelector('.cmp-st');
  if (x.error) b.textContent = x.content;
  else if (live && !x.content && !x.thinking){ if (!b.querySelector('.typing')) b.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>'; }
  else paintBubble(b, x.thinking, x.content, !!live && !x.content, x.thinkSecs);
  st.classList.toggle('live', !!live);
  if (live) st.textContent = 'يكتب…';
}
function refreshCmp(w, { last, stream = false } = {}){
  const m = w._m;
  if (last === undefined) last = w === el.messages.lastElementChild;
  m.cmp.forEach((x, i) => {
    const col = w.querySelector(`.cmp-col[data-i="${i}"]`); if (!col) return;
    col.classList.toggle('picked', m.pick === i);
    col.classList.toggle('dim', m.pick != null && m.pick !== i);
    col.classList.toggle('err', !!x.error);
    if (!stream){
      const st = col.querySelector('.cmp-st');
      st.classList.remove('live');
      st.textContent = x.error ? 'خطأ' : x.stopped ? 'أُوقف' : x.ms ? (x.ms / 1000).toFixed(1) + ' ث' : '';
    }
    col.querySelector('.cmp-acts').innerHTML = (!stream && !x.error && x.content)
      ? `<button type="button" class="cmp-pick" data-pick="${i}">${m.pick === i ? ic('check') + ' معتمد' : 'اعتمد هذا الرد'}</button><button type="button" class="act" data-ccopy="${i}" title="نسخ">${ic('copy')}</button>`
      : '';
  });
  const f = w.querySelector('.cmp-foot');
  f.innerHTML = stream ? '' :
    (m.pick == null && m.cmp.some(x => !x.error && x.content) ? '<span>اختر الرد الذي تريد المتابعة منه</span>' : '') +
    (last ? `<button type="button" class="act" data-regen title="إعادة المقارنة">${ic('refresh')}</button>` : '');
}
function pickCmp(node, i){
  if (busy) return;
  const m = node._m; if (!m.cmp[i] || m.cmp[i].error) return;
  m.pick = i; m.content = m.cmp[i].content; save(); refreshCmp(node);
}
async function generateCompare(c, ams){
  const m = { role:'assistant', content:'', pick:null,
    cmp: ams.map(a => ({ ep:a.ep.id, model:a.model, host:hostOf(a.ep.url), content:'' })) };
  const node = cmpNode(m, { stream:true });
  el.messages.appendChild(node); scrollDown(true);
  setBusy(true); controller = new AbortController();
  await ensureImgs(c);
  const sig = controller.signal, hist = buildHistory(c);
  const run = async i => {
    const x = m.cmp[i], started = Date.now();
    let full = '', reason = '', raf = 0, t0 = 0, t1 = 0;
    const view = () => {
      const sp = splitThink(full), think = [reason, sp.think].filter(Boolean).join('\n\n');
      if (think && !t0) t0 = Date.now();
      if (sp.ans && t0 && !t1) t1 = Date.now();
      return { think, ans:sp.ans, live:!sp.ans && !!think, secs:t0 ? Math.max(1, Math.round(((t1 || Date.now()) - t0) / 1000)) : 0 };
    };
    const apply = v => { x.content = v.ans; if (v.think){ x.thinking = v.think; if (v.secs) x.thinkSecs = v.secs; } };
    const paint = () => { raf = 0; apply(view()); paintCol(node, i, true); scrollDown(); };
    try{
      for await (const chunk of callModel(hist, sig, c, ams[i])){
        if (typeof chunk === 'string') full += chunk; else reason += chunk.think;
        if (!raf) raf = requestAnimationFrame(paint);
      }
      if (raf) cancelAnimationFrame(raf);
      if (!full && !reason) throw new Error('لم يصل أي رد من النموذج. تأكد من صحة معرّف النموذج.');
      apply(view());
      if (!x.content) throw new Error('انتهى النموذج من التفكير دون إجابة نهائية.');
    }catch(err){
      if (raf) cancelAnimationFrame(raf);
      if (err.name === 'AbortError'){
        apply(view());
        if (x.content) x.stopped = true; else { x.error = true; x.content = 'تم الإيقاف'; delete x.thinking; delete x.thinkSecs; }
      } else {
        x.error = true; delete x.thinking; delete x.thinkSecs;
        x.content = err.message === 'Failed to fetch' ? 'تعذّر الاتصال. تحقق من الإنترنت أو من عنوان API.' : err.message;
      }
    }finally{
      x.ms = Date.now() - started;
      paintCol(node, i, false);
    }
  };
  try{ await Promise.all(m.cmp.map((x, i) => run(i))); }
  finally{ setBusy(false); controller = null; delete node.dataset.live; }

  const oks = m.cmp.map((x, i) => !x.error && x.content ? i : -1).filter(i => i >= 0);
  if (!oks.length && sig.aborted){
    node.remove();
    const u = c.messages.pop();
    if (u && u.vers && editFrom.has(u)) undoEdit(c, u);
    else if (u) restorePending(u);
    if (!c.messages.length){ chats = chats.filter(x => x !== c); currentId = null; }
    renderMessages(); save(); renderList(); toast('تم الإيقاف');
    return;
  }
  if (!oks.length){
    const final = { role:'assistant', error:true, content:m.cmp.map(x => shortModel(x.model) + ': ' + x.content).join('\n') };
    c.messages.push(final); node.replaceWith(msgNode(final, { last:true, noanim:true }));
  } else {
    m.pick = oks.length === 1 ? oks[0] : null;
    m.content = m.cmp[oks[0]].content;
    c.messages.push(m); refreshCmp(node, { last:true });
  }
  c.ts = Date.now(); save(); renderList(); scrollDown(true);
  if (oks.length && c.autoTitle && settings.autoTitle && c.messages.length === 2) makeTitle(c, ams[0]);
}
function toggleCompare(){
  cmpState.on = !cmpState.on;
  if (cmpState.on && !cmpModel()){
    const a = activeModel(); let cand = null;
    settings.endpoints.filter(x => x.enabled).forEach(ep => ep.models.forEach(md => {
      if (!cand && md.on && !(a && a.ep.id === ep.id && a.model === md.id)) cand = { ep:ep.id, model:md.id };
    }));
    if (cand) cmpState.sel = cand;
  }
  saveCmp(); updateModelLabels();
  if (cmpState.on && !cmpModel()){ popTarget = 'B'; openPop(); toast('اختر النموذج الثاني'); }
}

