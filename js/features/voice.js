/* QUARK AI — الإدخال الصوتي عبر مزوّد API (تسجيل ثم تحويل إلى نص) */
'use strict';

const voice = { on:false, mr:null, stream:null, chunks:[], busy:false, ctl:null };
function voiceAvail(){ $('amMic').hidden = !(navigator.mediaDevices && window.MediaRecorder); }
function voiceUI(){
  $('attachBtn').classList.toggle('rec', voice.on);
  $('amMic').classList.toggle('on', voice.on);
  $('amMicT').textContent = voice.busy ? 'جارٍ تحويل الصوت…' : voice.on ? 'إيقاف الإدخال الصوتي' : 'إدخال صوتي';
}
function voiceRelease(){
  voice.stream?.getTracks().forEach(t => t.stop()); voice.stream = null; voice.mr = null; voice.chunks = [];
}
function voiceStop(discard){
  if (!voice.mr && !voice.busy) return;
  if (discard){
    voice.ctl?.abort(); voice.ctl = null;
    const m = voice.mr; if (m){ m.onstop = null; m.ondataavailable = null; try{ if (m.state !== 'inactive') m.stop(); }catch{} }
    voiceRelease(); voice.on = false; voice.busy = false; voiceUI();
  } else if (voice.mr && voice.mr.state !== 'inactive'){ try{ voice.mr.stop(); }catch{} }
}
async function voiceStart(){
  if (voice.on || voice.busy) return;
  const c = voiceConf('stt');
  if (!c.key && !c.def.keyOptional){ toast('أضف API للصوت من الإعدادات ← المفاتيح والنماذج ← مفاتيح الصوت'); window.__openVoiceKeys(); return; }
  let stream;
  try{ stream = await navigator.mediaDevices.getUserMedia({ audio:true }); }
  catch{ toast('اسمح للتطبيق بالوصول إلى الميكروفون'); return; }
  const mime = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  let mr; try{ mr = new MediaRecorder(stream, mime ? { mimeType:mime } : undefined); }
  catch{ stream.getTracks().forEach(t => t.stop()); toast('تعذّر بدء التسجيل'); return; }
  voice.stream = stream; voice.mr = mr; voice.chunks = []; voice.on = true; voiceUI();
  mr.ondataavailable = e => { if (e.data && e.data.size) voice.chunks.push(e.data); };
  mr.onstop = async () => {
    const blob = new Blob(voice.chunks, { type:mr.mimeType || mime || 'audio/webm' });
    voiceRelease(); voice.on = false;
    if (blob.size < 1200){ voiceUI(); toast('لم يُسمع أي صوت'); return; }
    voice.busy = true; voiceUI(); const ctl = voice.ctl = new AbortController();
    try{
      const t = await sttTranscribe(blob, ctl.signal);
      if (voice.ctl !== ctl) return;
      if (!t){ toast('لم يُفهم أي كلام'); }
      else {
        let base = el.input.value; if (base && !/\s$/.test(base)) base += ' ';
        el.input.value = base + t; autosize(); updateSendState(); el.input.scrollTop = el.input.scrollHeight;
      }
    }catch(e){
      if (e.name !== 'AbortError') toast('فشل تحويل الصوت: ' + (e.message === 'Failed to fetch' ? 'تحقق من الاتصال' : e.message));
    }finally{
      if (voice.ctl === ctl){ voice.ctl = null; voice.busy = false; voiceUI(); el.input.focus(); }
    }
  };
  mr.start();
}
function voiceToggle(){ if (voice.busy) return; voice.on ? voiceStop(false) : voiceStart(); }
voiceAvail();
