/* اختبار محرك المزامنة السحابية: لا مفاتيح في النسخة، ودمج/استعادة صحيحان (Node بلا متصفح) */
const vm = require('vm'), fs = require('fs');
const mem = new Map(); let chatsArr = [];
const sent = [];
let serverCopy = null, remoteData = null;
const ctx = {
  console, setInterval(){ return 0; }, setTimeout(){ return 0; }, clearTimeout(){}, AbortController, Blob,
  document:{ addEventListener(){}, hidden:false, createElement(){ return { style:{}, remove(){} }; }, body:{ appendChild(){} } },
  location:{ reload(){} }, window:{},
  MANAGED_URL:'https://x.test/qk', MANAGED_SECRET:'',
  QuarkAuth:{ session:() => ({ token:'qs.t', email:'a@b.c' }) },
  QuarkKV:{ keys:() => [...mem.keys()], get:k => mem.has(k) ? mem.get(k) : null, flush:async () => {}, remove:k => mem.delete(k), set:(k, v) => mem.set(k, v) },
  store:{ get(k, d){ if (k === 'ai_chats') return chatsArr; return mem.has(k) ? JSON.parse(mem.get(k)) : d; }, set(k, v){ if (k === 'ai_chats') chatsArr = v; else mem.set(k, JSON.stringify(v)); }, remove(k){ mem.delete(k); } },
  eachMsg:(c, fn) => (c.messages || []).forEach(fn), imgData:async id => id === 'i1' ? 'data:image/png;base64,AAAA' : null, imgSave:async () => {}, imgDB:{ keys:async () => [], del:async () => {} }, imgCache:new Map(),
  qConfirm:async () => true,
  fetch:async (url, o) => {
    if (o.method === 'PUT'){ sent.push(o.body); serverCopy = o.body; return { status:200, json:async () => ({ used:o.body.length, quota:5242880, updated:Date.now() }) }; }
    if (/\/sync\/data$/.test(url)) return { status:200, json:async () => remoteData };
    return { status:200, json:async () => ({ used:serverCopy ? serverCopy.length : 0, quota:5242880, updated:1 }) };
  },
};
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/features/cloud-sync.js', 'utf8') + '\nthis.__C = QuarkCloud;', ctx);
const C = ctx.__C; let bad = 0; const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) bad++; };
(async () => {
  chatsArr = [{ id:'c1', ts:5, messages:[{ role:'user', content:'hi', imgs:[{ id:'i1' }] }] }, { id:'t', temp:true, messages:[] }];
  mem.set('ai_settings_v3', JSON.stringify({ theme:'dark', endpoints:[{ id:'e1', key:'sk-SECRET', models:[] }, { id:'managed', managed:true, key:'qs.zzz' }] }));
  mem.set('ai_voice_v1', JSON.stringify({ conns:[{ id:'v1', key:'VOICEKEY', preset:'openai' }] }));
  mem.set('ai_integrations_v1', JSON.stringify([{ id:'g', api_key:'TOKEN123', name:'G' }]));
  mem.set('ai_lock', '"1234"'); mem.set('ai_auth', '{"token":"x"}'); mem.set('ai_sub', '{"exp":1}'); mem.set('ai_profile', '{"name":"سارة"}');
  ok(await C.push(true), 'الرفع نجح');
  const body = sent[0], j = JSON.parse(body);
  ok(!/SECRET|VOICEKEY|TOKEN123|qs\.zzz|1234/.test(body), 'لا مفاتيح ولا رموز ولا قفل في النسخة');
  ok(j.items.ai_settings_v3.theme === 'dark' && j.items.ai_settings_v3.endpoints.length === 1 && j.items.ai_settings_v3.endpoints[0].key === '', 'الإعدادات محفوظة بمفتاح فارغ وبلا نقطة المدار');
  ok(j.items.ai_profile.name === 'سارة', 'الملف الشخصي محفوظ');
  ok(!('ai_lock' in j.items) && !('ai_auth' in j.items) && !('ai_sub' in j.items), 'القفل والجلسة والاشتراك خارج النسخة');
  ok(j.items.ai_chats.length === 1, 'المحادثة المؤقتة لا تُحفظ');
  ok(j.imgs.i1 && j.imgs.i1.startsWith('data:image/'), 'صور المحادثات محفوظة');
  ok(C.sizes().chats > 0 && C.info().quota === 5242880, 'الأحجام والحد 5MB');
  sent.length = 0; ok(await C.push(false) && sent.length === 0, 'لا رفع إن لم يتغيّر شيء');
  /* استعادة على جهاز فيه مفاتيحه: تبقى المفاتيح المحلية */
  const remote = remoteData = { items:{ ai_settings_v3:{ theme:'light', endpoints:[{ id:'e1', key:'', models:[] }, { id:'e2', key:'', models:[] }] }, ai_voice_v1:{ conns:[{ id:'v1', key:'', preset:'openai' }] }, ai_chats:[{ id:'c2', ts:9, messages:[{ role:'user', content:'x' }] }] }, imgs:{} };
  chatsArr = [{ id:'c1', ts:5, messages:[{ role:'user', content:'hi' }] }];
  mem.set('ai_voice_v1', JSON.stringify({ conns:[{ id:'v1', key:'VOICEKEY', preset:'openai' }] }));
  mem.set('ai_settings_v3', JSON.stringify({ theme:'dark', endpoints:[{ id:'e1', key:'sk-SECRET', models:[] }] }));
  await ctx.__C.restoreNow();
  ok(chatsArr.length === 2, 'دمج المحادثات بلا حذف');
  const st = JSON.parse(mem.get('ai_settings_v3'));
  ok(st.endpoints.find(e => e.id === 'e1').key === 'sk-SECRET', 'مفتاح الجهاز المحلي لم يُمسّ');
  ok(JSON.parse(mem.get('ai_voice_v1')).conns[0].key === 'VOICEKEY', 'مفتاح الصوت المحلي لم يُمسّ');
  process.exit(bad ? 1 : 0);
})();
