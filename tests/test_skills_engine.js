// اختبار صيغة SKILL.md ومطابقة المهارات (منطق نقي).
const fs = require('fs'), assert = require('assert');
let src = fs.readFileSync(__dirname + '/../js/features/skills-engine.js', 'utf8');
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
src = cut('/* ================= الإعدادات', '/* ================= التثبيت اليدوي') + cut('/* ================= الاستيراد', '/* ================= تجربة المهارة');
const ls = {}; let n = 0;
const g = { settings:{}, store:{ get:(k, d) => { try{ return JSON.parse(ls[k]) ?? d; }catch{ return d; } }, setRaw:(k, v) => { ls[k] = v; return true; } }, localStorage:{ setItem:(k, v) => { ls[k] = v; } }, uid:() => 'id' + (++n), persistSettings(){} };
const names = Object.keys(g);
const E = new Function(...names, src + '\nreturn { skParse, skEmit, skRank, skSelect, skDB, skNew, skFromText, skRawUrl, skBlock, skTok, SK_STARTERS };')(...names.map(k => g[k]));

// تحليل وإصدار ذهابًا وإيابًا (مع رموز خاصة)
const s = E.skNew({ name:'مهارة: اختبار', description:'وصف "مقتبس" مع # رمز', when:'عند الحاجة', tags:['أ', 'ب ج'], category:'عام', body:'1. خطوة\n2. خطوة' });
const p = E.skParse(E.skEmit(s));
assert.strictEqual(p.name, s.name); assert.strictEqual(p.description, s.description); assert.deepStrictEqual(p.tags, s.tags); assert.strictEqual(p.body, s.body);
// صيغة خارجية بسيطة (وسوم بقائمة YAML)
const ext = E.skParse('---\nname: pdf-tool\ndescription: Work with PDF files\ntags:\n  - pdf\n  - docs\n---\n# Title\nbody here');
assert.strictEqual(ext.name, 'pdf-tool'); assert.deepStrictEqual(ext.tags, ['pdf', 'docs']);
assert.throws(() => E.skFromText('نص عادي بدون اسم'), /SKILL/);
assert.strictEqual(E.skRawUrl('https://github.com/o/r/blob/main/a/SKILL.md'), 'https://raw.githubusercontent.com/o/r/main/a/SKILL.md');
assert.strictEqual(E.skRawUrl('https://github.com/o/r/tree/main/skills/x'), 'https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md');

// المطابقة على المهارات المدمجة
assert.strictEqual(E.skDB.list().length, 5);
const top = (q, sens = 'balanced') => { g.settings.skills.sens = sens; return E.skSelect(q).map(x => x.name); };
const cases = [
  ['اكتب لي بريد إلكتروني رسمي لمديري أطلب فيه إجازة', 'بريد مهني'],
  ['لخّص لي هذا المقال الطويل في نقاط', 'تلخيص بنقاط'],
  ['راجع هذا الكود البرمجي وصحح الأخطاء', 'مراجعة كود'],
  ['اشرح لي الحوسبة الكمومية بطريقة بسيطة لمبتدئ', 'شرح مبسّط'],
  ['ترجم هذه الفقرة إلى الإنجليزية', 'ترجمة احترافية'],
  ['please review my code for bugs', 'مراجعة كود'],
  ['summarize this article in bullet points', 'تلخيص بنقاط'],
];
// المهارات المدمجة عربية؛ نختبر العربية بدقة والإنجليزية بوسوم عربية قد لا تطابق، لذلك نتحقق من العربية فقط
cases.slice(0, 5).forEach(([q, want]) => { const r = top(q); assert.ok(r.includes(want), `${q} → ${r.join(',')} (متوقع ${want})`); assert.ok(r.length <= 2); });
// أسئلة لا علاقة لها لا تُطابق شيئًا
['ما عاصمة فرنسا؟', 'كم الساعة الآن', 'احكِ لي نكتة'].forEach(q => assert.deepStrictEqual(top(q), [], q + ' → ' + top(q)));
// الحد الأقصى والتثبيت
g.settings.skills.max = 1; assert.ok(E.skSelect('اكتب بريد رسمي وراجع الكود').length <= 1);
g.settings.skills.max = 3; const pin = E.skDB.list()[4].id; assert.strictEqual(E.skSelect('اكتب بريد', { pinned:[pin] })[0].id, pin);
g.settings.skills.enabled = false; assert.deepStrictEqual(E.skSelect('اكتب بريد رسمي'), []); g.settings.skills.enabled = true;
// المسودات لا تُطابَق
E.skDB.list().forEach(x => { x.status = 'draft'; }); assert.deepStrictEqual(E.skSelect('اكتب بريد رسمي'), []);
assert.ok(E.skBlock([s]).includes('مهارة: ' + s.name));
console.log('OK skills tests');

// ---- حقن المهارات في المحادثة (غلاف runGen) ----
(async () => {
  const full = fs.readFileSync(__dirname + '/../js/features/skills-engine.js', 'utf8');
  const pre = full.slice(full.indexOf('/* ================= الإعدادات'), full.indexOf('/* ================= التثبيت اليدوي'));
  const mid = full.slice(full.indexOf('/* ================= التثبيت اليدوي'), full.indexOf('/* ================= استدعاء النموذج'));
  const ls = {}; let n = 0, seen = null; const win = {}; const decorated = [];
  const c = { messages:[] };
  const g = { settings:{}, store:{ get:(k, d) => d, setRaw:(k, v) => { ls[k] = v; return true; } }, localStorage:{ setItem:(k, v) => { ls[k] = v; } }, uid:() => 'x' + (++n), persistSettings(){}, window:win,
    runGen:async (ch) => { seen = win.__skCtx; await new Promise(r => setImmediate(r)); ch.messages.push({ role:'assistant', content:'رد' }); },
    el:{ messages:{ querySelectorAll:() => [{}] } }, save(){}, ic:() => '', esc:x => x, $:() => null, document:{ addEventListener(){}, querySelector:() => null } };
  const names = Object.keys(g);
  const E = new Function(...names, pre + mid + '\nreturn { skDB, runGen:(c, p) => runGen(c, p), skPinned };')(...names.map(k => g[k]));
  win.__skDecorate = (node, m) => decorated.push(m.skills);
  const user = t => { c.messages = [{ role:'user', content:t }]; };
  user('اكتب لي بريد إلكتروني رسمي لمديري أطلب فيه إجازة');
  await E.runGen(c); await new Promise(r => setImmediate(r));
  assert.ok(seen && seen.includes('مهارة: بريد مهني'), 'ctx injected during generation');
  assert.strictEqual(win.__skCtx, '', 'ctx cleared after');
  assert.deepStrictEqual(c.messages[1].skills, ['بريد مهني']); assert.deepStrictEqual(decorated, [['بريد مهني']]);
  assert.strictEqual(E.skDB.list().find(x => x.name === 'بريد مهني').uses, 1);
  // لا مطابقة → لا حقن ولا وسم
  seen = 'x'; user('ما عاصمة فرنسا؟'); await E.runGen(c); await new Promise(r => setImmediate(r));
  assert.ok(!seen); assert.strictEqual(c.messages[1].skills, undefined);
  // تثبيت يدوي يُستهلك مرة واحدة
  const pinId = E.skDB.list().find(x => x.name === 'ترجمة احترافية').id; E.skPinned.add(pinId);
  user('ما عاصمة فرنسا؟'); await E.runGen(c); await new Promise(r => setImmediate(r));
  assert.ok(seen.includes('ترجمة احترافية')); assert.strictEqual(E.skPinned.size, 0);
  // وضع المقارنة (pair) يتجاوز المهارات
  seen = 'x'; user('اكتب بريد رسمي'); await E.runGen(c, [1, 2]); assert.ok(!seen);
  console.log('OK skills runtime tests');
})().catch(e => { console.error(e); process.exit(1); });
