/* QUARK AI — بوابة النماذج: الاتصال بالمزوّدين عبر الخادم الوسيط (serve.py) عند توفّره
   وإلا يعود التطبيق للاتصال المباشر من المتصفح كما كان. */
'use strict';

/* ================= إعدادات البوابة ================= */
settings.gw = (() => {
  const g = settings.gw && typeof settings.gw === 'object' ? settings.gw : {};
  return { mode:g.mode === 'off' ? 'off' : 'auto', url:String(g.url || '').trim(), token:String(g.token || ''), thinking:['on','off'].includes(g.thinking) ? g.thinking : 'auto' };
})();
const gwIsNative = () => !!(window.Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform());
/* البوابة المدمجة في تطبيق الأندرويد: خادم بايثون محلي (Chaquopy) يشغّله MainActivity على 127.0.0.1.
   port: 0 = لم يبدأ بعد، -1 = فشل البدء (نعود للاتصال المباشر)، >0 = جاهز. */
const gwEmb = { port:0, token:'' };
const gwNative = () => (gwIsNative() && window.QuarkNative && typeof QuarkNative.gwPort === 'function') ? QuarkNative : null;
function gwEmbPoll(){
  const n = gwNative();
  if (!n || gwEmb.port) return gwEmb.port > 0;
  try{
    const p = Number(n.gwPort()) || 0;
    if (p > 0){ gwEmb.token = String(n.gwToken() || ''); gwEmb.port = p; }
    else if (p < 0) gwEmb.port = -1;
  }catch{ gwEmb.port = -1; }
  return gwEmb.port > 0;
}
const gwIsEmbedded = () => settings.gw.mode !== 'off' && !settings.gw.url && gwEmb.port > 0;
function gwBase(){
  if (settings.gw.mode === 'off') return '';
  const u = settings.gw.url.replace(/\/+$/, '');
  if (u) return /\/api\/gw$/.test(u) ? u : u + '/api/gw';
  if (gwIsNative()) return gwEmbPoll() ? 'http://127.0.0.1:' + gwEmb.port + '/api/gw' : '';
  return /^https?:$/.test(location.protocol) ? '/api/gw' : '';
}
const gwHeaders = () => {
  const t = gwIsEmbedded() ? gwEmb.token : settings.gw.token;
  return t ? { 'x-quark-token':t } : {};
};

/* حالة الاتصال: ok = true | false | null (لم تُفحص بعد)، reason = forbidden | down | off */
const gwState = { ok:null, base:'', at:0, reason:'', version:'', p:null };
async function gwReady(force){
  /* أول تشغيل: بايثون يحتاج بضع ثوانٍ ليبدأ، فننتظره بدل الرجوع للاتصال المباشر */
  if (settings.gw.mode !== 'off' && !settings.gw.url && gwNative() && !gwEmb.port){
    for (let i = 0; i < 50 && !gwEmbPoll() && !gwEmb.port; i++) await new Promise(r => setTimeout(r, 200));
  }
  const base = gwBase();
  if (!base){ gwState.ok = false; gwState.reason = 'off'; gwState.base = ''; return false; }
  const fresh = Date.now() - gwState.at < (gwState.ok ? 60000 : 12000);
  if (!force && gwState.base === base && gwState.ok !== null && fresh) return gwState.ok;
  if (gwState.p && gwState.base === base && !force) return gwState.p;
  gwState.base = base;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 3500);
  const p = (async () => {
    try{
      const r = await fetch(base + '/health', { headers:gwHeaders(), cache:'no-store', signal:ctl.signal });
      if (r.status === 403){ gwState.ok = false; gwState.reason = 'forbidden'; }
      else {
        const j = r.ok ? await r.json().catch(() => null) : null;
        gwState.ok = !!(j && j.ok); gwState.reason = gwState.ok ? '' : 'down'; gwState.version = j?.version || '';
      }
    }catch{ gwState.ok = false; gwState.reason = 'down'; }
    finally{ clearTimeout(timer); gwState.at = Date.now(); gwState.p = null; try{ window.__gwPaint?.(); }catch{} }
    return gwState.ok;
  })();
  gwState.p = p;
  return p;
}

/* ================= نداءات البوابة ================= */
const gwEndpoint = ep => ({ url:ep.url, key:ep.key || '', proto:ep.proto || 'auto', kind:ep.kind || 'api' });
const gwOpts = (extra = {}) => ({ thinking:settings.gw.thinking, ...extra });
function gwDown(){ const e = new Error('البوابة غير متاحة'); e.gwDown = true; return e; }
async function gwPost(route, body, signal){
  let res;
  try{ res = await fetch(gwBase() + '/' + route, { method:'POST', signal, headers:{ 'content-type':'application/json', ...gwHeaders() }, body:JSON.stringify(body) }); }
  catch(e){ if (e.name === 'AbortError') throw e; gwState.ok = false; gwState.reason = 'down'; gwState.at = Date.now(); throw gwDown(); }
  return res;
}
async function gwJson(route, body, signal){
  const res = await gwPost(route, body, signal);
  let j = null; try{ j = await res.json(); }catch{}
  if (!j) throw new Error(`(${res.status}) ردّ غير مفهوم من البوابة`);
  return j;
}

/* بث المحادثة: يُنتج نصوصًا و{ think } و{ usage } بنفس واجهة callModel */
async function* gwChat({ ep, model }, history, signal, P, system){
  const res = await gwPost('chat', { endpoint:gwEndpoint(ep), model, system, messages:history, params:P, options:gwOpts() }, signal);
  if (!res.ok){ let j = null; try{ j = await res.json(); }catch{} throw new Error(j?.error || `(${res.status}) خطأ من البوابة`); }
  for await (const data of streamSSE(res)){
    let ev; try{ ev = JSON.parse(data); }catch{ continue; }
    if (ev.t === 'text') yield ev.d;
    else if (ev.t === 'think') yield { think:ev.d };
    else if (ev.t === 'usage') yield { usage:{ in:ev.in || 0, out:ev.out || 0, think:ev.think || 0 } };
    else if (ev.t === 'error') throw new Error(ev.msg || 'خطأ من المزوّد');
  }
}
/* طلب واحد (عنوان تلقائي، اختبار اتصال) — يوقف التفكير لأنه غير لازم هنا */
async function gwOnce({ ep, model }, prompt, signal){
  const j = await gwJson('once', { endpoint:gwEndpoint(ep), model, messages:[{ role:'user', content:prompt }], options:gwOpts({ thinking:'off' }) }, signal);
  if (!j.ok) throw new Error(j.error || 'فشل الطلب');
  return j.text || '';
}
/* جلب النماذج: يعيد مصفوفة معرّفات بنفس شكل fetchModelIds القديم + .meta بتفاصيل كل نموذج */
async function gwModels(ep){
  const j = await gwJson('models', { endpoint:gwEndpoint(ep) });
  if (!j.ok) throw new Error(j.error || 'تعذّر جلب النماذج');
  const ids = j.models.map(m => m.id);
  ids.img = new Map(); ids.meta = new Map(); ids.info = { label:j.label, dialect:j.dialect, hidden:j.hidden || 0 };
  j.models.forEach(m => {
    ids.meta.set(m.id, m);
    ids.img.set(m.id, m.img ? { img:true, only:!!m.imgOnly } : { img:false });
  });
  return ids;
}
/* توليد صورة: يعيد { text, images:[{data|url}] } */
async function gwImage({ ep, model }, history, signal, imageOnly){
  const j = await gwJson('image', { endpoint:gwEndpoint(ep), model, messages:history, options:{ imageOnly:!!imageOnly } }, signal);
  if (!j.ok) throw new Error(j.error || 'فشل توليد الصورة');
  return j;
}
