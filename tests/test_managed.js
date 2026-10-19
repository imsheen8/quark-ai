// يتأكد أن managed.js لا يفعل شيئًا حين MANAGED_URL فارغ، ويضيف نقطة اتصال حين يُضبط
const fs = require('fs'); const vm = require('vm');
let ok = 0, bad = 0; const t = (n, c) => { console.log((c ? '✓ ' : '✗ ') + n); c ? ok++ : bad++; };
const src = fs.readFileSync(__dirname + '/../js/features/managed.js', 'utf8');
function run(url) {
  const kv = {}; let saved = 0;
  const ctx = { settings: { endpoints: [], sel: null }, persistSettings: () => saved++, store: { get: (k, d) => kv[k] ?? d, set: (k, v) => { kv[k] = v; } }, crypto: require('crypto').webcrypto, window: {}, fetch: async () => ({ ok: false }), console };
  vm.createContext(ctx);
  vm.runInContext(src.replace(/const MANAGED_URL = '[^']*'/, `const MANAGED_URL = '${url}'`) + '\nthis.__r={ensureManaged,managedDeviceId}', ctx);
  return { ctx, saved: () => saved, kv };
}
let r = run(''); t('فارغ: لا نقطة اتصال', r.ctx.settings.endpoints.length === 0 && r.saved() === 0);
r = run('https://x.test/v1'); const e = r.ctx.settings.endpoints[0];
t('نقطة مُدارة مضافة ومختارة', e && e.managed && e.url === 'https://x.test/v1' && r.ctx.settings.sel.ep === 'managed');
t('المفتاح معرّف الجهاز (≥16)', /^[A-Za-z0-9]{16,80}$/.test(e.key) && e.key === r.kv.ai_device_id);
r.ctx.__r.ensureManaged(); t('لا تكرار عند الاستدعاء ثانيةً', r.ctx.settings.endpoints.length === 1);
console.log(`${ok}/${ok + bad}`); process.exit(bad ? 1 : 0);
