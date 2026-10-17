#!/usr/bin/env node
// ينسخ محرك تشغيل النماذج (wllama = llama.cpp بـ WebAssembly) من node_modules إلى مجلد التطبيق:
//   node scripts/vendor-wllama.js [المجلد الهدف]      الافتراضي: vendor/wllama
// يُستدعى تلقائيًا في بناء الـ APK (www/vendor/wllama). إن لم تُثبَّت الحزمة يكتفي بتحذير فلا يفشل البناء؛
// وفي هذه الحالة يحاول التطبيق جلب المحرك من الإنترنت عند أول تشغيل لنموذج محلي.
const fs = require('fs'), path = require('path');
const dest = path.resolve(process.argv[2] || 'vendor/wllama');
const src = path.resolve('node_modules/@wllama/wllama/esm');
if (!fs.existsSync(path.join(src, 'index.js'))) {
  console.warn('[vendor-wllama] تحذير: @wllama/wllama غير مثبّتة (نفّذ npm install). لن يُضمَّن المحرك.');
  process.exit(0);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : files.push(path.join(d, f.name)); })(dest);
const wasm = files.filter(f => f.endsWith('.wasm'));
console.log(`[vendor-wllama] نُسخ ${files.length} ملفًا إلى ${dest} (wasm: ${wasm.length})`);
if (!wasm.length) console.warn('[vendor-wllama] تحذير: لم أجد ملفات .wasm — قد يختلف تنظيم الحزمة في هذا الإصدار.');
