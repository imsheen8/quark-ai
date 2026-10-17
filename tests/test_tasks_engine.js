// اختبار حساب مواعيد المهام (منطق نقي) — يعمل بتوقيت الجهاز المحلي.
const fs = require('fs'), assert = require('assert');
let src = fs.readFileSync(__dirname + '/../js/features/tasks-engine.js', 'utf8');
src = src.slice(0, src.indexOf('/* ================= التخزين'));
const E = new Function(src + '\nreturn { tkNext, tkCronParse, tkCronNext, tkLabel };')();
const L = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const T = (schedule, trigger = { kind:'schedule' }) => ({ trigger, schedule });
// يومي
assert.strictEqual(E.tkNext(T({ mode:'daily', time:'07:30' }), L(2026, 10, 13, 6, 0)), L(2026, 10, 13, 7, 30));
assert.strictEqual(E.tkNext(T({ mode:'daily', time:'07:30' }), L(2026, 10, 13, 8, 0)), L(2026, 10, 14, 7, 30));
// أسبوعي: الثلاثاء 2026-10-13 → الخميس (4) ثم الإثنين (1)
assert.strictEqual(E.tkNext(T({ mode:'weekly', time:'09:00', days:[4, 1] }), L(2026, 10, 13, 10, 0)), L(2026, 10, 15, 9, 0));
assert.strictEqual(E.tkNext(T({ mode:'weekly', time:'09:00', days:[4, 1] }), L(2026, 10, 15, 10, 0)), L(2026, 10, 19, 9, 0));
// شهري: يوم 31 يُقصّ لنهاية الشهر
assert.strictEqual(E.tkNext(T({ mode:'monthly', time:'08:00', day:31 }), L(2026, 11, 5, 0, 0)), L(2026, 11, 30, 8, 0));
// فترة
assert.strictEqual(E.tkNext(T({ mode:'interval', every:90 }), 1000), 1000 + 90 * 60000);
// مرة واحدة
assert.strictEqual(E.tkNext(T({ mode:'once', date:'2026-12-25', time:'10:15' }), 0), L(2026, 12, 25, 10, 15));
// cron
assert.strictEqual(E.tkNext(T({ mode:'cron', cron:'*/15 * * * *' }), L(2026, 10, 13, 10, 7)), L(2026, 10, 13, 10, 15));
assert.strictEqual(E.tkNext(T({ mode:'cron', cron:'30 6 * * 1-5' }), L(2026, 10, 16, 7, 0)), L(2026, 10, 19, 6, 30)); // الجمعة → الإثنين
assert.strictEqual(E.tkNext(T({ mode:'cron', cron:'0 0 1 1 *' }), L(2026, 10, 13)), L(2027, 1, 1, 0, 0));
assert.strictEqual(E.tkCronParse('bad'), null); assert.strictEqual(E.tkCronParse('61 * * * *'), null); assert.strictEqual(E.tkCronParse('* * * *'), null);
// الأحداث لا موعد لها
assert.strictEqual(E.tkNext(T({}, { kind:'event' }), 0), null);
assert.ok(E.tkLabel(T({ mode:'weekly', time:'09:00', days:[1] })).includes('الإثنين'));
console.log('OK tasks schedule tests');

// ---- المشغّل: تنفيذ وفشل وإيقاف تلقائي وأحداث وتسلسل ----
(async () => {
  const full = fs.readFileSync(__dirname + '/../js/features/tasks-engine.js', 'utf8');
  const ls = {}, chats = []; let mode = 'ok';
  const g = {
    store:{ get:(k, d) => { try{ return JSON.parse(ls[k]) ?? d; }catch{ return d; } }, setRaw:(k, v) => { ls[k] = v; return true; } }, localStorage:{ setItem:(k, v) => { ls[k] = v; } }, uid:(() => { let n = 0; return () => 'id' + (++n); })(),
    epOf:() => null, activeModel:() => ({ ep:{ id:'e', kind:'local', url:'u' }, model:'m' }), rsAM:() => ({ ep:{ id:'e', kind:'local', url:'u' }, model:'m' }), shortModel:x => x,
    callModel:async function*(){ if (mode === 'fail') throw new Error('boom'); yield '<think>x</think>'; yield 'نتيجة المهمة'; }, splitThink:r => ({ ans:r.replace(/<think>[\s\S]*?<\/think>/g, '') }),
    chats, save(){}, renderList(){}, rsRun:async () => ({ report:'تقرير', sources:[], stats:{ sources:0, secs:1 }, category:'general' }), rsDB:{ put(){} }, rsTitleOf:x => x,
    runGen:() => {}, document:{ addEventListener(){}, hidden:false }, setInterval:() => 0, setTimeout:() => 0, window:{}, busy:false, Notification:undefined,
  };
  const names = Object.keys(g);
  const E = new Function(...names, full + '\nreturn { tkDB, tkNewTask, tkExecute, tkTick, tkRt, tkEmit, tkRunNow };')(...names.map(n => g[n]));
  const mk = o => { const t = E.tkNewTask({ prompt:'قل مرحبا', name:'م', ...o }); E.tkDB.addTask(t); return t; };
  const settle = async () => { while (E.tkRt.current) await new Promise(r => setImmediate(r)); };

  // نجاح + إنشاء محادثة + جدولة التالي
  const a = mk({ output:'chat', nextRun:Date.now() - 1000 }); E.tkTick(); await settle();
  assert.strictEqual(a.lastStatus, 'success'); assert.strictEqual(chats.length, 1); assert.ok(a.nextRun > Date.now()); assert.strictEqual(E.tkDB.runs()[0].output, 'نتيجة المهمة');
  // thread يتراكم في محادثة واحدة
  const th = mk({ output:'thread' }); E.tkRunNow(th.id); await settle(); E.tkRunNow(th.id); await settle();
  assert.strictEqual(chats.length, 2); assert.strictEqual(chats[0].messages.length, 4);
  // مرة واحدة تنتهي
  const once = mk({ schedule:{ mode:'once', date:'2020-01-01', time:'00:00' }, nextRun:1 }); E.tkTick(); await settle();
  assert.strictEqual(once.status, 'completed'); assert.strictEqual(once.nextRun, null);
  // إيقاف تلقائي بعد 5 إخفاقات
  mode = 'fail'; const bad = mk({ output:'notification' });
  for (let i = 0; i < 5; i++){ E.tkRunNow(bad.id); await settle(); }
  assert.strictEqual(bad.status, 'paused'); assert.ok(/تلقائيًا/.test(E.tkDB.runs()[0].error)); mode = 'ok';
  // حدث: كل 3 رسائل
  const ev = mk({ trigger:{ kind:'event', name:'message', count:3, counter:0 }, output:'notification' });
  E.tkEmit('message'); E.tkEmit('message'); assert.strictEqual(E.tkRt.queue.length, 0); E.tkEmit('message'); assert.strictEqual(E.tkRt.queue.length, 1);
  E.tkTick(); await settle(); assert.strictEqual(ev.runs, 1);
  // تسلسل: بعد النجاح تُشغَّل المهمة التالية
  const second = mk({ name:'ثانية', output:'notification' }); const first = mk({ name:'أولى', output:'notification', then:second.id });
  E.tkRunNow(first.id); await settle(); E.tkTick(); await settle(); assert.strictEqual(second.runs, 1);
  // حذف مهمة يحذف سجلها ويفك التسلسل
  E.tkDB.delTasks(second.id); assert.strictEqual(first.then, null);
  console.log('OK tasks runner tests');
})().catch(e => { console.error(e); process.exit(1); });
