// يشغّل منطق قرار الرد التلقائي الحقيقي من الواجهة على مدخلات JSON (stdin) — يقارنه tests/test_mailjobs.py ببايثون.
const fs = require('fs');
const inp = JSON.parse(fs.readFileSync(0, 'utf8'));
const src = fs.readFileSync(__dirname + '/../js/features/mail-engine.js', 'utf8');
const L = src.split('\n');
const code = [L[23], L[24], ...L.slice(41, 75)].join('\n');
const E = new Function(code + '\nreturn { mlWindowActive, mlAutoReplyDecision, mlAutoSubject };')();
console.log(JSON.stringify(inp.map(c => c.k === 'win' ? E.mlWindowActive(c.ar, new Date(c.now)) :
  c.k === 'sub' ? E.mlAutoSubject(c.tpl, c.s) :
  E.mlAutoReplyDecision(c.row, c.ar, { self:new Set(c.self), log:c.log, now:c.now }).reply)));
