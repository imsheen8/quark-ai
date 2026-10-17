// اختبار منطق البريد النقي (الرد التلقائي، الردود، التقسيم، التصنيف) — بلا DOM.
const fs = require('fs'), assert = require('assert');
let src = fs.readFileSync(__dirname + '/../js/features/mail-engine.js', 'utf8');
src = src.slice(0, src.indexOf('/* ===== نهاية الجزء النقي ===== */'));
const E = new Function(src + '\nreturn { mlWindowActive, mlAutoReplyDecision, mlAutoSubject, mlQuoteSplit, mlReplyParts, mlParseTagJson, mlHeuristicTags, mlGuessProvider, mlSplitAddrs, mlDay, ML_DEF_AR, mlBytes };')();
const D = (y, m, d) => new Date(y, m - 1, d, 12);

// ---- نافذة الرد التلقائي (تواريخ محلية، شاملة الطرفين)
const ar = (o = {}) => ({ ...E.ML_DEF_AR, enabled:true, ...o });
assert.strictEqual(E.mlWindowActive(ar({ start:'2026-10-10', end:'2026-10-15' }), D(2026, 10, 10)), true);
assert.strictEqual(E.mlWindowActive(ar({ start:'2026-10-10', end:'2026-10-15' }), D(2026, 10, 15)), true);
assert.strictEqual(E.mlWindowActive(ar({ start:'2026-10-10', end:'2026-10-15' }), D(2026, 10, 16)), false);
assert.strictEqual(E.mlWindowActive(ar({ start:'2026-10-10', end:'2026-10-15' }), D(2026, 10, 9)), false);
assert.strictEqual(E.mlWindowActive(ar({ start:'', end:'' }), D(2030, 1, 1)), true);          // مفتوحة
assert.strictEqual(E.mlWindowActive(ar({ enabled:false }), D(2026, 10, 12)), false);

// ---- قرار الرد
const row = (o = {}) => ({ uid:50, unread:true, draft:false, auto:false, date:'2026-10-12T10:00:00Z', from:{ addr:'Ali@Example.com', name:'علي' }, ...o });
const ctx = (o = {}) => ({ self:new Set(['me@x.com']), log:{}, now:Date.parse('2026-10-12T12:00:00Z'), ...o });
const A = ar({ baseline:40, at:Date.parse('2026-10-12T00:00:00Z'), cooldown:'period' });
assert.strictEqual(E.mlAutoReplyDecision(row(), A, ctx()).reply, true);
assert.strictEqual(E.mlAutoReplyDecision(row({ uid:40 }), A, ctx()).reason, 'old');             // قبل نقطة الأساس
assert.strictEqual(E.mlAutoReplyDecision(row({ unread:false }), A, ctx()).reason, 'read');
assert.strictEqual(E.mlAutoReplyDecision(row({ auto:true }), A, ctx()).reason, 'automated');
assert.strictEqual(E.mlAutoReplyDecision(row({ auto:true }), { ...A, excl:false }, ctx()).reply, true);
assert.strictEqual(E.mlAutoReplyDecision(row({ from:{ addr:'ME@x.com' } }), A, ctx()).reason, 'self');
assert.strictEqual(E.mlAutoReplyDecision(row({ from:{ addr:'' } }), A, ctx()).reason, 'nosender');
assert.strictEqual(E.mlAutoReplyDecision(row({ date:'2026-10-09T10:00:00Z' }), ar({ ...A, start:'2026-10-11' }), ctx()).reason, 'before-window');
// فترة التبريد: مرة واحدة أثناء التفعيل
assert.strictEqual(E.mlAutoReplyDecision(row(), A, ctx({ log:{ 'ali@example.com':Date.parse('2026-10-12T05:00:00Z') } })).reason, 'cooldown');
assert.strictEqual(E.mlAutoReplyDecision(row(), A, ctx({ log:{ 'ali@example.com':Date.parse('2026-10-01T05:00:00Z') } })).reply, true); // ردّ قديم قبل التفعيل
// تبريد بالأيام
const A3 = { ...A, cooldown:'3d' };
assert.strictEqual(E.mlAutoReplyDecision(row(), A3, ctx({ log:{ 'ali@example.com':Date.parse('2026-10-10T20:00:00Z') } })).reason, 'cooldown');
assert.strictEqual(E.mlAutoReplyDecision(row(), A3, ctx({ log:{ 'ali@example.com':Date.parse('2026-10-08T00:00:00Z') } })).reply, true);

// ---- عنوان الرد التلقائي
assert.strictEqual(E.mlAutoSubject('(غائب) {subject}', 'اجتماع'), '(غائب) اجتماع');
assert.strictEqual(E.mlAutoSubject('', 'x'), '(غائب) x');
assert.ok(!/[\r\n]/.test(E.mlAutoSubject('a\r\nBcc: e@x.com {subject}', 's\nt')));            // لا حقن ترويسات

// ---- الرد / للجميع / تحويل
const msg = { from:{ name:'علي', addr:'ali@x.com' }, to:[{ addr:'me@x.com' }, { addr:'sara@x.com' }], cc:[{ addr:'Boss@x.com' }, { addr:'ali@x.com' }],
  reply_to:[], subject:'اجتماع', date:'2026-10-12T10:00:00Z', text:'سطر1\nسطر2', msgid:'<m1@x>', references:'<m0@x>' };
let r = E.mlReplyParts(msg, 'reply', ['me@x.com']);
assert.deepStrictEqual(r.to.map(x => x.addr), ['ali@x.com']); assert.deepStrictEqual(r.cc, []);
assert.strictEqual(r.subject, 'Re: اجتماع'); assert.strictEqual(r.in_reply_to, '<m1@x>'); assert.ok(r.body.includes('> سطر2'));
r = E.mlReplyParts(msg, 'all', ['me@x.com']);
assert.deepStrictEqual(r.to.map(x => x.addr), ['ali@x.com']); assert.deepStrictEqual(r.cc.map(x => x.addr), ['sara@x.com', 'Boss@x.com']);
r = E.mlReplyParts({ ...msg, subject:'Re: اجتماع', reply_to:[{ addr:'list@x.com' }] }, 'reply', ['me@x.com']);
assert.strictEqual(r.subject, 'Re: اجتماع'); assert.deepStrictEqual(r.to.map(x => x.addr), ['list@x.com']);     // Reply-To يُحترم، ولا Re: Re:
r = E.mlReplyParts({ ...msg, from:{ addr:'me@x.com' }, to:[{ addr:'ali@x.com' }] }, 'reply', ['me@x.com']);
assert.deepStrictEqual(r.to.map(x => x.addr), ['ali@x.com']);                                                    // الرد على رسالة مرسلة
r = E.mlReplyParts(msg, 'forward', ['me@x.com']);
assert.strictEqual(r.subject, 'Fwd: اجتماع'); assert.deepStrictEqual(r.to, []); assert.strictEqual(r.in_reply_to, '');

// ---- تقسيم النص المقتبس والتوقيع
let q = E.mlQuoteSplit('شكرًا لك\nمع التحية\n-- \nأحمد\n0500\n\nOn Mon, 12 Oct 2026, Ali wrote:\n> قديم\n> أقدم');
assert.strictEqual(q.main, 'شكرًا لك\nمع التحية'); assert.strictEqual(q.sig, '-- \nأحمد\n0500'.trimEnd()); assert.ok(q.quoted.startsWith('On Mon'));
q = E.mlQuoteSplit('نعم موافق\n\n> سؤالك السابق\n> هل توافق؟');
assert.strictEqual(q.main, 'نعم موافق'); assert.ok(q.quoted.startsWith('>'));
q = E.mlQuoteSplit('From: the team is great\nbody');                          // «From:» عادي ليس اقتباسًا
assert.strictEqual(q.quoted, '');
q = E.mlQuoteSplit('رد\n\nFrom: Ali <a@x.com>\nSent: Monday\nTo: me\nSubject: x\n\nمحتوى');
assert.strictEqual(q.main, 'رد'); assert.ok(q.quoted.startsWith('From:'));
q = E.mlQuoteSplit('نص بلا اقتباس'); assert.deepStrictEqual(q, { main:'نص بلا اقتباس', sig:'', quoted:'' });

// ---- تحليل ردّ التصنيف من النموذج
assert.deepStrictEqual(E.mlParseTagJson('```json\n[{"id":12,"tags":["Work","bogus"]},{"id":13,"tags":"promo"}]\n```'), { 12:['work'], 13:['promo'] });
assert.deepStrictEqual(E.mlParseTagJson('{"5":["urgent","billing","work","social"]}'), { 5:['urgent', 'billing', 'work'] });  // حد 3
assert.deepStrictEqual(E.mlParseTagJson('لا أستطيع'), {});

// ---- قواعد التصنيف
assert.deepStrictEqual(E.mlHeuristicTags({ subject:'عرض خاص', from:{ addr:'a@b.c', name:'' }, unsub:true }), ['promo']);
assert.deepStrictEqual(E.mlHeuristicTags({ subject:'Your invoice #123', from:{ addr:'a@b.c', name:'' } }), ['billing']);
assert.deepStrictEqual(E.mlHeuristicTags({ subject:'Your verification code', from:{ addr:'a@b.c', name:'' } }), ['notice']);
assert.strictEqual(E.mlHeuristicTags({ subject:'غداء؟', from:{ addr:'a@b.c', name:'' } }), null);

// ---- متفرقات
assert.strictEqual(E.mlGuessProvider('x@gmail.com'), 'gmail'); assert.strictEqual(E.mlGuessProvider('x@hotmail.com'), 'outlook');
assert.strictEqual(E.mlGuessProvider('x@icloud.com'), 'icloud'); assert.strictEqual(E.mlGuessProvider('x@corp.example'), 'custom');
assert.deepStrictEqual(E.mlSplitAddrs('a@x.com، b@y.com; بدون, c@z.com'), ['a@x.com', 'b@y.com', 'c@z.com']);
assert.strictEqual(E.mlBytes(2048), '2 ك.ب');
console.log('mail engine: OK');
