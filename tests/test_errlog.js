// اختبار سجل الأخطاء: node tests/test_errlog.js
const assert = require('assert');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

/* بيئة وهمية: window بأحداث + fetch + console + QuarkNative */
const handlers = {};
const fakeFetch = async (u, init) => { if (/boom/.test(u)) throw new TypeError('Failed to fetch'); if (/abort/.test(u)){ const e = new Error('The user aborted'); e.name = 'AbortError'; throw e; } return { ok:!/bad|nf/.test(u), status:/nf/.test(u) ? 404 : /bad/.test(u) ? 500 : 200, statusText:/bad/.test(u) ? 'Server Error' : '' }; };
globalThis.window = globalThis; globalThis.addEventListener = (t, f) => { (handlers[t] = handlers[t] || []).push(f); };
globalThis.fetch = fakeFetch;
globalThis.location = { href:'http://localhost/index.html', hash:'#/models' };
const conErrs = []; const origErr = console.error; console.error = (...a) => conErrs.push(a);
globalThis.QuarkNative = { crashLog: () => JSON.stringify([
  { kind:'JAVA', ts:1000, thread:'main', text:'java.lang.IllegalStateException: boom\n  at a.b.C(Main.java:1)' },
  { kind:'EXIT', ts:2000, reason:'CRASH_NATIVE (انهيار أصلي — المحرك/المكتبات)', desc:'signal 11 (SIGSEGV)', pss:123, rss:456, pid:7 } ]),
  deviceInfo: () => JSON.stringify({ brand:'POCO', model:'23049PCD8G', sdk:35, totalMem:11e9 }) };
const L = require('../js/features/error-log.js');

(async () => {
  ok(window.__errlog === L && handlers.error && handlers.unhandledrejection, 'التثبيت يسجّل المستمعين');
  /* إخفاء الأسرار */
  const e1 = L.add({ src:'api', msg:'401 Unauthorized with key sk-abcdefghijklmnop1234567890 and Bearer abcdefghijklmnopqrstuv', ctx:{ apiKey:'sk-zzzzzzzzzzzzzzzzzzzz', url:'https://x.com/v1?key=AIzaSyA1234567890123456789012345678901&a=1' } });
  ok(!/abcdefghijklmnop1234567890|abcdefghijklmnopqrstuv/.test(e1.msg), 'المفاتيح في الرسالة مخفية: ' + e1.msg);
  eq(e1.ctx.apiKey, '[مخفي]'); ok(!/AIzaSyA1234567890123456789012345678901/.test(JSON.stringify(e1.ctx)), 'مفتاح الرابط مخفي');
  ok(L.clean('hf_abcdefghij1234567890XYZ').includes('[مخفي]'), 'رمز Hugging Face مخفي');
  ok(L.clean('data:image/png;base64,' + 'A'.repeat(200)).includes('base64 محذوف'), 'بيانات base64 الطويلة محذوفة');
  /* التجميع */
  for (let i = 0; i < 4; i++) L.add({ src:'js', msg:'x is not a function', stack:'TypeError: x\n    at f (app.js:1:1)' });
  const grp = L.all().filter(e => e.msg === 'x is not a function'); eq([grp.length, grp[0].n], [1, 4]);
  /* أحداث الصفحة */
  handlers.error[0]({ message:'Uncaught ReferenceError: foo is not defined', error:new ReferenceError('foo is not defined'), filename:'http://localhost/js/a.js?v=1', lineno:5, colno:3 });
  ok(L.all().some(e => e.src === 'js' && /foo is not defined/.test(e.msg) && e.ctx.line === 5), 'خطأ الصفحة');
  handlers.error[0]({ message:'ResizeObserver loop limit exceeded' }); ok(!L.all().some(e => /ResizeObserver/.test(e.msg)), 'ضجيج ResizeObserver مُتجاهَل');
  handlers.error[0]({ target:{ tagName:'IMG', src:'http://localhost/img/none.png?sig=1' } }); ok(L.all().some(e => e.src === 'resource' && /none\.png/.test(e.msg) && !/sig=1/.test(e.msg)), 'فشل مورد بلا استعلام');
  handlers.unhandledrejection[0]({ reason:new Error('promise failed') }); ok(L.all().some(e => e.src === 'promise' && e.msg === 'promise failed'), 'وعد مرفوض');
  handlers.unhandledrejection[0]({ reason:Object.assign(new Error('x'), { name:'AbortError' }) }); ok(!L.all().some(e => e.msg === 'x' && e.src === 'promise'), 'الإلغاء ليس خطأ');
  /* console */
  console.error('something', new Error('con err')); ok(L.all().some(e => e.src === 'console' && /con err/.test(e.msg)), 'console.error'); console.warn('warned'); ok(!L.all().some(e => /warned/.test(e.msg)), 'التحذيرات معطّلة افتراضيًا');
  /* الشبكة */
  await fetch('http://api.x/ok'); await fetch('http://api.x/bad?key=SECRETSECRET123'); await fetch('http://api.x/nf');
  let ne = null; try{ await fetch('http://api.x/boom'); }catch(e){ ne = e; } ok(ne && ne.message === 'Failed to fetch', 'fetch يرمي الخطأ الأصلي كما هو');
  try{ await fetch('http://api.x/abort'); }catch{}
  const net = L.all().filter(e => e.src === 'net');
  ok(net.some(e => /HTTP 500/.test(e.msg) && !/SECRETSECRET/.test(JSON.stringify(e))), 'HTTP 500 بلا أسرار');
  ok(!net.some(e => /HTTP 404/.test(e.msg)), '404 تحذير: مُتجاهَل افتراضيًا'); ok(net.some(e => /Failed to fetch/.test(e.msg) && /boom/.test(e.msg)), 'فشل الاتصال'); ok(!net.some(e => /abort/.test(e.msg)), 'AbortError مُتجاهَل');
  L.setPrefs({ warn:true }); await fetch('http://api.x/nf2/nf'); ok(L.all().some(e => e.lvl === 'warn' && /404/.test(e.msg)), 'تفعيل التحذيرات يسجّل 404'); L.setPrefs({ warn:false });
  /* انهيارات أندرويد */
  eq(L.importNative(), 2); ok(L.all().some(e => e.src === 'crash' && /IllegalStateException/.test(e.msg)) && L.all().some(e => e.src === 'exit' && /CRASH_NATIVE/.test(e.msg) && e.ctx.pssKB === 123), 'استيراد انهيارات Java والخروج');
  /* التصفية */
  ok(L.list({ src:'net' }).every(e => e.src === 'net') && L.list({ q:'foo is not' }).length === 1 && L.list({ lvl:'warn' }).every(e => e.lvl === 'warn'), 'التصفية والبحث');
  ok(L.list({}).every((e, i, a) => !i || a[i - 1].last >= e.last), 'الأحدث أولًا');
  /* التقرير */
  const rep = L.report({ limit:20 });
  ok(/تقرير أخطاء/.test(rep) && /POCO/.test(rep) && /23049PCD8G/.test(rep) && /IllegalStateException/.test(rep) && !/SECRETSECRET|sk-abcdefghijklmnop1234567890/.test(rep), 'التقرير: جهاز + أخطاء + بلا أسرار');
  ok(L.unseen() > 0, 'أخطاء غير مقروءة'); L.markSeen(); eq(L.unseen(), 0);
  /* إزالة/مسح/حد أقصى */
  const id = L.all()[0].id; L.remove(id); ok(!L.all().some(e => e.id === id), 'حذف مدخل');
  L.setPrefs({ max:50 }); for (let i = 0; i < 80; i++) L.add({ src:'app', msg:'unique ' + i, key:'k' + i, ts:Date.now() }); ok(L.all().length <= 50, 'الحد الأقصى: ' + L.all().length);
  /* فيضان */
  const before = L.all().length; let added = 0; for (let i = 0; i < 400; i++) if (L.add({ src:'app', msg:'flood ' + i, key:'f' + i })) added++; ok(added < 120, 'حماية الفيضان: ' + added);
  L.clear(); eq(L.all().length, 0);
  console.error = origErr;
  console.log('OK — ' + n + ' تأكيدًا'); process.exit(0);
})().catch(e => { console.error = origErr; console.error(e); process.exit(1); });
