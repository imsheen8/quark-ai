/* QUARK AI — تبويب التخزين */
'use strict';

/* ----- تبويب التخزين ----- */
function lsSize(k){ try{ return QuarkKV.size(k); }catch{ return 0; } }
const fmtBytes = b => b < 1024 ? Math.round(b) + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
/* حجم الصور المخزّنة في IndexedDB (نص base64 → بايت تقريبًا) */
async function imgsBytes(){
  if (QuarkKV.server) return 0;                       /* على الخادم: تأتي الأحجام من store/stats */
  try{ const keys = await imgDB.keys(); let n = 0; for (const k of keys){ const v = await imgDB.get(k); if (typeof v === 'string') n += Math.round(v.length * .75); } return n; }catch{ return 0; }
}
let storTok = 0;
async function renderStorageBar(){
  const tok = ++storTok;
  let chatsB = lsSize('ai_chats') + lsSize('ai_current');
  let lsAll = 0; if (!QuarkKV.server){ try{ for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); lsAll += (k.length + (localStorage.getItem(k) || '').length) * 2; } }catch{} }
  let imgs = await imgsBytes();
  let usage = 0, quota = 0;
  let other = 0, where = ' (المتاح للتطبيق)', onServer = false;
  /* البوتات = النماذج المحمّلة على الجهاز (مجموعها فقط) */
  let botsB = 0; try{ botsB = (window.__od && __od.store && __od.store.totalBytes()) || 0; }catch{}
  const cloudOn = !!(window.QuarkCloud && QuarkCloud.active());
  $('cloudRows').hidden = !cloudOn;
  if (cloudOn) paintCloudRows();
  $('storMode').textContent = cloudOn ? 'التخزين السحابي — مساحة حسابك' + (QuarkCloud.encOn() ? ' · 🔒 مشفّر' : '') : 'مساحة الجهاز';
  $('lgBotsLbl').textContent = cloudOn ? 'بوتات (على الجهاز)' : 'بوتات';
  if (cloudOn){
    /* مستخدم الاستضافة: مساحة الحساب (5MB مجانًا) بدل مساحة الجهاز */
    const inf = await QuarkCloud.refreshInfo().catch(() => null) || QuarkCloud.info() || {};
    const sz = QuarkCloud.sizes();
    chatsB = sz.chats; imgs = sz.imgs; other = sz.other; usage = inf.used || (chatsB + imgs + other); quota = inf.quota || 5 * 1048576;
    where = ' (مساحة حسابك السحابية)'; onServer = true;
  } else if (QuarkKV.server){
    /* التخزين في بايثون: الأحجام الحقيقية من الخادم، والسقف = ما يتسع له القرص */
    const st = await QuarkKV.stats().catch(() => null);
    if (st){ chatsB = st.chats; imgs = st.files; other = st.kv; usage = chatsB + imgs + other; quota = usage + st.disk_free; where = ' (مساحة القرص المتاحة)'; onServer = true; }
  } else {
    try{ if (navigator.storage && navigator.storage.estimate){ const e = await navigator.storage.estimate(); usage = e.usage || 0; quota = e.quota || 0; } }catch{}
  }
  if (tok !== storTok) return;
  if (!onServer) other = Math.max(0, lsAll - chatsB);
  const mine = chatsB + imgs + other + (cloudOn ? 0 : botsB);
  if (!usage || usage < mine) usage = mine;          /* التقدير غير متاح → نستخدم المجموع الفعلي */
  const estimated = quota > 0;
  if (!estimated) quota = 5 * 1048576;               /* احتياطي: حد localStorage التقريبي */
  const pct = Math.min(100, usage / quota * 100), w = v => Math.min(100, v / quota * 100);
  const min = v => v > 0 ? Math.max(w(v), .6) : 0;   /* لا يختفي الجزء الصغير */
  $('storUsed').textContent = fmtBytes(usage);
  $('storOf').textContent = 'من ' + fmtBytes(quota) + (estimated ? where : ' (حد تقريبي)');
  const ptxt = pct < 1 && usage > 0 ? '<1%' : Math.round(pct) + '%';
  $('storPct').textContent = ptxt;
  $('storBar').setAttribute('aria-valuenow', Math.round(pct));
  $('segBots').style.width = cloudOn ? '0%' : min(botsB) + '%'; $('lgBots').textContent = fmtBytes(botsB);
  $('segChats').style.width = min(chatsB) + '%'; $('segImgs').style.width = min(imgs) + '%'; $('segOther').style.width = min(other) + '%';
  $('lgChats').textContent = fmtBytes(chatsB); $('lgImgs').textContent = fmtBytes(imgs); $('lgOther').textContent = fmtBytes(other);
  const free = Math.max(0, quota - usage);
  if (cloudOn){
    const st = QuarkCloud.status(), at = QuarkCloud.lastAt(), sk = QuarkCloud.skipped();
    const line = st === 'full' ? 'مساحتك السحابية ممتلئة — لم تُحفظ آخر التغييرات. احذف محادثات قديمة.'
      : st === 'error' || st === 'auth' ? (QuarkCloud.error() || 'تعذّرت المزامنة') + ' — ستُعاد المحاولة تلقائيًا.'
      : st === 'locked' || QuarkCloud.locked() ? 'النسخة السحابية مشفّرة — المزامنة متوقفة حتى تُدخل كلمة السر.'
      : st === 'pending' ? 'في انتظار دمج تغييرات من جهاز آخر…'
      : st === 'syncing' ? 'جارٍ المزامنة…'
      : `المتبقي ${fmtBytes(Math.max(0, quota - usage))} · ` + (at ? 'آخر مزامنة ' + new Date(at).toLocaleTimeString('ar', { hour:'2-digit', minute:'2-digit' }) : 'لم تتم المزامنة بعد') + (sk ? ` · تخطّت ${sk} صورة لضيق المساحة` : '');
    $('storFree').textContent = line; $('storCard').classList.toggle('warn', pct >= 85 || st === 'full'); return;
  }
  $('storFree').textContent = pct >= 85 ? `المساحة شبه ممتلئة — المتبقي ${fmtBytes(free)}. صدّر نسخة احتياطية واحذف محادثات قديمة.` : `المتبقي ${fmtBytes(free)} من المساحة.`;
  $('storCard').classList.toggle('warn', pct >= 85);
}
function paintCloudRows(){
  const enc = QuarkCloud.encOn(), lk = QuarkCloud.locked();
  $('cloudUnlock').hidden = !lk;
  $('cloudEnc').hidden = lk;
  $('cloudEncT').textContent = enc ? 'إيقاف التشفير' : 'تشفير النسخة بكلمة سر';
  $('cloudEncS').textContent = enc ? 'مفعّل 🔒 — الخادم لا يقرأ بياناتك' : 'لا يقرأ الخادم بياناتك، ويتيح مزامنة المفاتيح بأمان';
  $('cloudEncPass').hidden = !enc || lk; $('cloudEncKeys').hidden = !enc || lk;
  $('cloudEncKeysS').textContent = QuarkCloud.keysOn() ? 'مفعّلة — تُرفع مشفّرة وتظهر على أجهزتك الأخرى' : 'معطّلة — تُدخل المفاتيح على كل جهاز';
}
const encToast = ok => toast(ok ? 'تمت المزامنة' : (QuarkCloud.status() === 'full' ? 'مساحتك السحابية ممتلئة' : 'تعذّرت المزامنة'));
$('cloudEnc').addEventListener('click', async () => {
  if (QuarkCloud.encOn()){
    if (!await qConfirm('إيقاف التشفير؟ ستُرفع نسختك بلا تشفير، وتتوقف مزامنة المفاتيح (تُحذف من السحابة).', { ok:'إيقاف التشفير' })) return;
    toast('جارٍ التحديث…'); encToast(await QuarkCloud.disableEnc()); renderStorageBar(); return;
  }
  const a = await QuarkCloud.askPass({ mode:'set' }); if (!a) return;
  toast('جارٍ التشفير…'); const ok = await QuarkCloud.enableEnc(a.pass, a.keys); toast(ok ? 'تم تشفير نسختك السحابية 🔒' : 'تعذّر التشفير'); renderStorageBar();
});
$('cloudEncPass').addEventListener('click', async () => {
  const a = await QuarkCloud.askPass({ mode:'set', title:'تغيير كلمة السر', withKeys:false, ok:'تغيير' }); if (!a) return;
  toast('جارٍ إعادة التشفير…'); const ok = await QuarkCloud.changePass(a.pass); toast(ok ? 'تم تغيير كلمة السر. ستطلبها أجهزتك الأخرى.' : 'تعذّر التغيير'); renderStorageBar();
});
$('cloudEncKeys').addEventListener('click', async () => {
  const on = !QuarkCloud.keysOn();
  if (on && !await qConfirm('ستُرفع مفاتيحك (API والصوت والتكاملات وكلمات مرور البريد) مشفّرةً بكلمة سرك، وتظهر على أجهزتك الأخرى بعد فك التشفير. متابعة؟', { ok:'تفعيل', danger:false })) return;
  if (!on && !await qConfirm('إيقاف مزامنة المفاتيح؟ تُحذف من النسخة السحابية، وتبقى على أجهزتك.', { ok:'إيقاف' })) return;
  toast('جارٍ التحديث…'); encToast(await QuarkCloud.setKeysSync(on)); renderStorageBar();
});
$('cloudUnlock').addEventListener('click', async () => { if (!await QuarkCloud.unlock()) toast('لم تُفك النسخة'); renderStorageBar(); });
$('cloudSync').addEventListener('click', async () => {
  const ok = await QuarkCloud.syncNow(); toast(ok ? 'تمت المزامنة' : (QuarkCloud.status() === 'full' ? 'مساحتك السحابية ممتلئة' : QuarkCloud.locked() ? 'النسخة مشفّرة: أدخل كلمة السر أولًا' : 'تعذّرت المزامنة')); renderStorageBar();
});
$('cloudRestore').addEventListener('click', async () => {
  if (!await qConfirm('سيُدمج ما في حسابك السحابي مع بيانات هذا الجهاز (بلا حذف). سيُعاد تشغيل التطبيق. متابعة؟', { ok:'استعادة' })) return;
  if (!await QuarkCloud.restoreNow()) toast('لا توجد نسخة سحابية لاستعادتها');
});
window.QuarkCloud?.onChange(() => { const p = document.querySelector('[data-panel="data"]'); if (p && !p.hidden) renderStorageBar(); });
/* مع تخزين بايثون: زر لحذف النسخة القديمة المتبقية في المتصفح بعد النقل (لا يمسّ بيانات الخادم) */
function paintLegacy(){
  const b = $('clearLegacy'); if (!b) return;
  b.hidden = !(QuarkKV.server && QuarkKV.legacyCount() > 0);
}
$('clearLegacy').addEventListener('click', async () => {
  if (!await qConfirm('تم نقل بياناتك إلى بايثون. سيُحذف الآن ما تبقّى منها في المتصفح فقط (نسخة قديمة). لا يتأثر ما هو محفوظ على الخادم. متابعة؟', { ok:'حذف النسخة القديمة' })) return;
  await QuarkKV.clearLegacy(); paintLegacy(); toast('تم حذف النسخة القديمة من المتصفح');
});
function renderStats(){
  paintLegacy();
  const bytes = ['ai_chats','ai_settings_v3','ai_current'].reduce((n, k) => n + lsSize(k), 0), kept = chats.filter(c => !c.temp);
  $('stChats').textContent = kept.length;
  $('stMsgs').textContent = kept.reduce((n, c) => n + c.messages.length, 0);
  $('stSize').textContent = fmtBytes(bytes);
  renderStorageBar();
}
$('exportAll').addEventListener('click', async () => {
  if (!chats.length){ toast('لا توجد محادثات لتصديرها'); return; }
  const list = chats.filter(c => !c.temp), ids = new Set(), images = {};
  list.forEach(c => eachMsg(c, m => { (m.imgs || []).forEach(i => ids.add(i.id)); (m.gen || []).forEach(i => i.id && ids.add(i.id)); }));
  for (const id of ids){ const d = await imgData(id); if (d) images[id] = d; }
  const blob = new Blob([JSON.stringify({ app:'QUARK AI', version:2, exportedAt:new Date().toISOString(), tags, chats:list, images }, null, 2)], { type:'application/json' });
  saveFile(blob, 'quark-ai-backup.json');
});
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try{
    const j = JSON.parse(await f.text());
    const arr = Array.isArray(j) ? j : j.chats;
    if (!Array.isArray(arr)) throw new Error('bad');
    if (j.images && typeof j.images === 'object') for (const [id, d] of Object.entries(j.images)) if (typeof d === 'string' && d.startsWith('data:image/')) await imgSave({ id, data:d });
    const ids = new Set(chats.map(c => c.id)); let n = 0;
    const tmap = {}; (Array.isArray(j.tags) ? j.tags : []).forEach(t => { if (t && t.id && t.name){ const nt = addTag(t.name); if (nt) tmap[t.id] = nt.id; } });
    for (const c of arr){
      if (!c || !Array.isArray(c.messages)) continue;
      const messages = c.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
      const id = c.id && !ids.has(String(c.id)) ? String(c.id) : uid(); ids.add(id);
      const o = { id, title:String(c.title || 'محادثة مستوردة').slice(0, 80), messages, ts:c.ts || Date.now() };
      if (c.fav) o.fav = true;
      const tg = (c.tags || []).map(x => tmap[x]).filter(Boolean); if (tg.length) o.tags = tg;
      chats.push(o); n++;
    }
    save(); renderAll(); renderStats(); paintFilter();
    toast(n ? `تم استيراد ${n} محادثة` : 'لا توجد محادثات صالحة في الملف');
  }catch{ toast('ملف غير صالح'); }
});
$('delAll').addEventListener('click', async () => {
  if (busy){ toast('انتظر انتهاء الرد الحالي'); return; }
  if (!chats.length){ toast('لا توجد محادثات'); return; }
  if (await qConfirm('سيتم حذف كل المحادثات نهائيًا. هل أنت متأكد؟', { ok:'حذف الكل' })){
    chats = []; currentId = null; save(); renderAll(); renderStats(); toast('تم حذف كل المحادثات');
  }
});
$('resetAll').addEventListener('click', async () => {
  if (await qConfirm('سيتم مسح كل المفاتيح (وحسابات البريد) وإعادة الإعدادات للوضع الافتراضي. المحادثات لن تُحذف. متابعة؟', { ok:'مسح وإعادة ضبط' })){
    ['ai_settings_v2', 'ai_settings_v3', 'ai_voice_v1', 'ai_mail_v1', 'ai_mail_tags', 'ai_mail_arlog', 'ai_mail_sched', 'ai_mail_contacts'].forEach(k => store.remove(k));
    await QuarkKV.flush();                                  /* نتأكد أن الحذف وصل للخادم قبل إعادة التحميل */
    location.reload();
  }
});

