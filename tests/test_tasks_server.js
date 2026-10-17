// اختبار وضع الخادم في واجهة المهام: يتحدث مع مجدول بايثون الحقيقي (يشغّله tests/test_tasks.py ويمرّر QUARK_TEST_BASE).
const fs = require('fs'), assert = require('assert');
const BASE = process.env.QUARK_TEST_BASE;
if (!BASE){ console.log('SKIP tasks server tests (no QUARK_TEST_BASE)'); process.exit(0); }
const full = fs.readFileSync(__dirname + '/../js/features/tasks-engine.js', 'utf8');
(async () => {
  const chats = [], research = new Map(), usage = []; let saved = 0, toasts = [];
  const g = {
    store:{ get:(k, d) => d, setRaw:() => true }, uid:() => Math.random().toString(36).slice(2, 12),
    QuarkKV:{ mode:'server', flush:async () => {}, call:async (route, body) => (await fetch(BASE + route, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body) })).json() },
    chats, save(){ saved++; }, renderList(){}, toast:m => toasts.push(m), mainEl:{ classList:{ contains:() => false } },
    rsDB:{ get:id => research.get(id), put:r => research.set(r.id, r) }, rsAM:() => null, activeModel:() => null, epOf:() => null, shortModel:x => x,
    runGen:() => {}, document:{ addEventListener(){}, hidden:false }, setInterval:() => 0, setTimeout:() => 0, window:{ addEventListener(){}, __usage:{ log:e => usage.push(e) } }, busy:false, Notification:undefined,
  };
  const names = Object.keys(g);
  const E = new Function(...names, full + '\nreturn { tkDB, tkNewTask, tkRt, tkRunNow, tkSync, tkStop, tkEmit };')(...names.map(n => g[n]));
  const until = async (f, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms){ await E.tkSync(); if (f()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };

  // إنشاء مهمة: تصل للخادم وتُحسب موعدها هناك
  const t = E.tkNewTask({ name:'من الواجهة', prompt:'مرحبا', output:'chat' }); E.tkDB.addTask(t);
  assert.ok(await until(() => E.tkDB.tasks().some(x => x.id === t.id && x.nextRun)), 'المهمة لم تصل للخادم');
  // تشغيل الآن: تُنفَّذ في بايثون، والنتيجة تصل كمحادثة جديدة ثم تُؤكَّد
  await E.tkRunNow(t.id);
  assert.ok(await until(() => E.tkDB.runs().some(r => r.taskId === t.id && r.status === 'success')), 'لم تنجح المهمة');
  assert.ok(await until(() => chats.length === 1), 'لم تصل المحادثة من الصندوق الصادر');
  assert.strictEqual(chats[0].messages[1].content, 'plain answer'); assert.ok(chats[0].title.includes('من الواجهة')); assert.ok(saved >= 1);
  await E.tkSync(); await E.tkSync(); assert.strictEqual(chats.length, 1, 'لا تكرار بعد التأكيد');
  assert.strictEqual(usage.length, 1, 'الاستهلاك يُسجَّل مرة واحدة في الإحصائيات'); assert.strictEqual(usage[0].k, 'lab'); assert.ok(usage[0].i > 0 && usage[0].o > 0);
  // تعليم كمقروءة يصل للخادم
  const r = E.tkDB.runs().find(x => x.taskId === t.id); assert.ok(r.unread); r.unread = false; E.tkDB.saveRuns();
  assert.ok(await until(() => !E.tkDB.runs().find(x => x.id === r.id).unread)); await new Promise(r => setTimeout(r, 300)); await E.tkSync();
  assert.ok(!E.tkDB.runs().find(x => x.id === r.id).unread, 'بقيت غير مقروءة');
  // إيقاف المهمة من الواجهة
  const tt = E.tkDB.task(t.id); tt.status = 'paused'; E.tkDB.saveTasks();
  assert.ok(await until(() => E.tkDB.task(t.id).status === 'paused' && E.tkDB.task(t.id).nextRun === null));
  // حذف
  E.tkDB.delTasks(t.id); assert.ok(await until(() => !E.tkDB.tasks().length && !E.tkDB.runs().length));
  console.log('OK tasks server-mode tests');
})().catch(e => { console.error(e); process.exit(1); });
