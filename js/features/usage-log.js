/* QUARK AI — سجل الاستخدام (يغذّي صفحة الإحصائيات)
   يغلّف دوال الاتصال الموجودة دون تغيير سلوكها، ويسجّل لكل طلب: الزمن، أول رمز، الحجم التقديري، النجاح/الفشل.
   كل شيء يُحفظ محليًا فقط (على جهازك، في قاعدة بايثون) ولا يُرسل لأي جهة. */
'use strict';

(() => {
  const KEY = 'ai_usage_v1', MAX = 8000;
  let db = store.get(KEY, null);
  if (!db || !Array.isArray(db.ev)) db = { v:1, since:Date.now(), ev:[], nb:false };
  let timer = 0;
  const flush = () => { clearTimeout(timer); timer = 0; store.set(KEY, db); };
  const queue = () => { if (!timer) timer = setTimeout(flush, 700); };
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) flush(); });
  window.addEventListener('pagehide', () => { if (timer) flush(); });

  const tok = n => Math.max(0, Math.round(n / 3.2));
  function log(e){
    e.ts = e.ts || Date.now();
    db.ev.push(e);
    if (db.ev.length > MAX) db.ev.splice(0, db.ev.length - MAX);
    queue();
    try{ window.__stRefresh?.(); }catch{}
  }
  const errMsg = e => String((e && e.message) || e || '').replace(/\s+/g, ' ').slice(0, 140);
  const hostSafe = ep => { try{ return new URL(ep.url).host; }catch{ return ep?.url || ''; } };

  /* ---------- النص: callModel (محادثة / ساحة التجربة / مقارنة الأداء) ---------- */
  const _call = callModel;
  callModel = async function*(history, signal, chat, amOverride){
    const am = amOverride || activeModel();
    const t0 = performance.now();
    let ttft = 0, outC = 0, thinkC = 0, ok = false, err = '', aborted = false, gu = null;
    const inC = (history || []).reduce((n, m) => n + String(m.content || '').length, 0);
    try{
      for await (const ch of _call(history, signal, chat, amOverride)){
        if (ch && ch.usage){ gu = ch.usage; continue; }       // أرقام حقيقية من المزوّد: نسجّلها ولا نمرّرها
        if (!ttft) ttft = Math.round(performance.now() - t0);
        if (typeof ch === 'string') outC += ch.length; else if (ch && ch.think) thinkC += ch.think.length;
        yield ch;
      }
      ok = true;
    }catch(e){
      if (e && e.name === 'AbortError') aborted = true; else err = errMsg(e);
      throw e;
    }finally{
      if (am && !(aborted && !outC && !thinkC)){
        log({ t:'t', k:chat ? 'chat' : 'lab', m:am.model, h:hostSafe(am.ep), ok:ok || (aborted && outC > 0), ms:Math.round(performance.now() - t0), tt:ttft,
          i:gu ? gu.in : tok(inC), o:gu ? Math.max(0, gu.out - (gu.think || 0)) : tok(outC),
          th:gu ? (gu.think || (outC + thinkC ? Math.round(gu.out * thinkC / (outC + thinkC)) : 0)) : tok(thinkC), ab:aborted ? 1 : 0, e:err });
      }
    }
  };

  /* ---------- عنوان تلقائي ---------- */
  const _once = completeOnce;
  completeOnce = async function(am, prompt, signal){
    const t0 = performance.now(), kind = /^Reply with the single word/.test(prompt) ? 'test' : 'title';
    try{
      const r = await _once(am, prompt, signal);
      log({ t:'t', k:kind, m:am.model, h:hostSafe(am.ep), ok:true, ms:Math.round(performance.now() - t0), i:tok(prompt.length), o:tok(String(r || '').length) });
      return r;
    }catch(e){
      if (!(e && e.name === 'AbortError')) log({ t:'t', k:kind, m:am.model, h:hostSafe(am.ep), ok:false, ms:Math.round(performance.now() - t0), e:errMsg(e) });
      throw e;
    }
  };

  /* ---------- توليد الصور ---------- */
  const _img = generateImage;
  generateImage = async function(c){
    const am = activeModel(), t0 = performance.now();
    await _img(c);
    const last = c.messages[c.messages.length - 1];
    if (!am || !last || last.role !== 'assistant') return;
    log({ t:'img', m:am.model, h:hostSafe(am.ep), ok:!last.error, n:(last.gen || []).length, ms:Math.round(performance.now() - t0), e:last.error ? errMsg(last.content) : '' });
  };

  /* ---------- الصوت: TTS و STT ---------- */
  const _tts = ttsSynth;
  ttsSynth = async function(text, signal, src){
    const c = voiceConf('tts'), chars = speakClean(text).slice(0, 4000).length, t0 = performance.now();
    const base = { t:'tts', p:c.p, v:c.voice || (c.def && c.def.voiceIsModel ? c.model : ''), m:c.model || '', c:chars, s:src || 'read', r:Number(voiceCfg.tts.rate) || 1 };
    try{
      const b = await _tts(text, signal);
      log({ ...base, ok:true, ms:Math.round(performance.now() - t0), b:b.size || 0 });
      return b;
    }catch(e){
      if (!(e && e.name === 'AbortError')) log({ ...base, ok:false, ms:Math.round(performance.now() - t0), e:errMsg(e) });
      throw e;
    }
  };
  const _stt = sttTranscribe;
  sttTranscribe = async function(blob, signal){
    const c = voiceConf('stt'), t0 = performance.now();
    const base = { t:'stt', p:c.p, m:c.model || '', b:blob.size || 0 };
    try{
      const r = await _stt(blob, signal);
      log({ ...base, ok:true, ms:Math.round(performance.now() - t0), c:String(r || '').length });
      return r;
    }catch(e){
      if (!(e && e.name === 'AbortError')) log({ ...base, ok:false, ms:Math.round(performance.now() - t0), e:errMsg(e) });
      throw e;
    }
  };

  window.__usage = {
    log,
    all: () => db.ev,
    since: () => db.since,
    noBackfill: () => !!db.nb,
    size: () => { try{ return QuarkKV.size(KEY); }catch{ return 0; } },
    clear(){ db = { v:1, since:Date.now(), ev:[], nb:true }; flush(); window.__stRefresh?.(); },
  };
})();
