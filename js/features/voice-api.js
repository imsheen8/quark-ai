/* QUARK AI — محرّك الصوت: مزوّدو التعرّف على الكلام (STT) والقراءة الصوتية (TTS) */
'use strict';

/* ================= تعريف المزوّدين ================= */
const STT_PROVIDERS = {
  openai:    { label:'OpenAI Whisper', url:'https://api.openai.com/v1', model:'gpt-4o-mini-transcribe', models:['gpt-4o-mini-transcribe','gpt-4o-transcribe','whisper-1'],
    help:'مفتاح من <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>.' },
  groq:      { label:'Groq Whisper', url:'https://api.groq.com/openai/v1', model:'whisper-large-v3-turbo', models:['whisper-large-v3-turbo','whisper-large-v3'],
    help:'سريع جدًا. مفتاح من <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com</a>.' },
  deepgram:  { label:'Deepgram', model:'nova-3', models:['nova-3','nova-2'],
    help:'مفتاح من <a href="https://console.deepgram.com" target="_blank" rel="noopener">console.deepgram.com</a>.' },
  elevenlabs:{ label:'ElevenLabs Scribe', model:'scribe_v1', models:['scribe_v1'],
    help:'مفتاح من <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener">elevenlabs.io</a>.' },
  gemini:    { label:'Google Gemini', model:'gemini-2.5-flash', models:['gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.5-pro'],
    help:'مفتاح من <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a>.' },
  custom:    { label:'مخصص (متوافق مع OpenAI)', url:'', model:'whisper-1', models:[], custom:true, keyOptional:true,
    help:'أي خدمة تدعم <code dir="ltr">/audio/transcriptions</code> مثل خادم Whisper محلي. اكتب العنوان الأساسي مع /v1.' },
};
const TTS_PROVIDERS = {
  openai:    { label:'OpenAI TTS', url:'https://api.openai.com/v1', model:'gpt-4o-mini-tts', models:['gpt-4o-mini-tts','tts-1','tts-1-hd'],
    voice:'alloy', voices:[['alloy','Alloy','محايد ومتوازن'],['ash','Ash','واثق وحازم'],['ballad','Ballad','معبّر وناعم'],['coral','Coral','ودود ودافئ'],['echo','Echo','هادئ وواضح'],['fable','Fable','حكّاء ومعبّر'],['nova','Nova','نشيط ومشرق'],['onyx','Onyx','عميق وجاد'],['sage','Sage','متزن وحكيم'],['shimmer','Shimmer','خفيف وناعم']],
    help:'مفتاح من <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>. يدعم العربية بجودة جيدة.' },
  elevenlabs:{ label:'ElevenLabs', model:'eleven_multilingual_v2', models:['eleven_multilingual_v2','eleven_turbo_v2_5','eleven_flash_v2_5'],
    voice:'21m00Tcm4TlvDq8ikWAM', voices:[['21m00Tcm4TlvDq8ikWAM','Rachel','هادئة وواضحة'],['pNInz6obpgDQGcFmaJgB','Adam','عميق وقوي'],['ErXwobaYiN019PkySvjV','Antoni','ودود ومتزن'],['EXAVITQu4vr4xnSDxMgb','Bella','ناعمة ودافئة'],['TxGEqnHWrfWFTfGW9XjX','Josh','شاب وحيوي'],['AZnzlk1XvdvUeBnXmlld','Domi','واثقة وحازمة'],['MF3mGyEYCl7XYWbV9V6O','Elli','شابة ومشرقة']], voiceHint:'معرّف الصوت (Voice ID) من مكتبة ElevenLabs',
    help:'مفتاح من <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener">elevenlabs.io</a>. الصوت الافتراضي Rachel، وتجد معرّفات الأصوات في Voice Library.' },
  gemini:    { label:'Google Gemini TTS', model:'gemini-2.5-flash-preview-tts', models:['gemini-2.5-flash-preview-tts','gemini-2.5-pro-preview-tts'],
    voice:'Kore', voices:[['Kore','Kore','حازم وثابت'],['Puck','Puck','مرح ونشيط'],['Charon','Charon','إخباري وهادئ'],['Fenrir','Fenrir','متحمّس'],['Aoede','Aoede','خفيف وعذب'],['Leda','Leda','شبابي'],['Zephyr','Zephyr','مشرق'],['Orus','Orus','قوي وواضح']],
    help:'مفتاح من <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a>.' },
  deepgram:  { label:'Deepgram Aura', model:'aura-2-thalia-en', models:['aura-2-thalia-en','aura-2-andromeda-en','aura-2-apollo-en','aura-asteria-en'], voiceIsModel:true,
    voices:[['aura-2-thalia-en','Thalia','أنثوي واضح'],['aura-2-andromeda-en','Andromeda','أنثوي ودود'],['aura-2-apollo-en','Apollo','ذكوري واثق'],['aura-asteria-en','Asteria','أنثوي دافئ']],
    help:'أصوات إنجليزية في الغالب. مفتاح من <a href="https://console.deepgram.com" target="_blank" rel="noopener">console.deepgram.com</a>.' },
  custom:    { label:'مخصص (متوافق مع OpenAI)', url:'', model:'tts-1', models:[], voice:'alloy', voices:[], custom:true, keyOptional:true,
    help:'أي خدمة تدعم <code dir="ltr">/audio/speech</code>. اكتب العنوان الأساسي مع /v1.' },
};
/* الأصوات المتاحة للمزوّد الحالي بصيغة {id,name,desc} */
/* الأصوات المخصصة تُحفظ لكل مزوّد: cfg[p].customVoices = [{cid,name,desc,voiceId,model,color}] */
const ttsCustoms = p => ((voiceCfg.tts.cfg[p] || {}).customVoices || []);
const ttsVoiceList = p => (TTS_PROVIDERS[p].voices || []).map(v => ({ id:v[0], name:v[1], desc:v[2] }))
  .concat(ttsCustoms(p).map(v => ({ id:v.voiceId, name:v.name, desc:v.desc || 'صوت مخصص', custom:true, cid:v.cid, model:v.model, color:v.color })));
const STT_LANGS = [['ar','العربية'],['en','English'],['fr','Français'],['es','Español'],['de','Deutsch'],['tr','Türkçe'],['fa','فارسی'],['ur','اردو'],['auto','تلقائي']];

/* ================= التخزين ================= */
/* ================= اتصالات الصوت (API) — تُضاف مرة واحدة وتُختار للقراءة والتعرّف ================= */
const VOICE_PRESETS = {
  openai:    { label:'OpenAI', url:'https://api.openai.com/v1' },
  groq:      { label:'Groq', url:'https://api.groq.com/openai/v1' },
  elevenlabs:{ label:'ElevenLabs', url:'https://api.elevenlabs.io', fixed:true },
  deepgram:  { label:'Deepgram', url:'https://api.deepgram.com', fixed:true },
  gemini:    { label:'Google Gemini', url:'https://generativelanguage.googleapis.com', fixed:true },
  custom:    { label:'مخصص (متوافق مع OpenAI)', url:'', custom:true },
};
const voiceConnId = () => 'c' + Math.random().toString(36).slice(2, 10);
const voiceConnHelp = p => p === 'custom'
  ? 'أي خدمة متوافقة مع OpenAI (<code dir="ltr">/audio/speech</code> و<code dir="ltr">/audio/transcriptions</code>). اكتب العنوان الأساسي مع /v1.'
  : ((STT_PROVIDERS[p] || TTS_PROVIDERS[p] || {}).help || '');
const voiceConnCaps = c => ({ tts:!!TTS_PROVIDERS[c.preset], stt:!!STT_PROVIDERS[c.preset] });
const voiceConnsFor = kind => voiceCfg.conns.filter(c => c.enabled && (kind === 'stt' ? STT_PROVIDERS : TTS_PROVIDERS)[c.preset]);
const voiceConnHost = c => { try{ return new URL(c.url || VOICE_PRESETS[c.preset].url).host; }catch{ return VOICE_PRESETS[c.preset].label; } };
const voiceConnLabel = c => (c.preset === 'custom' ? voiceConnHost(c) : VOICE_PRESETS[c.preset].label) + (c.key ? ' · ••••' + c.key.slice(-4) : '');
/* اختيار اتصال تلقائيًا لكل قسم لا يملك اتصالًا صالحًا */
function voiceAutoConn(){
  ['stt', 'tts'].forEach(k => {
    const sec = voiceCfg[k], list = voiceConnsFor(k);
    if (list.some(c => c.id === sec.conn)){ sec.p = list.find(c => c.id === sec.conn).preset; return; }
    if (list[0]){ sec.conn = list[0].id; sec.p = list[0].preset; } else sec.conn = '';
  });
}
async function voiceConnTest(preset, url, key){
  const base = (url || VOICE_PRESETS[preset].url).replace(/\/+$/, '');
  let r;
  if (preset === 'openai' || preset === 'groq' || preset === 'custom') r = await fetch(base + '/models', { headers:key ? { Authorization:'Bearer ' + key } : {} });
  else if (preset === 'elevenlabs') r = await fetch('https://api.elevenlabs.io/v1/models', { headers:{ 'xi-api-key':key } });
  else if (preset === 'deepgram') r = await fetch('https://api.deepgram.com/v1/projects', { headers:{ Authorization:'Token ' + key } });
  else r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers:{ 'x-goog-api-key':key } });
  if (!r.ok) throw await voiceHttpErr(r);
  return true;
}

const VOICE_KEY = 'ai_voice_v1';
function voiceDefaults(){
  return { stt:{ p:'groq', lang:'ar', conn:'', cfg:{} }, tts:{ p:'openai', rate:1, conn:'', cfg:{} } };
}
function loadVoiceCfg(){
  const d = voiceDefaults(), s = store.get(VOICE_KEY, null) || {};
  const out = {
    stt:{ ...d.stt, ...(s.stt || {}) },
    tts:{ ...d.tts, ...(s.tts || {}) },
  };
  out.stt.cfg = { ...(s.stt && s.stt.cfg || {}) };
  out.tts.cfg = { ...(s.tts && s.tts.cfg || {}) };
  if (!STT_PROVIDERS[out.stt.p]) out.stt.p = d.stt.p;
  if (!TTS_PROVIDERS[out.tts.p]) out.tts.p = d.tts.p;
  out.conns = Array.isArray(s.conns) ? s.conns.filter(c => c && c.id && VOICE_PRESETS[c.preset]) : [];
  if (!Array.isArray(s.conns)){   /* ترحيل المفاتيح القديمة (لكل قسم) إلى قائمة اتصالات موحّدة */
    ['stt', 'tts'].forEach(k => {
      const P = k === 'stt' ? STT_PROVIDERS : TTS_PROVIDERS;
      Object.entries(out[k].cfg).forEach(([p, cf]) => {
        if (!P[p] || !cf || !VOICE_PRESETS[p]) return;
        const key = (cf.key || '').trim(), url = P[p].custom ? (cf.url || '').trim().replace(/\/+$/, '') : '';
        if (!key && !url) return;
        let c = out.conns.find(x => x.preset === p && x.key === key && (x.url || '') === url);
        if (!c){ c = { id:voiceConnId(), preset:p, url, key, enabled:true }; out.conns.push(c); }
        if (p === out[k].p) out[k].conn = c.id;
      });
    });
  }
  ['stt', 'tts'].forEach(k => {
    const P = k === 'stt' ? STT_PROVIDERS : TTS_PROVIDERS, sec = out[k];
    const c = out.conns.find(x => x.id === sec.conn && x.enabled && P[x.preset]);
    if (c) sec.p = c.preset; else sec.conn = '';
  });
  return out;
}
const voiceCfg = loadVoiceCfg();
const saveVoiceCfg = () => store.set(VOICE_KEY, voiceCfg);
/* إعداد المزوّد الحالي مع القيم الافتراضية */
function voiceConf(kind){
  const sec = voiceCfg[kind], P = kind === 'stt' ? STT_PROVIDERS : TTS_PROVIDERS;
  const conn = voiceCfg.conns.find(x => x.id === sec.conn && x.enabled && P[x.preset]);
  const p = conn ? conn.preset : sec.p, defs = P[p], c = sec.cfg[p] || {};
  const out = { p, def:defs, key:(conn ? conn.key : '').trim(), url:((conn && conn.url) || defs.url || '').trim().replace(/\/+$/, ''),
    model:(c.model || defs.model || '').trim(), voice:(c.voice || defs.voice || '').trim() };
  if (kind === 'tts' && !defs.voiceIsModel){
    const cv = ttsCustoms(p).find(v => v.voiceId === out.voice);
    if (cv && cv.model) out.model = cv.model.trim();   /* نموذج خاص بهذا الصوت */
  }
  return out;
}

/* ================= أدوات مساعدة ================= */
async function voiceHttpErr(r){
  let t = ''; try{ t = await r.text(); }catch{}
  let m = t; try{ const j = JSON.parse(t); m = j.error?.message || j.message || j.detail?.message || j.err_msg || (typeof j.detail === 'string' ? j.detail : '') || t; }catch{}
  return new Error(`${r.status} ${String(m).slice(0, 160)}`.trim());
}
const blobToB64 = b => new Promise((ok, fail) => {
  const f = new FileReader(); f.onload = () => ok(String(f.result).split(',')[1] || ''); f.onerror = () => fail(f.error); f.readAsDataURL(b);
});
function audioExt(mime){
  if (/mp4|aac/.test(mime)) return 'm4a'; if (/ogg/.test(mime)) return 'ogg'; if (/wav/.test(mime)) return 'wav'; if (/mpeg|mp3/.test(mime)) return 'mp3'; return 'webm';
}
function pcmToWav(pcm, rate = 24000){
  const n = pcm.length, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0,'RIFF'); v.setUint32(4, 36 + n, true); w(8,'WAVE'); w(12,'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36,'data'); v.setUint32(40, n, true); new Uint8Array(buf, 44).set(pcm);
  return new Blob([buf], { type:'audio/wav' });
}
const b64ToBytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
/* تنظيف النص قبل القراءة: بدون كتل الكود والرموز */
const speakClean = t => String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*#>|_`~]/g, ' ').replace(/\s+/g, ' ').trim();

/* ================= تحويل الصوت إلى نص ================= */
async function sttTranscribe(blob, signal){
  const c = voiceConf('stt'), lang = voiceCfg.stt.lang, code = lang === 'auto' ? '' : lang;
  if (!c.key && !c.def.keyOptional) throw new Error('أضف API للصوت واختره من إعدادات الصوت');
  if (c.p === 'openai' || c.p === 'groq' || c.p === 'custom'){
    if (!c.url) throw new Error('أدخل عنوان API');
    const fd = new FormData();
    fd.append('file', blob, 'speech.' + audioExt(blob.type)); fd.append('model', c.model);
    if (code) fd.append('language', code);
    const r = await fetch(c.url + '/audio/transcriptions', { method:'POST', signal, headers:c.key ? { Authorization:'Bearer ' + c.key } : {}, body:fd });
    if (!r.ok) throw await voiceHttpErr(r);
    const j = await r.json(); return (j.text || '').trim();
  }
  if (c.p === 'deepgram'){
    const q = new URLSearchParams({ model:c.model, smart_format:'true' });
    if (code) q.set('language', code); else q.set('detect_language', 'true');
    const r = await fetch('https://api.deepgram.com/v1/listen?' + q, { method:'POST', signal, headers:{ Authorization:'Token ' + c.key, 'Content-Type':blob.type || 'audio/webm' }, body:blob });
    if (!r.ok) throw await voiceHttpErr(r);
    const j = await r.json(); return (j.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim();
  }
  if (c.p === 'elevenlabs'){
    const fd = new FormData();
    fd.append('file', blob, 'speech.' + audioExt(blob.type)); fd.append('model_id', c.model);
    if (code) fd.append('language_code', code);
    const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method:'POST', signal, headers:{ 'xi-api-key':c.key }, body:fd });
    if (!r.ok) throw await voiceHttpErr(r);
    const j = await r.json(); return (j.text || '').trim();
  }
  if (c.p === 'gemini'){
    const data = await blobToB64(blob), mime = (blob.type || 'audio/webm').split(';')[0];
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, {
      method:'POST', signal, headers:{ 'Content-Type':'application/json', 'x-goog-api-key':c.key },
      body:JSON.stringify({ contents:[{ parts:[
        { text:'فرّغ هذا التسجيل الصوتي حرفيًا بلغته الأصلية دون أي إضافة أو شرح، وأعد النص فقط. إن لم يكن فيه كلام فأعد نصًا فارغًا.' },
        { inline_data:{ mime_type:mime, data } } ] }] }) });
    if (!r.ok) throw await voiceHttpErr(r);
    const j = await r.json(); return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  }
  throw new Error('مزوّد غير مدعوم');
}

/* ================= تحويل النص إلى صوت (يرجع Blob صوتيًا) ================= */
async function ttsSynth(text, signal){
  const c = voiceConf('tts'); text = speakClean(text).slice(0, 4000);
  if (!text) throw new Error('لا يوجد نص للقراءة');
  if (!c.key && !c.def.keyOptional) throw new Error('أضف API للصوت واختره من إعدادات الصوت');
  const rate = Number(voiceCfg.tts.rate) || 1;
  if (c.p === 'openai' || c.p === 'custom'){
    if (!c.url) throw new Error('أدخل عنوان API');
    const body = { model:c.model, input:text, voice:c.voice || 'alloy', response_format:'mp3', speed:Math.min(4, Math.max(.25, rate)) };
    const r = await fetch(c.url + '/audio/speech', { method:'POST', signal, headers:{ 'Content-Type':'application/json', ...(c.key ? { Authorization:'Bearer ' + c.key } : {}) }, body:JSON.stringify(body) });
    if (!r.ok) throw await voiceHttpErr(r);
    return await r.blob();
  }
  if (c.p === 'elevenlabs'){
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(c.voice)}?output_format=mp3_44100_128`, {
      method:'POST', signal, headers:{ 'Content-Type':'application/json', 'xi-api-key':c.key, Accept:'audio/mpeg' },
      body:JSON.stringify({ text, model_id:c.model }) });
    if (!r.ok) throw await voiceHttpErr(r);
    return await r.blob();
  }
  if (c.p === 'deepgram'){
    const r = await fetch('https://api.deepgram.com/v1/speak?model=' + encodeURIComponent(c.model), {
      method:'POST', signal, headers:{ Authorization:'Token ' + c.key, 'Content-Type':'application/json' }, body:JSON.stringify({ text }) });
    if (!r.ok) throw await voiceHttpErr(r);
    return await r.blob();
  }
  if (c.p === 'gemini'){
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, {
      method:'POST', signal, headers:{ 'Content-Type':'application/json', 'x-goog-api-key':c.key },
      body:JSON.stringify({ contents:[{ parts:[{ text }] }],
        generationConfig:{ responseModalities:['AUDIO'], speechConfig:{ voiceConfig:{ prebuiltVoiceConfig:{ voiceName:c.voice || 'Kore' } } } } }) });
    if (!r.ok) throw await voiceHttpErr(r);
    const j = await r.json(), part = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData || p.inline_data);
    const d = part && (part.inlineData || part.inline_data);
    if (!d || !d.data) throw new Error('لم يرجع المزوّد صوتًا');
    return pcmToWav(b64ToBytes(d.data), 24000);
  }
  throw new Error('مزوّد غير مدعوم');
}

/* ================= مشغّل القراءة الصوتية الموحّد ================= */
const speaker = { audio:null, url:'', ctl:null, btn:null };
function speakStop(){
  speaker.ctl?.abort(); speaker.ctl = null;
  if (speaker.audio){ speaker.audio.onended = speaker.audio.onerror = null; try{ speaker.audio.pause(); }catch{} speaker.audio = null; }
  if (speaker.url){ URL.revokeObjectURL(speaker.url); speaker.url = ''; }
  speaker.btn?.classList.remove('on', 'busy'); speaker.btn = null;
}
async function speakText(text, btn){
  const was = speaker.btn === btn; speakStop(); if (was) return;
  const c = voiceConf('tts');
  if (!c.key && !c.def.keyOptional){ toast('أضف API للصوت من الإعدادات ← المفاتيح والنماذج ← مفاتيح الصوت'); window.__openVoiceKeys(); return; }
  speaker.btn = btn || null; btn?.classList.add('on', 'busy');
  const done = () => { if (speaker.btn === btn) speakStop(); };
  const ctl = new AbortController(); speaker.ctl = ctl;
  try{
    const blob = await ttsSynth(text, ctl.signal, 'read');
    if (speaker.ctl !== ctl) return;
    speaker.url = URL.createObjectURL(blob);
    const a = new Audio(speaker.url); speaker.audio = a; btn?.classList.remove('busy');
    /* OpenAI والمخصص يطبّقان السرعة على الخادم؛ البقية نطبّقها عند التشغيل */
    if (c.p !== 'openai' && c.p !== 'custom') a.playbackRate = Math.min(2, Math.max(.5, Number(voiceCfg.tts.rate) || 1));
    a.onended = a.onerror = done; await a.play();
  }catch(e){
    if (e.name === 'AbortError') return;
    toast('تعذّرت القراءة: ' + (e.message === 'Failed to fetch' ? 'تحقق من الاتصال' : e.message)); done();
  }
}
