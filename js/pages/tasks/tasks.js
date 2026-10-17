/* QUARK AI — صفحة المهام: القائمة، النشاط، النتائج، نموذج الإنشاء/التعديل، السجل */
'use strict';
(() => {
  if (!$('tkList')) return;
  let q = '', chip = 'all', type = 'any', sort = store.get('ai_tk_sort', 'next'), selMode = false, rq = '', rmode = store.get('ai_tr_mode', 'any'), rsort = store.get('ai_tr_sort', 'recent'); const sel = new Set();
  let subv = store.get('ai_tk_sub', 'list'); if (!['list', 'results', 'act'].includes(subv)) subv = 'list';
  let aq = '';
  if (!['next', 'recent', 'name', 'runs'].includes(sort)) sort = 'next';
  if (!['any', 'unread'].includes(rmode)) rmode = 'any';
  if (!['recent', 'oldest'].includes(rsort)) rsort = 'recent';
  const fmtWhen = ts => ts ? new Date(ts).toLocaleString('ar', { weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
  const rel = ts => {
    const d = ts - Date.now(), a = Math.abs(d), m = Math.round(a / 60000), h = Math.round(a / 3600000), dd = Math.round(a / 86400000);
    const t = a < 60000 ? 'لحظات' : m < 60 ? `${m} د` : h < 48 ? `${h} س` : `${dd} يوم`;
    return d >= 0 ? 'بعد ' + t : 'منذ ' + t;
  };
  const dur = r => r.end ? rsClock(Math.max(0, Math.round((r.end - r.start) / 1000))) : '';
  const STL = { success:'نجحت', error:'فشلت', running:'قيد التنفيذ', aborted:'أُوقفت', skipped:'تخطّت', queued:'في الانتظار' };
  const taskIcon = t => ic(t.trigger.kind === 'event' ? 'refresh' : t.type === 'research' ? 'globe' : 'clock');

  /* ---------- القوائم ---------- */
  function taskCard(t){
    const live = tkRt.current?.task.id === t.id, queued = tkRt.queue.some(q => q.id === t.id);
    const next = t.status === 'active' && t.nextRun ? `التالي ${rel(t.nextRun)} (${fmtWhen(t.nextRun)})` : t.status === 'paused' ? 'متوقفة' : t.status === 'completed' ? 'اكتملت' : t.trigger.kind === 'event' ? `العدّاد ${t.trigger.counter || 0}/${t.trigger.count || 1}` : '';
    const last = t.lastRun ? `<span class="tk-st ${t.lastStatus}"><i></i>${STL[t.lastStatus] || ''} ${rel(t.lastRun)}</span>` : '<span class="tk-sub">لم تُنفَّذ بعد</span>';
    return `<div class="tk-card${t.status !== 'active' ? ' off' : ''}${sel.has(t.id) ? ' sel' : ''}" data-t="${t.id}">
      <div class="tk-row"><span class="tk-ico">${taskIcon(t)}</span><div class="tk-nm" dir="auto">${esc(t.name)}<div class="tk-sub">${esc(tkLabel(t))} · ${t.type === 'research' ? 'بحث عميق' : 'موجّه'}</div></div>
        ${selMode ? '' : `<button type="button" class="tk-sw${t.status === 'active' ? ' on' : ''}" data-a="toggle" aria-label="تفعيل/إيقاف"${t.status === 'completed' ? ' hidden' : ''}></button><button type="button" class="tk-more" data-a="menu" aria-label="المزيد">${ic('more')}</button>`}</div>
      <div class="tk-sub" dir="auto">${esc(rsCut(t.prompt, 110))}</div>
      <div class="rs-meta">${live ? '<span class="tk-st running"><i></i>قيد التنفيذ</span>' : queued ? '<span class="tk-st"><i></i>في الانتظار</span>' : last}<span>${esc(next)}</span></div></div>`;
  }
  const TSORT = {
    next:   (a, b) => (b.status === 'active' && !!b.nextRun) - (a.status === 'active' && !!a.nextRun) || (a.nextRun || 0) - (b.nextRun || 0) || (b.createdAt || 0) - (a.createdAt || 0),
    recent: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    name:   (a, b) => String(a.name).localeCompare(String(b.name), 'ar'),
    runs:   (a, b) => (b.runs || 0) - (a.runs || 0)
  };
  function filteredTasks(){
    const n = q.trim().toLowerCase();
    return tkDB.tasks().filter(t => (chip === 'all' || t.status === chip) && (type === 'any' || t.type === type) && (!n || (t.name + ' ' + t.prompt).toLowerCase().includes(n))).sort(TSORT[sort]);
  }
  function paintTasks(){
    const all = tkDB.tasks(), cnt = { all:all.length, active:0, paused:0, completed:0 };
    all.forEach(t => { cnt[t.status] = (cnt[t.status] || 0) + 1; });
    const sm = $('tkSummary'); if (sm) sm.textContent = all.length ? `${all.length} مهمة · ${cnt.active} نشطة${cnt.paused ? ` · ${cnt.paused} متوقفة` : ''}${cnt.completed ? ` · ${cnt.completed} مكتملة` : ''}` : '';
    const l = filteredTasks();
    $('tkList').innerHTML = l.length ? l.map(taskCard).join('') : `<div class="rs-empty">${all.length ? 'لا مهام مطابقة.' : 'لا توجد مهام بعد.<br>اضغط + لإنشاء مهمة تعمل تلقائيًا.'}</div>`;
    const anyActive = all.some(t => t.status === 'active'), pa = $('tkPauseAll');
    if (pa){ pa.textContent = anyActive ? 'إيقاف كل المهام' : 'استئناف المهام'; pa.hidden = !all.length; }
    window.__libSync?.();
    const as = $('tkActSummary'); if (as) as.textContent = all.length ? `${all.length} مهمة · ${cnt.active} نشطة · ${tkUnread()} نتيجة غير مقروءة` : 'لا توجد مهام بعد. أنشئ مهمة من تبويب «المهام».';
  }
  function runCard(r, full){
    const t = tkDB.task(r.taskId), live = r.status === 'running';
    const ph = live && r.progress ? rsPhaseText(r.progress) : '';
    return `<div class="tk-card${r.unread && r.status === 'success' ? ' unread' : ''}" data-r="${r.id}"><div class="tk-row"><span class="tk-ico">${ic(r.type === 'research' ? 'globe' : 'clock')}</span>
      <div class="tk-nm" dir="auto">${esc(r.taskName)}<div class="tk-sub">${fmtWhen(r.start)}${dur(r) ? ' · ' + dur(r) : ''} · ${{ schedule:'مجدولة', manual:'يدوية', event:'حدث', chain:'تسلسل' }[r.trigger] || ''}</div></div>
      <span class="tk-st ${r.status}"><i></i>${STL[r.status] || r.status}</span></div>
      ${live ? `<div class="rs-q" style="white-space:normal">${esc(ph || 'جارٍ العمل…')}</div><div class="rs-acts"><button class="lib-btn" data-a="stop">إيقاف</button></div>` : ''}
      ${r.status === 'error' || r.status === 'aborted' ? `<div class="rs-q" style="white-space:normal;color:var(--danger,#e5484d)">${esc(r.error)}</div>` : ''}
      ${r.status === 'success' && full ? `<div class="tk-out" dir="auto">${esc(rsCut(r.output.replace(/[#*>`]/g, ''), 400))}</div>` : ''}</div>`;
  }
  function paintActivity(){
    const cur = tkRt.current, queued = tkRt.queue.map(q => tkDB.task(q.id)).filter(Boolean);
    const n = aq.trim().toLowerCase(), recent = tkDB.runs().filter(r => !n || r.taskName.toLowerCase().includes(n)).slice(0, 40);
    $('tkActList').innerHTML = (queued.length ? `<div class="tk-sub">في الانتظار: ${queued.map(t => esc(t.name)).join('، ')}</div>` : '') + (recent.length ? recent.map(r => runCard(r, false)).join('') : '<div class="rs-empty">لا نشاط بعد.</div>');
  }
  const okRuns = () => tkDB.runs().filter(r => r.status === 'success');
  function filteredResults(){
    const n = rq.trim().toLowerCase();
    return okRuns().filter(r => (rmode === 'any' || r.unread) && (!n || (r.taskName + ' ' + r.output).toLowerCase().includes(n))).sort((a, b) => rsort === 'oldest' ? a.start - b.start : b.start - a.start);
  }
  function paintResults(){
    const all = okRuns(), un = all.filter(r => r.unread).length, l = filteredResults();
    $('tkResN').textContent = all.length ? `${all.length} نتيجة${un ? ` · ${un} غير مقروءة` : ''}` : '';
    $('tkReadAll').hidden = !un;
    $('tkResList').innerHTML = l.length ? l.map(r => runCard(r, true)).join('') : `<div class="rs-empty">${all.length ? 'لا نتائج مطابقة.' : 'لا نتائج بعد. ستظهر هنا مخرجات المهام.'}</div>`;
  }
  function paint(){
    const un = tkUnread();
    const nb = $('navTkBadge'); if (nb){ nb.hidden = !un; nb.textContent = un; }
    const rd = $('tkResDot'); if (rd){ rd.hidden = !un; rd.textContent = un; }
    paintTasks(); paintActivity(); paintResults(); window.__libCounts?.();
  }
  tkRt.listeners.add(paint);
  window.__tkRefresh = paint;
  window.__tkWatching = () => mainEl.classList.contains('lib-open') && window.__libTab?.() === 'tasks';

  /* ---------- إجراءات ---------- */
  function pause(t){ t.status = 'paused'; t.nextRun = null; tkDB.saveTasks(); }
  function resume(t){ t.status = 'active'; t.fails = 0; t.nextRun = t.trigger.kind === 'schedule' ? tkNext(t) : null; tkDB.saveTasks(); setTimeout(tkTick, 300); }
  async function delTasks(ids){
    if (!await qConfirm(ids.length > 1 ? `حذف ${ids.length} مهام وسجلها نهائيًا؟` : 'حذف هذه المهمة وسجلها نهائيًا؟', { ok:'حذف' })) return false;
    ids.forEach(id => { if (tkRt.current?.task.id === id) tkStop(); }); tkDB.delTasks(ids); sel.clear(); selMode = false; paint(); toast('تم الحذف'); return true;
  }
  function openChat(id){ if (!chats.some(c => c.id === id)){ toast('المحادثة محذوفة'); return; } currentId = id; incog = false; save(); showChatView(); renderAll(); }
  function runToChat(r){
    if (r.chatId && chats.some(c => c.id === r.chatId)) return openChat(r.chatId);
    const t = tkDB.task(r.taskId);
    const c = { id:uid(), title:'[مهمة] ' + r.taskName, ts:Date.now(), messages:[{ role:'user', content:t?.prompt || r.taskName }, { role:'assistant', content:r.output, ts:Date.now(), ...(r.researchId ? { research:{ id:r.researchId, sources:0, secs:0 } } : {}) }] };
    chats.unshift(c); r.chatId = c.id; tkDB.saveRuns(); save(); openChat(c.id);
  }
  function openResult(r){
    r.unread = false; tkDB.saveRuns(); paint();
    const ov = document.createElement('div'); ov.className = 'rs-ov';
    ov.innerHTML = `<div class="rs-ovh"><button class="lib-ib" data-x aria-label="إغلاق">${ic('x')}</button><h3 dir="auto">${esc(r.taskName)}</h3><button class="lib-ib" data-copy title="نسخ">${ic('copy')}</button></div>
      <div class="rs-ovb"><div class="rs-doc"><div class="rs-meta" style="margin-bottom:10px"><span>${fmtWhen(r.start)}</span><span>${dur(r)}</span></div><div class="ans"></div></div>
      <div class="rs-foot"><button class="lib-btn pri" data-a="chat">فتح في محادثة</button>${r.researchId && rsDB.get(r.researchId) ? '<button class="lib-btn" data-a="report">فتح تقرير البحث</button>' : ''}<button class="lib-btn danger" data-a="del">حذف النتيجة</button></div></div>`;
    ov.querySelector('.ans').innerHTML = markdown(r.output);
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', async e => {
      if (e.target.closest('[data-x]')) return close();
      if (e.target.closest('[data-copy]')){ try{ await navigator.clipboard.writeText(r.output); toast('تم النسخ'); }catch{ toast('تعذّر النسخ'); } return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'chat'){ close(); runToChat(r); }
      else if (a === 'report') window.rsOpenReader(r.researchId);
      else if (a === 'del'){ tkDB.delRuns(r.id); close(); paint(); }
    });
    document.body.appendChild(ov);
  }
  function openHistory(t){
    const runs = tkDB.runs().filter(r => r.taskId === t.id).slice(0, 30);
    const ov = document.createElement('div'); ov.className = 'rs-ov';
    ov.innerHTML = `<div class="rs-ovh"><button class="lib-ib" data-x aria-label="إغلاق">${ic('x')}</button><h3 dir="auto">سجل: ${esc(t.name)}</h3></div><div class="rs-ovb"><div class="tk-hist">${runs.length ? runs.map(r => runCard(r, true)).join('') : '<div class="rs-empty">لا تشغيلات بعد.</div>'}</div></div>`;
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', e => { if (e.target.closest('[data-x]')) return close(); const c = e.target.closest('[data-r]'); const r = c && tkDB.runs().find(x => x.id === c.dataset.r); if (r && r.status === 'success'){ close(); openResult(r); } });
    document.body.appendChild(ov);
  }
  function menu(anchor, items){
    document.querySelectorAll('.tk-menu').forEach(m => m.remove());
    const m = document.createElement('div'); m.className = 'tk-menu';
    m.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}"${it.d ? ' class="dng"' : ''}>${esc(it.l)}</button>`).join('');
    const r = anchor.getBoundingClientRect(); document.body.appendChild(m);
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.top = Math.min(innerHeight - h - 10, r.bottom + 4) + 'px'; m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px';
    const off = e => { if (!m.contains(e.target)){ m.remove(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
    m.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; m.remove(); document.removeEventListener('pointerdown', off, true); items[+b.dataset.i].f(); });
  }

  /* ---------- القوالب ---------- */
  const PRESETS = [
    { l:'ملخص أخبار صباحي', d:'بحث عميق كل صباح', o:{ name:'ملخص أخبار صباحي', type:'research', prompt:'لخّص أهم أخبار اليوم في التقنية والعالم مع المصادر.', schedule:{ mode:'daily', time:'07:30' }, research:{ rounds:3, category:'' } } },
    { l:'متابعة أسبوعية لموضوع', d:'بحث عميق كل أسبوع', o:{ name:'متابعة أسبوعية', type:'research', prompt:'ما الجديد هذا الأسبوع في الذكاء الاصطناعي؟', schedule:{ mode:'weekly', time:'09:00', days:[1] }, research:{ rounds:0, category:'' } } },
    { l:'تحفيز يومي', d:'رسالة قصيرة كل صباح', o:{ name:'تحفيز يومي', type:'prompt', prompt:'اكتب لي رسالة تحفيزية قصيرة ومختلفة لهذا اليوم.', schedule:{ mode:'daily', time:'08:00' } } },
    { l:'مراجعة نهاية الأسبوع', d:'أسئلة تأمل كل جمعة', o:{ name:'مراجعة الأسبوع', type:'prompt', prompt:'اطرح عليّ 5 أسئلة تأمل لمراجعة أسبوعي وتخطيط الأسبوع القادم.', schedule:{ mode:'weekly', time:'18:00', days:[5] } } },
    { l:'بعد كل بحث عميق', d:'يقترح أسئلة متابعة', o:{ name:'اقتراحات بعد البحث', type:'prompt', prompt:'اقترح 5 مواضيع بحثية متقدمة مرتبطة باهتماماتي في التقنية.', trigger:{ kind:'event', name:'research', count:3 } } },
    { l:'مهمة مخصصة', d:'ابدأ من الصفر', o:{} },
  ];

  /* ---------- النموذج ---------- */
  function mergeDraft(base, o){ const t = tkNewTask(base); Object.assign(t, o); t.trigger = { ...t.trigger, ...(o.trigger || {}) }; t.schedule = { ...t.schedule, ...(o.schedule || {}) }; t.research = { ...t.research, ...(o.research || {}) }; return t; }
  function openForm(existing, draft){
    const f = existing ? JSON.parse(JSON.stringify(existing)) : (draft || tkNewTask());
    if (!f.schedule.date){ const d = new Date(Date.now() + 3600000); f.schedule.date = `${d.getFullYear()}-${tkPad(d.getMonth() + 1)}-${tkPad(d.getDate())}`; }
    const ov = document.createElement('div'); ov.className = 'rs-ov';
    ov.innerHTML = `<div class="rs-ovh"><button class="lib-ib" data-x aria-label="إغلاق">${ic('x')}</button><h3>${existing ? 'تعديل المهمة' : 'مهمة جديدة'}</h3><button class="lib-btn pri" data-save style="height:38px;padding:0 18px">حفظ</button></div><div class="rs-ovb"><div class="tk-form" id="tkF"></div></div>`;
    const root = ov.querySelector('#tkF'), g = id => root.querySelector('#' + id);
    const seg = (key, opts, cur) => `<div class="tk-seg" data-seg="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const models = '<option value="">نموذج المحادثة الحالي</option>' + settings.endpoints.filter(e => e.enabled).map(ep => { const ms = ep.models.filter(m => m.on && !isImgModel(ep, m.id)); return ms.length ? `<optgroup label="${esc(hostOf(ep.url))}">${ms.map(m => `<option value="${esc(ep.id + '|' + m.id)}">${esc(shortModel(m.id))}</option>`).join('')}</optgroup>` : ''; }).join('');
    const others = tkDB.tasks().filter(t => t.id !== f.id).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    function collect(){
      if (!g('tkName')) return;
      f.name = g('tkName').value.trim(); f.prompt = g('tkPrompt').value; if (g('tkInst')) f.instructions = g('tkInst').value;
      const sm = g('tkModel').value, i = sm.indexOf('|'); f.model = i > 0 ? { ep:sm.slice(0, i), model:sm.slice(i + 1) } : null;
      f.output = g('tkOut').value; f.then = g('tkThen').value || null;
      const s = f.schedule;
      if (g('tkTime')) s.time = g('tkTime').value || s.time;
      if (g('tkDate')) s.date = g('tkDate').value;
      if (g('tkEvery')) s.every = Math.max(1, Math.round(Number(g('tkEvery').value) || 1)) * Number(g('tkUnit').value);
      if (g('tkDom')) s.day = Math.min(31, Math.max(1, Math.round(Number(g('tkDom').value) || 1)));
      if (g('tkCron')) s.cron = g('tkCron').value.trim();
      if (g('tkEvN')){ f.trigger.name = g('tkEvN').value; f.trigger.count = Math.max(1, Math.round(Number(g('tkEvC').value) || 1)); }
      if (g('tkRounds')){ f.research.rounds = Number(g('tkRounds').value) || 0; f.research.category = g('tkCat').value; }
    }
    function preview(){
      collect(); const el2 = g('tkNextP'); if (!el2) return;
      if (f.trigger.kind === 'event'){ el2.textContent = 'تُنفَّذ عند اكتمال العدّاد: ' + tkLabel(f); return; }
      if (f.schedule.mode === 'cron' && !tkCronParse(f.schedule.cron)){ el2.textContent = 'تعبير Cron غير صالح (5 حقول: دقيقة ساعة يوم شهر يوم-أسبوع).'; return; }
      const n = tkNext(f); el2.textContent = n ? `التنفيذ التالي: ${fmtWhen(n)} (${rel(n)})` : 'لا موعد قادم — راجع الإعدادات.';
    }
    function paintForm(){
      const s = f.schedule, ev = f.trigger.kind === 'event', unitMin = s.every % 60 === 0 && s.every >= 60;
      root.innerHTML = `
        <div class="tk-ai"><input class="fld" id="tkAiIn" type="text" placeholder="صِف المهمة بكلماتك: كل يوم 7 صباحًا لخّص أخبار التقنية" autocomplete="off"><button type="button" class="lib-btn" id="tkAiBtn" style="height:42px">صياغة بالذكاء</button></div>
        <label><small>الاسم</small><input class="fld" id="tkName" type="text" maxlength="80" value="${esc(f.name)}"></label>
        <div><small style="font-weight:600;color:var(--text-2)">نوع المهمة</small>${seg('type', [['prompt', 'موجّه للنموذج'], ['research', 'بحث عميق']], f.type)}</div>
        <label><small>${f.type === 'research' ? 'سؤال البحث' : 'نص المهمة (الموجّه)'}</small><textarea id="tkPrompt" placeholder="${f.type === 'research' ? 'ما الذي تريد البحث عنه كل مرة؟' : 'ماذا تريد من النموذج أن يفعل عند كل تشغيل؟'}">${esc(f.prompt)}</textarea></label>
        ${f.type === 'prompt' ? `<label><small>تعليمات إضافية (اختياري)</small><textarea id="tkInst" style="min-height:64px" placeholder="الأسلوب، اللغة، الصيغة…">${esc(f.instructions)}</textarea></label>` : `<div class="tk-g2"><label><small>عدد الجولات</small><select class="fld" id="tkRounds"><option value="0">تلقائي</option>${Array.from({ length:10 }, (_, i) => `<option value="${i + 1}"${f.research.rounds === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('')}</select></label><label><small>شكل التقرير</small><select class="fld" id="tkCat">${[['', 'تلقائي'], ['product', 'منتج'], ['comparison', 'مقارنة'], ['howto', 'دليل خطوات'], ['factcheck', 'تدقيق']].map(([v, l]) => `<option value="${v}"${f.research.category === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>`}
        <div><small style="font-weight:600;color:var(--text-2)">المشغّل</small>${seg('trig', [['schedule', 'جدول زمني'], ['event', 'حدث']], f.trigger.kind)}</div>
        ${ev ? `<div class="tk-g2"><label><small>الحدث</small><select class="fld" id="tkEvN">${[['message', 'رسالة تُرسل'], ['chat', 'محادثة جديدة'], ['research', 'بحث عميق يكتمل']].map(([v, l]) => `<option value="${v}"${f.trigger.name === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label><label><small>كل (عدد المرات)</small><input class="fld" id="tkEvC" type="number" min="1" value="${f.trigger.count || 1}"></label></div>` : `
        <div>${seg('mode', [['once', 'مرة'], ['interval', 'كل فترة'], ['daily', 'يوميًا'], ['weekly', 'أسبوعيًا'], ['monthly', 'شهريًا'], ['cron', 'Cron']], s.mode)}</div>
        ${s.mode === 'once' ? `<div class="tk-g2"><label><small>التاريخ</small><input class="fld" id="tkDate" type="date" value="${esc(s.date)}"></label><label><small>الوقت</small><input class="fld" id="tkTime" type="time" value="${esc(s.time)}"></label></div>` : ''}
        ${s.mode === 'interval' ? `<div class="tk-g2"><label><small>كل</small><input class="fld" id="tkEvery" type="number" min="1" value="${unitMin ? s.every / 60 : s.every}"></label><label><small>الوحدة</small><select class="fld" id="tkUnit"><option value="1"${unitMin ? '' : ' selected'}>دقيقة</option><option value="60"${unitMin ? ' selected' : ''}>ساعة</option></select></label></div>` : ''}
        ${s.mode === 'daily' ? `<label><small>الوقت</small><input class="fld" id="tkTime" type="time" value="${esc(s.time)}"></label>` : ''}
        ${s.mode === 'weekly' ? `<div><small style="font-weight:600;color:var(--text-2)">الأيام</small><div class="tk-seg tk-days" data-seg="days">${TK_DAYS.map((d, i) => `<button type="button" data-v="${i}" class="${(s.days || []).includes(i) ? 'on' : ''}" title="${d}">${d.slice(0, 3)}</button>`).join('')}</div></div><label><small>الوقت</small><input class="fld" id="tkTime" type="time" value="${esc(s.time)}"></label>` : ''}
        ${s.mode === 'monthly' ? `<div class="tk-g2"><label><small>يوم الشهر</small><input class="fld" id="tkDom" type="number" min="1" max="31" value="${s.day || 1}"></label><label><small>الوقت</small><input class="fld" id="tkTime" type="time" value="${esc(s.time)}"></label></div>` : ''}
        ${s.mode === 'cron' ? `<label><small>تعبير Cron (دقيقة ساعة يوم شهر يوم-أسبوع)</small><input class="fld" id="tkCron" type="text" dir="ltr" spellcheck="false" value="${esc(s.cron)}" placeholder="0 9 * * 1-5"></label>` : ''}`}
        <div class="tk-next" id="tkNextP"></div>
        <div class="tk-g2"><label><small>النموذج</small><select class="fld" id="tkModel">${models}</select></label><label><small>المخرجات</small><select class="fld" id="tkOut"><option value="chat"${f.output === 'chat' ? ' selected' : ''}>محادثة جديدة لكل تشغيل</option><option value="thread"${f.output === 'thread' ? ' selected' : ''}>محادثة واحدة تتراكم</option><option value="notification"${f.output === 'notification' ? ' selected' : ''}>إشعار ونتيجة فقط</option></select></label></div>
        <label><small>بعد النجاح شغّل مهمة أخرى (اختياري)</small><select class="fld" id="tkThen"><option value="">لا شيء</option>${others}</select></label>`;
      g('tkModel').value = f.model ? f.model.ep + '|' + f.model.model : ''; g('tkThen').value = f.then || '';
      preview();
    }
    paintForm();
    root.addEventListener('input', preview); root.addEventListener('change', preview);
    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-seg] button'); 
      if (b){
        collect(); const key = b.closest('[data-seg]').dataset.seg, v = b.dataset.v;
        if (key === 'type') f.type = v; else if (key === 'trig') f.trigger.kind = v; else if (key === 'mode') f.schedule.mode = v;
        else if (key === 'days'){ const d = Number(v), a = f.schedule.days || []; f.schedule.days = a.includes(d) ? a.filter(x => x !== d) : [...a, d].sort(); }
        paintForm(); return;
      }
      if (e.target.closest('#tkAiBtn')){
        const txt = g('tkAiIn').value.trim(); if (!txt) return; const btn = g('tkAiBtn'); btn.disabled = true; btn.textContent = '…';
        try{ const d = await draftFromText(txt); collect(); f.name = d.name || f.name; f.type = d.type; f.prompt = d.prompt; f.trigger = { ...f.trigger, ...d.trigger }; f.schedule = { ...f.schedule, ...d.schedule }; if (d.output) f.output = d.output; paintForm(); toast('تمت الصياغة — راجع الحقول ثم احفظ'); }
        catch(err){ toast('تعذّرت الصياغة: ' + err.message); btn.disabled = false; btn.textContent = 'صياغة بالذكاء'; }
      }
    });
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.querySelector('[data-x]').addEventListener('click', close);
    ov.querySelector('[data-save]').addEventListener('click', () => {
      collect();
      if (!f.name){ toast('أدخل اسمًا للمهمة'); return; }
      if (!f.prompt.trim()){ toast('أدخل نص المهمة'); return; }
      if (f.trigger.kind === 'schedule'){
        const s = f.schedule;
        if (s.mode === 'once' && !s.date){ toast('اختر التاريخ'); return; }
        if (s.mode === 'weekly' && !(s.days || []).length){ toast('اختر يومًا واحدًا على الأقل'); return; }
        if (s.mode === 'cron' && !tkCronParse(s.cron)){ toast('تعبير Cron غير صالح'); return; }
        if (!tkNext(f)){ toast('تعذّر حساب موعد التنفيذ'); return; }
      }
      if (f.type === 'research' && !(f.model || rsAM())){ toast('اختر نموذجًا أولًا'); return; }
      if (f.status === 'completed' || (existing && f.status === 'active')) f.status = 'active';
      f.nextRun = f.status === 'active' && f.trigger.kind === 'schedule' ? tkNext(f) : null;
      if (f.trigger.kind === 'event') f.trigger.counter = 0;
      if (existing) Object.assign(existing, f); else tkDB.addTask(f);
      tkDB.saveTasks(); try{ if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }catch{}
      close(); paint(); toast(existing ? 'تم حفظ التعديلات' : 'تم إنشاء المهمة'); setTimeout(tkTick, 300);
    });
    document.body.appendChild(ov);
  }

  /* صياغة مهمة من وصف حر */
  async function draftFromText(text){
    const am = activeModel(); if (!am) throw new Error('لا يوجد نموذج');
    const ask = async o => { try{ return await rsAsk(am, o); }catch(e){ if (e.name === 'AbortError') throw e; let r = ''; for await (const ch of callModel([{ role:'user', content:o.system + '\n\n' + o.user }], new AbortController().signal, null, am)){ if (typeof ch === 'string') r += ch; } return splitThink(r).ans; } };
    const raw = await ask({ system:'أنت مساعد يحوّل وصف مهمة مجدولة إلى JSON فقط.', max:700, user:
      `الوصف: «${text}»\nأعد JSON فقط بالمفاتيح: {"name":"اسم قصير","type":"prompt|research","prompt":"نص المهمة الكامل بصيغة أمر واضح","trigger":"schedule|event","mode":"once|interval|daily|weekly|monthly|cron","time":"HH:MM","date":"YYYY-MM-DD أو فارغ","every":عدد_دقائق,"days":[أرقام الأيام 0=الأحد…6=السبت],"day":يوم_الشهر,"cron":"","event":"message|chat|research","count":عدد,"output":"chat|thread|notification"}\nاستخدم type=research إن كانت المهمة تحتاج بحثًا في الويب، وإلا prompt. التاريخ اليوم ${new Date().toISOString().slice(0, 10)}.` });
    const j = rsJSON(raw); if (!j || typeof j !== 'object' || Array.isArray(j) || !j.prompt) throw new Error('رد غير مفهوم');
    const ok = (v, a, d) => a.includes(v) ? v : d;
    return { name:rsCut(String(j.name || ''), 60), type:ok(j.type, ['prompt', 'research'], 'prompt'), prompt:String(j.prompt), output:ok(j.output, ['chat', 'thread', 'notification'], ''),
      trigger:{ kind:ok(j.trigger, ['schedule', 'event'], 'schedule'), name:ok(j.event, ['message', 'chat', 'research'], 'message'), count:Math.max(1, Math.round(Number(j.count) || 1)) },
      schedule:{ mode:ok(j.mode, ['once', 'interval', 'daily', 'weekly', 'monthly', 'cron'], 'daily'), time:/^\d{1,2}:\d{2}$/.test(j.time || '') ? j.time.padStart(5, '0') : '09:00', date:/^\d{4}-\d{2}-\d{2}$/.test(j.date || '') ? j.date : '',
        every:Math.max(1, Math.round(Number(j.every) || 60)), days:Array.isArray(j.days) ? j.days.map(Number).filter(n => n >= 0 && n <= 6) : [1], day:Math.min(31, Math.max(1, Math.round(Number(j.day) || 1))), cron:tkCronParse(j.cron) ? String(j.cron) : '0 9 * * *' } };
  }

  function presetPicker(){
    const ov = document.createElement('div'); ov.className = 'rs-ov';
    ov.innerHTML = `<div class="rs-ovh"><button class="lib-ib" data-x aria-label="إغلاق">${ic('x')}</button><h3>مهمة جديدة</h3></div><div class="rs-ovb"><div class="tk-hist"><div class="tk-sub">اختر قالبًا للبدء، ويمكنك تعديل كل شيء بعدها.</div>${PRESETS.map((p, i) => `<button type="button" class="tk-pre" data-p="${i}"><b>${esc(p.l)}</b><span>${esc(p.d)}</span></button>`).join('')}</div></div>`;
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', e => { if (e.target.closest('[data-x]')) return close(); const b = e.target.closest('[data-p]'); if (b){ close(); openForm(null, mergeDraft({}, PRESETS[+b.dataset.p].o)); } });
    document.body.appendChild(ov);
  }

  /* ---------- الأحداث ---------- */
  const pauseAll = () => {
    const ts = tkDB.tasks(), act = ts.filter(t => t.status === 'active');
    if (act.length){ act.forEach(pause); toast('أُوقفت كل المهام'); } else { ts.filter(t => t.status === 'paused').forEach(resume); toast('استؤنفت المهام'); }
    paint();
  };
  $('tkPauseAll').addEventListener('click', pauseAll);
  $('tkReadAll').addEventListener('click', () => { tkDB.runs().forEach(r => { r.unread = false; }); tkDB.saveRuns(); paint(); });
  $('tkList').addEventListener('click', e => {
    const card = e.target.closest('[data-t]'); if (!card) return;
    const t = tkDB.task(card.dataset.t); if (!t) return;
    if (selMode){ sel.has(t.id) ? sel.delete(t.id) : sel.add(t.id); paintTasks(); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'toggle'){ t.status === 'active' ? pause(t) : resume(t); paint(); return; }
    if (a === 'menu'){
      menu(e.target.closest('[data-a]'), [
        { l:'تشغيل الآن', f:() => { tkRunNow(t.id); toast('أُضيفت للتنفيذ — تابعها في تبويب «النشاط»'); paint(); setSub('act'); } },
        { l:'تعديل', f:() => openForm(t) }, { l:'السجل', f:() => openHistory(t) },
        { l:'تكرار', f:() => { const c = JSON.parse(JSON.stringify(t)); c.id = uid(); c.name += ' (نسخة)'; c.runs = 0; c.lastRun = 0; c.lastStatus = ''; c.chatId = null; c.createdAt = Date.now(); c.nextRun = c.status === 'active' && c.trigger.kind === 'schedule' ? tkNext(c) : null; tkDB.addTask(c); paint(); } },
        { l:'تحديد متعدد', f:() => { selMode = true; sel.clear(); sel.add(t.id); paintTasks(); window.__libSetMulti?.(true); } },
        { l:'حذف', d:true, f:() => delTasks([t.id]) }]);
      return;
    }
    openForm(t);
  });
  $('tkActList').addEventListener('click', e => {
    const c = e.target.closest('[data-r]'); if (!c) return;
    if (e.target.closest('[data-a="stop"]')){ tkStop(); return; }
    const r = tkDB.runs().find(x => x.id === c.dataset.r); if (r && r.status === 'success') openResult(r);
  });
  $('tkResList').addEventListener('click', e => { const c = e.target.closest('[data-r]'); const r = c && tkDB.runs().find(x => x.id === c.dataset.r); if (r) openResult(r); });

  /* ---------- أقسام التبويب الواحد: المهام · النتائج · النشاط ---------- */
  function paintSub(){
    $('tkSeg').querySelectorAll('[data-sub]').forEach(b => { const on = b.dataset.sub === subv; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $('tkTasksView').querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== subv; });
  }
  function setSub(v){
    if (!['list', 'results', 'act'].includes(v)) v = 'list';
    if (v !== subv){ selMode = false; sel.clear(); }
    subv = v; store.set('ai_tk_sub', v); paintSub(); paint();
    window.__libRefresh?.(); window.__syncHash?.();
  }
  $('tkSeg').addEventListener('click', e => { const b = e.target.closest('[data-sub]'); if (b) setSub(b.dataset.sub); });
  paintSub();

  /* ---------- واجهة رأس المكتبة: تتبع القسم الحالي ---------- */
  const STAT = [['all', 'الكل'], ['active', 'نشطة'], ['paused', 'متوقفة'], ['completed', 'مكتملة']];
  const listApi = {
    setQuery(v){ if (v !== q){ q = v; paintTasks(); } },
    setMulti(on){ if (selMode !== !!on || sel.size){ selMode = !!on; sel.clear(); paintTasks(); } },
    selCount: () => sel.size,
    allSelected(){ const l = filteredTasks(); return !!l.length && l.every(t => sel.has(t.id)); },
    selectAll(){ const l = filteredTasks(), every = l.length && l.every(t => sel.has(t.id)); l.forEach(t => every ? sel.delete(t.id) : sel.add(t.id)); paintTasks(); window.__libSync?.(); },
    async remove(){ return sel.size ? await delTasks([...sel]) : false; },
    addMenu: anchor => menu(anchor, [{ l:'مهمة جديدة', f:presetPicker }, { l:tkDB.tasks().some(t => t.status === 'active') ? 'إيقاف كل المهام' : 'استئناف المهام', f:pauseAll }]),
    refresh: () => paintTasks(),
    groups(){
      const all = tkDB.tasks(), cnt = { all:all.length }; all.forEach(t => { cnt[t.status] = (cnt[t.status] || 0) + 1; });
      return [
        { h:'الترتيب', opts:[['next', 'الأقرب تنفيذًا', 'clock'], ['recent', 'الأحدث', 'calendar'], ['name', 'الاسم', 'pen'], ['runs', 'الأكثر تشغيلًا', 'flame']], val:() => sort, set:v => { sort = v; store.set('ai_tk_sort', v); paintTasks(); }, def:'next' },
        { h:'الحالة', opts:STAT.map(([k, l]) => [k, `${l} · ${cnt[k] || 0}`, k === 'all' ? 'layers' : k === 'active' ? 'play' : k === 'paused' ? 'pause' : 'check']), val:() => chip, set:v => { chip = v; paintTasks(); }, def:'all' },
        { h:'النوع', opts:[['any', 'كل الأنواع', 'layers'], ['prompt', 'موجّهة', 'message'], ['research', 'بحث عميق', 'globe']], val:() => type, set:v => { type = v; paintTasks(); }, def:'any' }];
    }
  };
  const resApi = {
    setQuery(v){ if (v !== rq){ rq = v; paintResults(); } },
    refresh: () => paintResults(),
    groups(){
      const all = okRuns(), un = all.filter(r => r.unread).length;
      return [
        { h:'الترتيب', opts:[['recent', 'الأحدث', 'clock'], ['oldest', 'الأقدم', 'calendar']], val:() => rsort, set:v => { rsort = v; store.set('ai_tr_sort', v); paintResults(); }, def:'recent' },
        { h:'الحالة', opts:[['any', `كل النتائج · ${all.length}`, 'layers'], ['unread', `غير المقروءة · ${un}`, 'eye']], val:() => rmode, set:v => { rmode = v; store.set('ai_tr_mode', v); paintResults(); }, def:'any' }];
    }
  };
  const actApi = {
    setQuery(v){ if (v !== aq){ aq = v; paintActivity(); } },
    refresh: () => paintActivity(),
    groups: () => []
  };
  /* واجهة واحدة للمكتبة: القدرات (تحديد متعدد، إضافة) تظهر فقط في قسم «المهام» */
  const cur = () => subv === 'results' ? resApi : subv === 'act' ? actApi : listApi;
  const none = () => {};
  window.__tkApi = {
    setQuery: v => { listApi.setQuery(v); resApi.setQuery(v); actApi.setQuery(v); },
    refresh: () => { paintSub(); cur().refresh(); },
    count: () => tkDB.tasks().length,
    groups: () => cur().groups(),
    get setMulti(){ return subv === 'list' ? listApi.setMulti : undefined; },
    get addMenu(){ return subv === 'list' ? listApi.addMenu : undefined; },
    selCount: () => subv === 'list' ? listApi.selCount() : 0,
    allSelected: () => subv === 'list' && listApi.allSelected(),
    selectAll: () => subv === 'list' ? listApi.selectAll() : none(),
    remove: () => subv === 'list' ? listApi.remove() : false
  };
  window.__tkSubName = () => subv;
  window.__tkSetSub = setSub;
  /* المكان الوحيد للمهام: المكتبة ← المهام (القسم اختياري: list | results | act) */
  window.__openTasks = (s) => { if (s) { subv = ['list', 'results', 'act'].includes(s) ? s : 'list'; store.set('ai_tk_sub', subv); } window.__libSetTab?.('tasks'); window.__openLib?.(); };
  window.__openTaskResults = () => window.__openTasks('results');
  window.__closeTasks = () => {};
  paint();
})();
