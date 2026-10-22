/* اختبار محرك المزامنة السحابية: لا مفاتيح في النسخة، التشفير، شواهد الحذف، الدمج بحسب الأحدث، وتصغير الصور (Node بلا متصفح) */
const vm = require('vm'), fs = require('fs'), nodeCrypto = require('crypto').webcrypto;
let mem, chatsArr, sent, serverCopy, remoteData, deleted, signedOut, imgs, savedImgs, serverQuota, serverUpdated;
const reset = () => { mem = new Map(); chatsArr = []; sent = []; serverCopy = null; remoteData = null; deleted = false; signedOut = false; imgs = {}; savedImgs = {}; serverQuota = 5242880; serverUpdated = 1; };
reset();
class FakeImage { set src(v){ this.width = 2000; this.height = 1000; setTimeout(() => this.onload && this.onload(), 0); } }
const ctx = {
  console, setInterval(){ return 0; }, setTimeout, clearTimeout, AbortController, Blob, Response, CompressionStream, DecompressionStream, TextEncoder, TextDecoder, btoa, atob, Uint8Array, crypto:nodeCrypto,
  Image:FakeImage,
  document:{ addEventListener(){}, hidden:false, body:{ appendChild(){} },
    createElement(t){ return t === 'canvas' ? { width:0, height:0, getContext:() => ({ fillRect(){}, drawImage(){}, set fillStyle(v){} }), toDataURL:() => 'data:image/jpeg;base64,' + 'A'.repeat(3000) } : { style:{}, remove(){} }; } },
  location:{ reload(){} }, window:{},
  MANAGED_URL:'https://x.test/qk', MANAGED_SECRET:'',
  QuarkAuth:{ session:() => ({ token:'qs.t', email:'a@b.c' }), signOut(){ signedOut = true; } },
  QuarkKV:{ keys:() => [...mem.keys()], get:k => mem.has(k) ? mem.get(k) : null, flush:async () => {}, remove:k => mem.delete(k), set:(k, v) => mem.set(k, v) },
  store:{ get(k, d){ if (k === 'ai_chats') return chatsArr; return mem.has(k) ? JSON.parse(mem.get(k)) : d; }, set(k, v){ if (k === 'ai_chats') chatsArr = v; else mem.set(k, JSON.stringify(v)); }, remove(k){ mem.delete(k); } },
  eachMsg:(c, fn) => (c.messages || []).forEach(fn), imgData:async id => imgs[id] || null, imgSave:async i => { savedImgs[i.id] = i.data; }, imgDB:{ keys:async () => [], del:async () => {} }, imgCache:new Map(),
  qConfirm:async () => true,
  fetch:async (url, o) => {
    if (o.method === 'DELETE'){ deleted = true; return { status:200, json:async () => ({ deleted:true }) }; }
    if (o.method === 'PUT'){ sent.push(o.body); serverCopy = o.body; serverUpdated = Date.now(); return { status:200, json:async () => ({ used:o.body.length, quota:serverQuota, updated:serverUpdated }) }; }
    if (/\/sync\/data$/.test(url)) return { status:200, json:async () => remoteData };
    return { status:200, json:async () => ({ used:serverCopy ? serverCopy.length : 0, quota:serverQuota, updated:serverUpdated }) };
  },
};
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/features/cloud-sync.js', 'utf8') + '\nthis.__C = QuarkCloud;', ctx);
const C = ctx.__C, T = C._t; let bad = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) bad++; };
const seed = () => {
  chatsArr = [{ id:'c1', ts:5, messages:[{ role:'user', content:'hi', imgs:[{ id:'i1' }] }] }, { id:'t', temp:true, messages:[] }];
  mem.set('ai_settings_v3', JSON.stringify({ theme:'dark', endpoints:[{ id:'e1', key:'sk-SECRET', models:[] }, { id:'managed', managed:true, key:'qs.zzz' }] }));
  mem.set('ai_voice_v1', JSON.stringify({ conns:[{ id:'v1', key:'VOICEKEY', preset:'openai' }] }));
  mem.set('ai_integrations_v1', JSON.stringify([{ id:'g', api_key:'TOKEN123', name:'G' }]));
  mem.set('ai_lock', '"1234"'); mem.set('ai_auth', '{"token":"x"}'); mem.set('ai_sub', '{"exp":1}'); mem.set('ai_profile', '{"name":"سارة"}');
  imgs.i1 = 'data:image/png;base64,' + 'B'.repeat(60000);
};
(async () => {
  /* ===== الأساس: بلا تشفير ===== */
  seed();
  ok(await C.push(true), 'الرفع نجح');
  let body = sent[0], j = JSON.parse(body);
  ok(!/SECRET|VOICEKEY|TOKEN123|qs\.zzz|1234/.test(body), 'لا مفاتيح ولا رموز ولا قفل في النسخة');
  ok(j.items.ai_settings_v3.theme === 'dark' && j.items.ai_settings_v3.endpoints.length === 1 && j.items.ai_settings_v3.endpoints[0].key === '', 'الإعدادات بمفتاح فارغ وبلا نقطة المدار');
  ok(!('ai_lock' in j.items) && !('ai_auth' in j.items) && !('ai_sub' in j.items), 'القفل والجلسة والاشتراك خارج النسخة');
  ok(j.items.ai_chats.length === 1, 'المحادثة المؤقتة لا تُحفظ');
  ok(j.imgs.i1 && j.imgs.i1.startsWith('data:image/jpeg') && j.imgs.i1.length < 5000, 'الصورة الكبيرة صُغّرت قبل الرفع');
  ok(imgs.i1.startsWith('data:image/png'), 'الصورة المحلية الأصلية لم تُمسّ');
  ok(j.kt && j.kt.ai_chats > 0 && typeof j.tomb === 'object', 'النسخة فيها أوقات التعديل وشواهد الحذف');
  sent.length = 0; ok(await C.push(false) && sent.length === 0, 'لا رفع إن لم يتغيّر شيء');

  /* ===== شواهد الحذف ===== */
  chatsArr = [{ id:'c1', ts:5, messages:[] }, { id:'c2', ts:6, messages:[{ role:'user', content:'x' }] }];
  await C.push(true); chatsArr = chatsArr.filter(c => c.id !== 'c2'); await C.push(true);
  j = JSON.parse(sent[sent.length - 1]); ok(j.tomb.c2 > 0 && j.items.ai_chats.length === 1, 'حذف المحادثة محليًا يُسجَّل كشاهد حذف');
  /* جهاز آخر عنده c2 ويستلم النسخة: تُحذف عنده */
  chatsArr = [{ id:'c1', ts:5, messages:[] }, { id:'c2', ts:6, messages:[] }];
  await T.apply({ items:{ ai_chats:[{ id:'c1', ts:5, messages:[] }] }, tomb:{ c2:Date.now() }, kt:{} });
  ok(chatsArr.map(c => c.id).join() === 'c1', 'الحذف على جهاز يُطبَّق على الجهاز الآخر بدل أن تعود المحادثة');
  /* محادثة حذفتها هنا (معروفة سابقًا) ولا تزال في السحابة: لا تعود */
  T.setMeta({ known:['c1', 'c9'], tomb:{} }); chatsArr = [{ id:'c1', ts:5, messages:[] }];
  await T.apply({ items:{ ai_chats:[{ id:'c1', ts:5, messages:[] }, { id:'c9', ts:9, messages:[] }, { id:'c10', ts:10, messages:[] }] }, tomb:{}, kt:{} });
  ok(chatsArr.map(c => c.id).sort().join() === 'c1,c10', 'المحذوف محليًا لا يعود من السحابة، والجديد يُضاف');
  /* الأحدث نشاطًا يفوز */
  await T.apply({ items:{ ai_chats:[{ id:'c1', ts:50, messages:[{ role:'user', content:'new' }] }] }, tomb:{}, kt:{} });
  ok(chatsArr.find(c => c.id === 'c1').ts === 50, 'نسخة المحادثة الأحدث تفوز');

  /* ===== الدمج بحسب آخر تعديل ===== */
  reset(); seed(); await C.push(true);
  mem.set('ai_profile', '{"name":"محلي"}'); await C.push(false);               /* تعديل محلي الآن */
  await T.apply({ items:{ ai_profile:{ name:'قديم' } }, tomb:{}, kt:{ ai_profile:1000 } });
  ok(JSON.parse(mem.get('ai_profile')).name === 'محلي', 'تعديل محلي أحدث من السحابة يبقى');
  await T.apply({ items:{ ai_profile:{ name:'جديد' } }, tomb:{}, kt:{ ai_profile:Date.now() + 60000 } });
  ok(JSON.parse(mem.get('ai_profile')).name === 'جديد', 'تعديل السحابة الأحدث يفوز');
  await T.apply({ items:{ ai_settings_v3:{ theme:'light', endpoints:[{ id:'e1', key:'', models:[] }, { id:'e2', key:'', models:[] }] }, ai_voice_v1:{ conns:[{ id:'v1', key:'', preset:'openai' }] } }, tomb:{}, kt:{ ai_settings_v3:Date.now() + 60000, ai_voice_v1:Date.now() + 60000 } });
  const st = JSON.parse(mem.get('ai_settings_v3'));
  ok(st.theme === 'light' && st.endpoints.length === 3 && st.endpoints.find(e => e.id === 'e1').key === 'sk-SECRET' && st.endpoints.some(e => e.id === 'managed'), 'الإعدادات: الأحدث يفوز وتُدمج نقاط الاتصال وتبقى مفاتيح الجهاز');
  ok(JSON.parse(mem.get('ai_voice_v1')).conns[0].key === 'VOICEKEY', 'مفتاح الصوت المحلي لم يُمسّ');
  await T.apply({ items:{ ai_chats:[] }, imgs:{ i7:'data:image/jpeg;base64,AAAA' }, tomb:{}, kt:{} }); ok(savedImgs.i7, 'الصور القادمة تُحفظ');

  /* ===== التشفير ===== */
  reset(); seed();
  ok(!C.encOn(), 'التشفير مطفأ افتراضيًا');
  ok(await C.enableEnc('كلمة-سر-قوية-123', false), 'تفعيل التشفير ورفع نسخة مشفّرة');
  body = sent[sent.length - 1]; j = JSON.parse(body);
  ok(j.enc === 'aes-gcm' && j.kdf === 'pbkdf2-sha256' && j.iter === 600000 && j.ct && !j.items, 'النسخة مغلّف مشفّر: AES-GCM + PBKDF2 600k');
  ok(!/hi|سارة|dark|ai_chats|SECRET/.test(body.replace(/"(salt|iv|ct)":"[^"]*"/g, '')) && !/سارة/.test(Buffer.from(j.ct, 'base64').toString()), 'الخادم لا يرى أي نص مقروء');
  const key = await T.deriveKey('كلمة-سر-قوية-123', T.unb64(j.salt), j.iter);
  let inner = await T.open(j, key);
  ok(inner.items.ai_profile.name === 'سارة' && inner.keys === false, 'فك التشفير بكلمة السر الصحيحة يعيد البيانات');
  ok(!JSON.stringify(inner).includes('sk-SECRET'), 'المفاتيح غير مرفوعة ما دامت مزامنة المفاتيح معطّلة');
  let threw = false; try{ await T.open(j, await T.deriveKey('كلمة-خاطئة-00000', T.unb64(j.salt), j.iter)); }catch{ threw = true; }
  ok(threw, 'كلمة سر خاطئة لا تفتح النسخة');
  let tampered = JSON.parse(body); tampered.ct = tampered.ct.slice(0, -8) + 'AAAAAAA='; threw = false;
  try{ await T.open(tampered, key); }catch{ threw = true; } ok(threw, 'العبث بالنص المشفّر يُكتشف');
  ok(await C.setKeysSync(true), 'تفعيل مزامنة المفاتيح');
  j = JSON.parse(sent[sent.length - 1]); inner = await T.open(j, key);
  ok(inner.keys === true && inner.items.ai_settings_v3.endpoints.find(e => e.id === 'e1').key === 'sk-SECRET' && inner.items.ai_voice_v1.conns[0].key === 'VOICEKEY', 'المفاتيح تُرفع داخل النسخة المشفّرة فقط');
  ok(!inner.items.ai_settings_v3.endpoints.some(e => e.managed) && !('ai_auth' in inner.items) && !('ai_lock' in inner.items), 'جلسة الحساب والقفل لا تُرفع حتى مع مزامنة المفاتيح');
  ok(!/sk-SECRET|VOICEKEY/.test(sent[sent.length - 1]), 'لا تظهر المفاتيح في الجسم المُرسل للخادم');
  /* جهاز آخر لا يملك المفتاح: تتوقف المزامنة ولا يكتب فوق النسخة */
  const keep = mem.get('ai_kv_ckey'); mem.delete('ai_kv_ckey');
  ok((await T.decodeRemote(j, false)) === null && C.locked(), 'بلا كلمة سر: المزامنة تتوقف (مقفلة)');
  sent.length = 0; ok(!(await C.push(true)) && sent.length === 0, 'وهي مقفلة لا يُرفع شيء فلا تُمحى النسخة المشفّرة');
  mem.set('ai_kv_ckey', keep);
  ok((await T.decodeRemote(j, false)).items.ai_profile.name === 'سارة', 'المفتاح المحفوظ على الجهاز يفكّها تلقائيًا');
  /* تغيير كلمة السر وإيقاف التشفير */
  const oldSalt = j.salt; ctx.__lockReset = true;
  ok(await C.changePass('كلمة-جديدة-456789'), 'تغيير كلمة السر');
  j = JSON.parse(sent[sent.length - 1]); ok(j.salt !== oldSalt, 'ملح جديد بعد تغيير الكلمة');
  ok(await C.disableEnc(), 'إيقاف التشفير'); j = JSON.parse(sent[sent.length - 1]); ok(!j.enc && j.items && !/SECRET/.test(sent[sent.length - 1]), 'بعد الإيقاف: نسخة عادية بلا مفاتيح');

  /* ===== أحجام الصور ضمن 5MB ===== */
  reset(); seed(); imgs.i1 = 'data:image/png;base64,' + 'B'.repeat(2000000); serverQuota = 30000;
  await C.push(true); j = JSON.parse(sent[sent.length - 1]);
  ok(Object.keys(j.imgs).length === 1 && JSON.stringify(j).length < 30000, 'صورة بحجم 2MB تتّسع في مساحة صغيرة بعد التصغير');
  /* ===== حذف الحساب ===== */
  mem.set('ai_sub', '{"plan":"pro"}');
  const r = await C.deleteAccount();
  ok(r.ok && deleted && signedOut, 'حذف الحساب من الخادم وتسجيل الخروج');
  ok(chatsArr.length === 0 && !mem.has('ai_settings_v3') && !mem.has('ai_voice_v1') && !mem.has('ai_profile') && !mem.has('ai_sub') && !mem.has('ai_kv_ckey'), 'مسح بيانات الجهاز والمفاتيح والاشتراك ومفتاح التشفير');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('✗ استثناء:', e && e.stack || e); process.exit(1); });
