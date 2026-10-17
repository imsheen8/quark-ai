/* QUARK AI — محرّك المهام المجدولة
   مهام تعمل تلقائيًا: «موجّه» (يُرسل نصًا للنموذج) أو «بحث عميق». المشغّلات: جدول زمني (مرة/كل فترة/يومي/أسبوعي/شهري/Cron)
   أو حدث (كل N رسائل/محادثات/أبحاث). تنفيذ واحد في كل مرة.
   وضعان:
   • الخادم (الافتراضي مع serve.py والأندرويد): المجدول في بايثون (server/gateway/tasks.py) ينفّذ المهام حتى لو كان التطبيق مغلقًا.
     هذا الملف هنا عارض: يرسل إعداد المهام ويطلب «شغّل الآن/أوقف»، ويزامن الحالة والنتائج كل بضع ثوانٍ.
   • المتصفح (بلا خادم بايثون): المحرّك القديم يعمل داخل الصفحة أثناء فتحها فقط. */
'use strict';

/* ================= حساب الموعد التالي ================= */
const tkPad = n => String(n).padStart(2, '0');
const TK_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
function tkTime(s){ const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? [Math.min(23, +m[1]), Math.min(59, +m[2])] : [9, 0]; }

function tkCronField(src, lo, hi, wrap7){
  const out = new Set();
  for (const part of String(src).split(',')){
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return null;
    let a = lo, b = hi;
    if (m[1] !== '*'){ const r = m[1].split('-').map(Number); a = r[0]; b = r.length > 1 ? r[1] : (m[2] ? hi : r[0]); }
    const step = m[2] ? Number(m[2]) : 1;
    if (!step || a < lo || b > hi + (wrap7 ? 1 : 0) || a > b) return null;
    for (let v = a; v <= b; v += step) out.add(wrap7 && v === 7 ? 0 : v);
  }
  return out.size ? out : null;
}
function tkCronParse(expr){
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) return null;
  const min = tkCronField(f[0], 0, 59), hour = tkCronField(f[1], 0, 23), dom = tkCronField(f[2], 1, 31), mon = tkCronField(f[3], 1, 12), dow = tkCronField(f[4], 0, 6, true);
  if (!min || !hour || !dom || !mon || !dow) return null;
  return { min:[...min].sort((a, b) => a - b), hour:[...hour].sort((a, b) => a - b), dom, mon, dow, domStar:f[2] === '*', dowStar:f[4] === '*' };
}
function tkCronNext(expr, from){
  const c = tkCronParse(expr); if (!c) return null;
  const base = new Date(from); base.setHours(0, 0, 0, 0);
  for (let i = 0; i < 800; i++){
    const d = new Date(base); d.setDate(base.getDate() + i);
    if (!c.mon.has(d.getMonth() + 1)) continue;
    const dm = c.dom.has(d.getDate()), dw = c.dow.has(d.getDay());
    if (!(c.domStar || c.dowStar ? (dm && dw) : (dm || dw))) continue;
    for (const h of c.hour) for (const m of c.min){
      const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
      if (ts > from) return ts;
    }
  }
  return null;
}
function tkNext(t, from = Date.now()){
  if (!t.trigger || t.trigger.kind !== 'schedule') return null;
  const s = t.schedule || {}, [h, m] = tkTime(s.time);
  const at = d => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
  switch (s.mode){
    case 'once': { const p = String(s.date || '').split('-').map(Number); return p.length === 3 && p[0] ? new Date(p[0], p[1] - 1, p[2], h, m).getTime() : null; }
    case 'interval': return from + Math.max(1, Number(s.every) || 60) * 60000;
    case 'daily': { const d = at(from); if (d.getTime() <= from) d.setDate(d.getDate() + 1); return d.getTime(); }
    case 'weekly': {
      const days = Array.isArray(s.days) && s.days.length ? s.days : [1];
      for (let i = 0; i < 8; i++){ const d = at(from); d.setDate(d.getDate() + i); if (days.includes(d.getDay()) && d.getTime() > from) return d.getTime(); }
      return null;
    }
    case 'monthly': {
      const want = Math.min(31, Math.max(1, Number(s.day) || 1)), f = new Date(from);
      for (let i = 0; i < 26; i++){
        const y = f.getFullYear(), mo = f.getMonth() + i, dim = new Date(y, mo + 1, 0).getDate();
        const ts = new Date(y, mo, Math.min(want, dim), h, m).getTime();
        if (ts > from) return ts;
      }
      return null;
    }
    case 'cron': return tkCronNext(s.cron, from);
  }
  return null;
}
function tkLabel(t){
  const tr = t.trigger || {};
  if (tr.kind === 'event'){ const e = { message:'رسالة تُرسل', chat:'محادثة جديدة', research:'بحث عميق يكتمل' }[tr.name] || tr.name; return `كل ${tr.count || 1} × ${e}`; }
  const s = t.schedule || {}, tm = s.time || '09:00';
  switch (s.mode){
    case 'once': return `مرة واحدة: ${s.date || '—'} ${tm}`;
    case 'interval': { const n = s.every || 60; return n % 60 === 0 ? `كل ${n / 60} ساعة` : `كل ${n} دقيقة`; }
    case 'daily': return `يوميًا ${tm}`;
    case 'weekly': return `أسبوعيًا (${(s.days || [1]).map(d => TK_DAYS[d]).join('، ')}) ${tm}`;
    case 'monthly': return `شهريًا يوم ${s.day || 1} ${tm}`;
    case 'cron': return `Cron: ${s.cron || '?'}`;
  }
  return '—';
}

/* ================= التخزين ================= */
const tkSrv = () => { try{ return QuarkKV.mode === 'server'; }catch{ return false; } };
const tkTz = () => { let tz = ''; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch{} return { tz, off:new Date().getTimezoneOffset() }; };
const tkPost = async (op, body = {}) => QuarkKV.call('tasks/' + op, { ...tkTz(), ...body });
const tkDB = (() => {
  const KT = 'ai_tasks_v1', KR = 'ai_task_runs_v1', MAXR = 300;
  let tasks = store.get(KT, []), runs = store.get(KR, []);
  if (!Array.isArray(tasks)) tasks = []; if (!Array.isArray(runs)) runs = [];
  /* وضع الخادم: المصدر هو بايثون. نتتبع آخر نسخة متزامنة لنرسل فقط ما غيّره المستخدم. */
  const synced = new Map(), rsynced = new Map();
  const cfgOf = t => JSON.stringify([t.name, t.type, t.prompt, t.instructions, t.trigger?.kind, t.trigger?.name, t.trigger?.count, t.schedule, t.output, t.model, t.research, t.status, t.then]);
  const rsig = r => (r.unread ? 1 : 0) + '|' + (r.chatId || '');
  const mark = () => { synced.clear(); tasks.forEach(t => synced.set(t.id, cfgOf(t))); rsynced.clear(); runs.forEach(r => rsynced.set(r.id, rsig(r))); };
  let inflight = 0, since = 0;
  const put = (k, v) => tkSrv() ? true : store.setRaw(k, JSON.stringify(v));
  const saveRuns = () => { if (tkSrv()) return; runs = runs.slice(0, MAXR); while (!put(KR, runs) && runs.length > 10) runs = runs.slice(0, Math.floor(runs.length * .7)); };
  if (tkSrv()) mark();
  const fail = e => { console.warn('tasks:', e); };
  return {
    tasks:() => tasks, runs:() => runs,
    task:id => tasks.find(t => t.id === id),
    get busy(){ return inflight > 0; },
    /* يطبّق ردّ الخادم (لقطة كاملة للمهام + السجلات المتغيّرة) */
    apply(snap){
      if (!snap || !snap.ok) return;
      tasks = snap.tasks || [];
      const byId = new Map(runs.map(r => [r.id, r]));
      (snap.runs || []).forEach(r => byId.set(r.id, r));
      const keep = new Set(snap.runIds || []);
      runs = [...byId.values()].filter(r => keep.has(r.id)).sort((a, b) => b.start - a.start);
      mark(); since = Math.max(0, (snap.now || 0) - 3000);
      tkRt.current = snap.current ? { task:tasks.find(t => t.id === snap.current.taskId) || { id:snap.current.taskId, name:'' }, run:runs.find(r => r.id === snap.current.runId), ctl:{ abort:() => tkStop() } } : null;
      tkRt.queue = (snap.queue || []).map(id => ({ id }));
    },
    get since(){ return since; },
    saveTasks(){
      if (!tkSrv()){ put(KT, tasks); return; }
      const dirty = tasks.filter(t => synced.get(t.id) !== cfgOf(t));
      if (!dirty.length) return;
      inflight++;
      QuarkKV.flush().then(() => tkPost('save', { tasks:dirty, since })).then(j => { inflight--; this.apply(j); tkChanged(); }).catch(e => { inflight--; fail(e); try{ toast('تعذّر حفظ المهمة على الخادم'); }catch{} });
    },
    addTask(t){ tasks.unshift(t); this.saveTasks(); },
    delTasks(ids){
      const s = new Set([].concat(ids)); tasks = tasks.filter(t => !s.has(t.id)); tasks.forEach(t => { if (s.has(t.then)) t.then = null; }); runs = runs.filter(r => !s.has(r.taskId));
      if (tkSrv()){ inflight++; tkPost('delete', { ids:[...s], since }).then(j => { inflight--; this.apply(j); tkChanged(); }).catch(e => { inflight--; fail(e); }); return; }
      this.saveTasks(); saveRuns();
    },
    addRun(r){ runs.unshift(r); saveRuns(); },
    saveRuns(){
      if (!tkSrv()) return saveRuns();
      const patch = runs.filter(r => rsynced.get(r.id) !== rsig(r)).map(r => ({ id:r.id, unread:!!r.unread, chatId:r.chatId || undefined }));
      if (!patch.length) return;
      patch.forEach(p => rsynced.set(p.id, (p.unread ? 1 : 0) + '|' + (p.chatId || '')));
      tkPost('runs', { patch, since }).then(j => { this.apply(j); tkChanged(); }).catch(fail);
    },
    delRuns(ids){
      const s = new Set([].concat(ids)); runs = runs.filter(r => !s.has(r.id));
      if (tkSrv()) tkPost('runs', { delete:[...s], since }).then(j => { this.apply(j); tkChanged(); }).catch(fail); else saveRuns();
    },
  };
})();
function tkNewTask(o = {}){
  return { id:uid(), name:'مهمة جديدة', type:'prompt', prompt:'', instructions:'', trigger:{ kind:'schedule', name:'message', count:5, counter:0 },
    schedule:{ mode:'daily', time:'09:00', date:'', every:60, days:[1], day:1, cron:'0 9 * * *' }, output:'chat', model:null, research:{ rounds:0, category:'' },
    status:'active', nextRun:null, lastRun:0, lastStatus:'', runs:0, fails:0, then:null, chatId:null, createdAt:Date.now(), ...o };
}

/* ================= التنفيذ ================= */
const tkRt = { current:null, queue:[], timer:0, listeners:new Set() };
const tkChanged = () => { tkRt.listeners.forEach(f => { try{ f(); }catch{} }); };
const tkUnread = () => tkDB.runs().filter(r => r.unread && r.status === 'success').length;

function tkNotify(title, body){
  try{ if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(title, { body:String(body || '').slice(0, 140) }); }catch{}
}
function tkAM(t){
  const s = t.model, ep = s && epOf(s.ep);
  return ep && ep.enabled ? { ep, model:s.model } : (t.type === 'research' ? rsAM() : activeModel());
}
async function tkPrompt(t, am, signal){
  const today = new Date().toLocaleDateString('ar', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const content = (t.instructions ? t.instructions.trim() + '\n\n' : '') + `(تاريخ اليوم: ${today})\n\n` + t.prompt.trim();
  let raw = '';
  for await (const ch of callModel([{ role:'user', content }], signal, null, am)){ if (typeof ch === 'string') raw += ch; }
  const ans = splitThink(raw).ans.trim();
  if (!ans) throw new Error('لم يُرجع النموذج إجابة.');
  return ans;
}
async function tkDeliver(t, run, text, extra = {}){
  const meta = extra.research ? { research:extra.research } : {};
  const um = { role:'user', content:t.prompt }, am = { role:'assistant', content:text, model:extra.model || '', ts:Date.now(), ...meta };
  if (t.output === 'chat' || t.output === 'thread'){
    let c = t.output === 'thread' && t.chatId ? chats.find(x => x.id === t.chatId) : null;
    if (c){ c.messages.push({ role:'user', content:`[${new Date().toLocaleString('ar')}] ${t.prompt}` }, am); c.ts = Date.now(); }
    else { c = { id:uid(), title:'[مهمة] ' + t.name, ts:Date.now(), messages:[um, am] }; chats.unshift(c); if (t.output === 'thread') t.chatId = c.id; }
    run.chatId = c.id; save(); try{ renderList(); }catch{}
  }
}
async function tkExecute(t, opt = {}){
  if (tkRt.current) return;
  const run = { id:uid(), taskId:t.id, taskName:t.name, type:t.type, status:'running', start:Date.now(), end:0, output:'', error:'', target:t.output, manual:!!opt.manual, trigger:opt.trigger || (t.trigger.kind === 'event' ? 'event' : 'schedule'), unread:false, depth:opt.depth || 0, progress:null };
  const ctl = new AbortController();
  tkRt.current = { task:t, run, ctl }; tkDB.addRun(run); tkChanged();
  try{
    const am = tkAM(t);
    if (!am) throw new Error('لا يوجد نموذج: أضف نقطة اتصال واختر نموذجًا.');
    if (am.ep.kind !== 'local' && !am.ep.key) throw new Error('مفتاح API غير مُدخل للنموذج.');
    if (!String(t.prompt || '').trim()) throw new Error('نص المهمة فارغ.');
    let text = '', extra = { model:shortModel(am.model) };
    if (t.type === 'research'){
      const res = await rsRun({ question:t.prompt, opts:{ maxRounds:t.research?.rounds || 0, category:t.research?.category || '' }, am, signal:ctl.signal, emit:p => { run.progress = p; tkChanged(); } });
      const r = { id:uid(), q:t.prompt, title:rsTitleOf(t.prompt), report:res.report, sources:res.sources.map(s => ({ n:s.n, url:s.url, title:s.title, host:s.host, summary:s.summary, img:s.img || '' })), stats:res.stats, category:res.category, partial:!!res.partial, ts:Date.now(), model:shortModel(am.model), hidden:[], task:t.id };
      rsDB.put(r); run.researchId = r.id; text = res.report; extra.research = { id:r.id, sources:res.stats.sources, secs:res.stats.secs };
      if (res.stopped) throw Object.assign(new Error('أُوقفت المهمة'), { name:'AbortError' });
    } else text = await tkPrompt(t, am, ctl.signal);
    run.output = text.slice(0, 30000); run.status = 'success'; run.unread = true;
    await tkDeliver(t, run, text, extra);
    t.fails = 0; t.lastStatus = 'success';
    tkNotify('اكتملت المهمة: ' + t.name, text.replace(/[#*>`\[\]]/g, ''));
    if (t.then && opt.depth < 5 && tkDB.task(t.then) && tkDB.task(t.then).id !== t.id) tkRt.queue.push({ id:t.then, depth:(opt.depth || 0) + 1, trigger:'chain' });
  }catch(e){
    if (e.name === 'AbortError'){ run.status = 'aborted'; run.error = 'أُوقفت يدويًا'; t.lastStatus = 'aborted'; }
    else {
      run.status = 'error'; run.error = e.message === 'Failed to fetch' ? 'تعذّر الاتصال.' : String(e.message || e); t.lastStatus = 'error'; t.fails = (t.fails || 0) + 1;
      if (t.fails >= 5 && t.status === 'active'){ t.status = 'paused'; t.nextRun = null; run.error += ' — أُوقفت المهمة تلقائيًا بعد 5 إخفاقات متتالية.'; tkNotify('أُوقفت المهمة: ' + t.name, run.error); }
    }
  }finally{
    run.end = Date.now(); tkRt.current = null;
    t.lastRun = run.end; t.runs = (t.runs || 0) + 1;
    if (t.status === 'active'){
      if (t.trigger.kind === 'schedule'){
        if (t.schedule.mode === 'once') { t.status = 'completed'; t.nextRun = null; }
        else t.nextRun = tkNext(t, Date.now());
      }
    }
    tkDB.saveTasks(); tkDB.saveRuns(); tkChanged(); setTimeout(tkTick, 500);
  }
}
function tkTick(){
  if (tkSrv()) return tkSync();
  if (tkRt.current || (typeof busy !== 'undefined' && busy)) return;
  let job = null;
  while (tkRt.queue.length && !job){ const q = tkRt.queue.shift(), t = tkDB.task(q.id); if (t && (t.status !== 'completed' || q.manual)) job = { t, opt:{ manual:q.manual, depth:q.depth, trigger:q.trigger } }; }
  if (!job){
    const now = Date.now();
    const due = tkDB.tasks().filter(t => t.status === 'active' && t.trigger.kind === 'schedule' && t.nextRun && t.nextRun <= now).sort((a, b) => a.nextRun - b.nextRun)[0];
    if (due) job = { t:due, opt:{ trigger:'schedule' } };
  }
  if (job) tkExecute(job.t, job.opt);
}
async function tkRunNow(id){
  if (tkSrv()){
    try{ await QuarkKV.flush(); tkRt.queue.push({ id }); tkChanged(); tkDB.apply(await tkPost('run', { id, since:tkDB.since })); tkChanged(); }
    catch(e){ tkSync(); try{ toast('تعذّر تشغيل المهمة: ' + (e.message || 'الخادم غير متاح')); }catch{} }
    return;
  }
  if (!tkRt.queue.some(q => q.id === id) && tkRt.current?.task.id !== id) tkRt.queue.push({ id, manual:true, depth:0, trigger:'manual' }); tkChanged(); tkTick(); }
function tkStop(){ if (tkSrv()){ tkPost('stop', { since:tkDB.since }).then(j => { tkDB.apply(j); tkChanged(); }).catch(() => {}); return; } tkRt.current?.ctl.abort(); }
function tkEmit(name){
  if (tkSrv()){ tkPost('emit', { name }).then(() => setTimeout(tkSync, 1500)).catch(() => {}); return; }
  let any = false;
  tkDB.tasks().forEach(t => {
    if (t.status !== 'active' || t.trigger.kind !== 'event' || t.trigger.name !== name) return;
    t.trigger.counter = (t.trigger.counter || 0) + 1;
    if (t.trigger.counter >= (t.trigger.count || 1)){ t.trigger.counter = 0; if (!tkRt.queue.some(q => q.id === t.id)) tkRt.queue.push({ id:t.id, depth:0, trigger:'event' }); }
    any = true;
  });
  if (any){ tkDB.saveTasks(); setTimeout(tkTick, 800); }
}
window.__tkEmit = tkEmit;

/* ================= المزامنة مع الخادم ================= */
let tkSyncing = false;
/* النتائج المنتظرة في الصندوق الصادر → محادثات وتقارير بحث في هذا الجهاز، ثم تأكيد الاستلام للخادم */
const tkUsageSeen = new Set();
async function tkApplyOutbox(list){
  const ack = []; let touched = false;
  for (const o of list || []){
    try{
      if (o.research && !rsDB.get(o.research.id)) rsDB.put(o.research);
      const c = o.chat;
      if (c){
        const am = { role:'assistant', content:c.text, model:c.model || '', ts:o.ts || Date.now(), runId:o.id, ...(c.mem ? { mem:c.mem } : {}), ...(c.skills?.length ? { skills:c.skills } : {}),
          ...(o.research ? { research:{ id:o.research.id, sources:(o.research.sources || []).length, secs:o.research.stats?.secs || 0 } } : {}) };
        const ch = chats.find(x => x.id === c.id);
        if (ch){
          if (!ch.messages.some(m => m.runId === o.id)){ ch.messages.push({ role:'user', content:`[${c.when}] ${c.prompt}` }, am); ch.ts = Date.now(); touched = true; }
        } else { chats.unshift({ id:c.id, title:c.title, ts:Date.now(), messages:[{ role:'user', content:c.prompt }, am] }); touched = true; }
      }
      /* استهلاك الرموز الذي سجّله الخادم → صفحة الإحصائيات (مرة واحدة لكل تشغيل) */
      if (o.usage?.length && !tkUsageSeen.has(o.id)){ tkUsageSeen.add(o.id); o.usage.forEach(ev => { try{ window.__usage?.log(ev); }catch{} }); }
      ack.push(o.id);
      if (!o.chat && !o.research) continue;
      tkNotify('اكتملت المهمة: ' + o.taskName, (o.chat?.text || o.research?.report || '').replace(/[#*>`\[\]]/g, ''));
    }catch(e){ console.warn('tasks outbox', e); }
  }
  if (touched){ save(); try{ renderList(); }catch{} }
  if (ack.length) try{ await tkPost('ack', { ids:ack }); }catch{}
}
async function tkSync(){
  if (!tkSrv() || tkSyncing || tkDB.busy) return;
  tkSyncing = true;
  try{
    const j = await tkPost('sync', { since:tkDB.since });
    if (!tkDB.busy){ tkDB.apply(j); await tkApplyOutbox(j.outbox); tkChanged(); }
  }catch{ /* الخادم غير متاح الآن: نبقي آخر حالة معروفة */ }
  finally{ tkSyncing = false; }
}

/* ================= التشغيل ================= */
(() => {
  /* أحداث المحادثة (للمهام المرتبطة بحدث) */
  const _rg = runGen;
  runGen = function(c, pair){ if (!pair){ tkEmit('message'); if (c.messages.length === 1) tkEmit('chat'); } return _rg(c, pair); };
  if (tkSrv()){
    /* المجدول يعمل في بايثون؛ هنا نزامن فقط: سريعًا أثناء التنفيذ أو عند فتح صفحة المهام، وببطء غير ذلك */
    let last = 0;
    setInterval(() => {
      if (document.hidden) return;
      const fast = tkRt.current || tkRt.queue.length || window.__tkWatching?.();
      if (Date.now() - last >= (fast ? 3000 : 20000)){ last = Date.now(); tkSync(); }
    }, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden){ last = Date.now(); tkSync(); } });
    window.addEventListener('quark-kv-status', e => { if (e.detail?.ok) tkSync(); });
    setTimeout(tkSync, 300);
    return;
  }
  /* ---- وضع المتصفح (بلا خادم): المحرّك القديم يعمل أثناء فتح الصفحة فقط ---- */
  /* ما انقطع بإغلاق التطبيق */
  tkDB.runs().forEach(r => { if (r.status === 'running'){ r.status = 'aborted'; r.error = 'انقطعت بإغلاق التطبيق'; r.end = r.end || Date.now(); } });
  tkDB.saveRuns();
  tkDB.tasks().forEach(t => { if (t.status === 'active' && t.trigger.kind === 'schedule' && !t.nextRun) t.nextRun = tkNext(t); });
  tkDB.saveTasks();
  tkRt.timer = setInterval(tkTick, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tkTick(); });
  setTimeout(tkTick, 4000);                                     /* تنفيذ ما فات أثناء الإغلاق (واحدة تلو الأخرى) */
})();
