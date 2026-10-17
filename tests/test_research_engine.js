// اختبار محرّك البحث العميق بدون شبكة: بوابة ونموذج وهميان.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../js/features/research-engine.js', 'utf8');
function build(mock){
  const ls = {}; const localStorage = { getItem:k => ls[k] ?? null, setItem:(k, v) => { ls[k] = v; } };
  const g = {
    settings:{ research:{ provider:'duckduckgo' }, endpoints:[{ id:'e1', enabled:true, url:'http://x', models:[] }] },
    epOf:() => null, activeModel:() => ({ ep:{ id:'e1', url:'http://x' }, model:'m' }), hostOf:u => u,
    store:{ get:(k, d) => { try{ return JSON.parse(ls[k]) ?? d; }catch{ return d; } }, set:(k, v) => { ls[k] = JSON.stringify(v); }, setRaw:(k, v) => { ls[k] = v; return true; } },
    localStorage, window:{}, gwReady:async () => true, gwEndpoint:e => e, gwPost:async () => ({ ok:true, events:mock.stream() }),
    gwJson:async (route, body) => mock[route](body), streamSSE:async function*(res){ for (const d of res.events) yield d; },
  };
  const names = Object.keys(g);
  return new Function(...names, src + '\nreturn { rsRun, rsJSON, rsSourcesBlock, rsGuessCategory, rsDB };')(...names.map(n => g[n]));
}
(async () => {
  let asks = 0;
  const mock = {
    search:b => ({ ok:true, results:[1, 2, 3].map(i => ({ title:'نتيجة ' + i + ' ' + b.query, url:'https://site' + i + '.com/' + encodeURIComponent(b.query), snippet:'ملخص طويل بما يكفي '.repeat(8) })) }),
    fetch:b => ({ ok:true, url:b.url, title:'صفحة', text:'محتوى الصفحة '.repeat(60), image:'https://img.example/a.jpg' }),
    once:b => {
      asks++; const u = b.messages[0].content;
      let text = 'x';
      if (/قسّم البحث/.test(u)) text = '{"category":"comparison","subtopics":["أ","ب"]}';
      else if (/استعلامات بحث قصيرة/.test(u)) text = '```json\n["استعلام ' + asks + ' أول","استعلام ' + asks + ' ثان"]\n```';
      else if (/استخرج ما يفيد/.test(u)) text = '{"relevant":true,"summary":"ملخص مفيد عن الموضوع","facts":["رقم 42"]}';
      else if (/حدّث التقرير/.test(u)) text = '## نتائج\nمعلومة [1] وأخرى [2] ومزيفة [99].' + ' حشو'.repeat(30);
      else if (/هل يكفي/.test(u)) text = '{"done":true,"gaps":[]}';
      return { ok:true, text, usage:{ in:1, out:1 } };
    },
    stream:() => [JSON.stringify({ t:'text', d:'# تقرير\n\nخلاصة [1] و[3]. ' }), JSON.stringify({ t:'text', d:'تفاصيل كثيرة '.repeat(20) + ' [88]' }), JSON.stringify({ t:'usage', in:5, out:5 })],
  };
  const E = build(mock);
  const events = [];
  const res = await E.rsRun({ question:'قارن بين أ و ب', opts:{}, am:{ ep:{ id:'e1', url:'http://x' }, model:'m' }, signal:new AbortController().signal, emit:p => events.push(p.phase) });
  assert.strictEqual(res.category, 'comparison');
  assert.ok(res.sources.length >= 4, 'sources ' + res.sources.length);
  assert.ok(!/\[88\]|\[99\]/.test(res.report), 'invalid citations removed');
  assert.ok(/## المصادر/.test(res.report) && /\[1\]|\[1،/.test(res.report));
  ['planning', 'searching', 'reading', 'analyzing', 'writing'].forEach(p => assert.ok(events.includes(p), p));
  assert.ok(res.stats.rounds >= 2, 'min 2 rounds');

  // الفشل التام: لا نتائج
  const M2 = { ...mock, search:() => ({ ok:false, error:'DDG blocked' }) };
  await assert.rejects(build(M2).rsRun({ question:'سؤال', opts:{}, am:{ ep:{ id:'e', url:'u' }, model:'m' }, signal:new AbortController().signal }), /DDG blocked|لا يُرجع/);

  // إلغاء بعد جمع نتائج → تقرير جزئي
  const ctl = new AbortController(); let calls = 0;
  const M3 = { ...mock, once:b => { if (/حدّث التقرير/.test(b.messages[0].content)) ctl.abort(); return mock.once(b); } };
  const r3 = await build(M3).rsRun({ question:'سؤال طويل', opts:{}, am:{ ep:{ id:'e', url:'u' }, model:'m' }, signal:ctl.signal });
  assert.ok(r3.partial && r3.stopped && r3.sources.length > 0);

  const E2 = build(mock);
  assert.strictEqual(E2.rsGuessCategory('كيف أثبّت بايثون'), 'howto');
  assert.strictEqual(E2.rsGuessCategory('هل صحيح أن الأرض مسطحة'), 'factcheck');
  assert.deepStrictEqual(E2.rsJSON('نص ```json\n{"a":1}\n``` تم'), { a:1 });
  console.log('OK engine tests, asks =', asks);
})().catch(e => { console.error(e); process.exit(1); });
