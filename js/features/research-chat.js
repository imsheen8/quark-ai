/* QUARK AI — البحث العميق داخل المحادثة: مفتاح في قائمة (+) يحوّل الإرسال إلى بحث موثّق.
   يتضمن: أسئلة توضيحية للطلب الغامض أول مرة، والمتابعة من بحث سابق في نفس المحادثة. */
'use strict';
(() => {
  let on = store.get('ai_rs_chat', false) === true;
  const sync = () => {
    $('amRs')?.classList.toggle('on', on);
    if (on && !(activeModel() && isImgModel(activeModel().ep, activeModel().model))) el.input.placeholder = 'اكتب سؤالك البحثي…';
    else if (typeof updateCmpUI === 'function') updateCmpUI();
  };
  window.__rsChatOn = () => on;
  document.addEventListener('click', e => {
    const b = e.target.closest('#amRs'); if (!b) return;
    e.stopPropagation(); closeAttach();
    on = !on; store.set('ai_rs_chat', on); sync();
    toast(on ? 'البحث العميق: سيُجاب سؤالك ببحث في الويب وتقرير موثّق' : 'تم إيقاف البحث العميق');
  }, true);   /* طور الالتقاط: قائمة (+) توقف انتشار النقر قبل وصوله للمستند */
  const _um = updateModelLabels;
  updateModelLabels = function(){ _um(); sync(); };
  sync();

  const liveHTML = (p, secs) => `<div class="rs-live"><div class="rs-st"><span class="dot"></span><span>${esc(rsPhaseText(p))}</span><span style="margin-inline-start:auto;direction:ltr;color:var(--muted)">${rsClock(secs)}</span></div>` +
    `${p.query ? `<div class="rs-q" dir="auto">${esc(p.query)}</div>` : ''}<div class="rs-cnt"><span>${p.sources || 0} مصدرًا</span><span>${p.findings || 0} معلومة</span></div></div>`;

  const lastResearch = c => { for (let i = c.messages.length - 1; i >= 0; i--){ const r = c.messages[i].research; if (r && rsDB.get(r.id)) return rsDB.get(r.id); } return null; };

  async function needsClarify(am, q, signal){
    if (q.length > 140 || q.split(/\s+/).length > 14 || /https?:\/\//.test(q)) return null;
    try{
      const t = await rsAsk(am, { signal, max:350, user:`طلب بحث من مستخدم: «${q}»\nهل هو واضح بما يكفي لبدء بحث ويب مفيد؟ إن كان غامضًا جدًا (نطاق أو غرض أو معيار ناقص) اطرح سؤالين أو ثلاثة قصيرة للتوضيح بلغته. أجب بـ JSON فقط: {"clear":true|false,"questions":["سؤال"]}` });
      const j = rsJSON(t);
      if (j && j.clear === false && Array.isArray(j.questions) && j.questions.length) return j.questions.map(x => String(x).trim()).filter(Boolean).slice(0, 3);
    }catch(e){ if (e.name === 'AbortError') throw e; }
    return null;
  }
  async function focusQuery(am, orig, answer, signal){
    try{
      const t = await rsAsk(am, { signal, max:300, user:`الطلب الأصلي: «${orig}»\nإجابات المستخدم عن أسئلة التوضيح: «${answer}»\nاكتب سؤال بحث واحدًا مركّزًا ومحددًا يجمع كل ذلك، بلغة المستخدم، دون مقدمات. أجب بالسؤال فقط.` });
      const q = t.replace(/<think>[\s\S]*?<\/think>/gi, '').split('\n').map(x => x.trim()).find(Boolean) || '';
      if (q.length > 8) return q.replace(/^["«»]+|["«»]+$/g, '');
    }catch(e){ if (e.name === 'AbortError') throw e; }
    return orig + ' — ' + answer;
  }

  async function generateResearch(c){
    const am = rsAM();
    const node = msgNode({ role:'assistant', content:'' }, { stream:true }), bubble = node.querySelector('.bubble');
    const t0 = Date.now(); let prog = { phase:'planning' }, partial = '', raf = 0;
    const paint = () => { raf = 0; bubble.innerHTML = liveHTML(prog, Math.round((Date.now() - t0) / 1000)) + (partial ? `<div class="ans" style="margin-top:12px">${markdown(partial)}</div>` : ''); scrollDown(); };
    const timer = setInterval(() => { if (!raf) raf = requestAnimationFrame(paint); }, 1000);
    paint(); el.messages.appendChild(node); scrollDown(true);
    setBusy(true); controller = new AbortController();
    let final = null;
    try{
      if (!(await gwReady())) throw new Error('البحث العميق يتطلب البوابة (python3 serve.py أو تطبيق الأندرويد).');
      const um = c.messages[c.messages.length - 1];
      let q = um.content.trim();
      const pend = c.rsPending;
      if (pend){
        prog = { phase:'planning', query:'يصوغ سؤالًا مركّزًا…' }; paint();
        q = await focusQuery(am, pend.q, q, controller.signal); delete c.rsPending;
      } else if (!c.messages.some(m => m.research) && c.messages.filter(m => m.role === 'user').length === 1){
        const qs = await needsClarify(am, q, controller.signal);
        if (qs){ c.rsPending = { q }; final = { role:'assistant', model:shortModel(am.model), ts:Date.now(), content:'قبل أن أبدأ البحث، أحتاج توضيحًا بسيطًا:\n\n' + qs.map(x => '- ' + x).join('\n') + '\n\nأجبني وسأبدأ البحث فورًا.' }; }
      }
      if (!final){
        const prev = lastResearch(c);
        let prior = null;
        if (prev){ const sources = (prev.sources || []).map(s => ({ ...s })); prior = { report:prev.report.replace(/\n## المصادر[\s\S]*$/, ''), sources, findings:sources.map(s => ({ ...s, facts:[] })) }; }
        const res = await rsRun({ question:q, opts:{}, am, signal:controller.signal, prior,
          emit:p => { prog = { ...prog, ...p }; if (!raf) raf = requestAnimationFrame(paint); }, onText:full => { partial = full; if (!raf) raf = requestAnimationFrame(paint); } });
        const r = { id:uid(), q, title:rsTitleOf(q), report:res.report, sources:res.sources.map(s => ({ n:s.n, url:s.url, title:s.title, host:s.host, summary:s.summary, img:s.img || '' })),
          stats:res.stats, category:res.category, partial:!!res.partial, ts:Date.now(), model:shortModel(am.model), hidden:[], chat:c.id };
        if (prev) r.parent = prev.id;
        rsDB.put(r); window.__tkEmit?.('research');
        final = { role:'assistant', content:res.report, model:shortModel(am.model), ts:Date.now(), research:{ id:r.id, sources:res.stats.sources, secs:res.stats.secs } };
      }
    }catch(err){
      if (err.name === 'AbortError'){
        node.remove(); const u = c.messages.pop();
        if (u && u.vers && editFrom.has(u)) undoEdit(c, u); else if (u) restorePending(u);
        if (!c.messages.length){ chats = chats.filter(x => x !== c); currentId = null; }
        renderMessages(); toast('تم الإيقاف');
      } else final = { role:'assistant', error:true, content:err.message === 'Failed to fetch' ? 'تعذّر الاتصال. تحقق من الإنترنت أو من عنوان API.' : err.message };
    }finally{ clearInterval(timer); if (raf) cancelAnimationFrame(raf); setBusy(false); controller = null; }
    if (final){ c.messages.push(final); revealedMsgs.add(final); node.replaceWith(msgNode(final, { last:true, noanim:true })); }
    c.ts = Date.now(); save(); renderList(); scrollDown(true);
    if (final && !final.error && c.autoTitle && settings.autoTitle && c.messages.length === 2) makeTitle(c, am);
  }

  const _run = runGen;
  runGen = function(c, pair, imgAM){
    const am = rsAM();
    if (on && !pair && !imgAM && am && !(typeof cmpActive === 'function' && cmpActive())) return generateResearch(c);
    return _run(c, pair, imgAM);
  };
  window.__rsChatRun = generateResearch;

  /* شارة «بحث عميق» أسفل ردود البحث + فتح التقرير */
  window.__rsDecorate = (w, m) => {
    if (!m.research || w.querySelector('.rs-chip')) return;
    const b = w.querySelector('.bubble'); if (!b) return;
    const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'rs-chip'; chip.dataset.rsopen = m.research.id;
    chip.innerHTML = `${ic('globe')} بحث عميق <small>${m.research.sources || 0} مصدرًا${m.research.secs ? ' · ' + rsClock(m.research.secs) : ''}</small>`;
    b.appendChild(chip);
  };
  el.messages.addEventListener('click', e => {
    const b = e.target.closest('[data-rsopen]'); if (!b) return;
    if (rsDB.get(b.dataset.rsopen)) window.rsOpenReader(b.dataset.rsopen); else toast('التقرير محذوف من السجل');
  });
})();
