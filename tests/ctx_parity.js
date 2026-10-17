// يشغّل منطق الذاكرة والمهارات الحقيقي من الواجهة على مدخلات JSON (stdin) ويطبع النتائج — يقارنها tests/test_tasks.py ببايثون.
const fs = require('fs');
const inp = JSON.parse(fs.readFileSync(0, 'utf8'));
const cut = (f, a, b) => { const s = fs.readFileSync(__dirname + '/../js/features/' + f, 'utf8'); return s.slice(s.indexOf(a), s.indexOf(b)); };
const mm = cut('memory-engine.js', '/* ================= النصوص والتشابه', '/* ================= قراءة ناتج النموذج') ;
const sk = cut('skills-engine.js', '/* ================= المطابقة', '/* ================= التثبيت اليدوي');
let mem = inp.memories;
const g = { settings:{ memory:inp.memCfg, skills:inp.skCfg }, mmDB:{ list:() => mem } };
const code = 'const MM_CATS={}, MM_MAX_LEN=400;\n' + mm + '\n' + sk + '\nconst SK_SENS = { strict:{ min:.34 }, balanced:{ min:.22 }, loose:{ min:.13 } };\nconst skDB={list:()=>__skills,get:()=>null};\nreturn { mmSelect, skSelect, mmTok, skTok };';
const names = Object.keys(g);
const E = new Function(...names, '__skills', code)(...names.map(n => g[n]), inp.skills);
console.log(JSON.stringify(inp.queries.map(q => ({ mem:E.mmSelect(q).map(m => m.id), sk:E.skSelect(q).map(s => s.name), mt:E.mmTok(q), st:E.skTok(q) }))));
