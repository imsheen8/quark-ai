/* QUARK AI — الإعدادات: صفحة الصوت (تبويبان: القراءة الصوتية / التعرّف على الكلام) + مفاتيح الصوت داخل «المفاتيح والنماذج» ← تبويب «مفاتيح الصوت» — الأصوات نفسها في صفحة النماذج */
'use strict';

(() => {
  const body = $('voBody'), kbody = $('keysVoice');
  const ic2 = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const cfgOf = k => { const s = voiceCfg[k]; return (s.cfg[s.p] = s.cfg[s.p] || {}); };
  const netErr = e => e.message === 'Failed to fetch' ? 'تعذّر الاتصال (تحقق من الإنترنت أو من عنوان API)' : e.message;
  const rateTxt = v => (+v).toFixed(1).replace('.0', '') + '×';
  const SAMPLE_AR = 'مرحبًا! هذا اختبار للصوت من تطبيق كوارك. Hello, this is a voice test.';
  const SAMPLE_EN = 'Hello! This is a voice test from Quark AI.';
  const langName = v => (STT_LANGS.find(l => l[0] === v) || [, v])[1];
  let voTab = 'tts';   /* تبويب صفحة الصوت: 'tts' | 'stt' */
  let kTab = 'text';   /* تبويب صفحة المفاتيح: 'text' | 'voice' */

  /* ---------- صفوف ---------- */
  const pickRow = (id, icon, title, val) =>
    `<button type="button" class="sh-row vo-pick" data-pick="${id}">${ic2(icon)}<span class="sh-t"><b>${esc(title)}</b><small>${esc(val)}</small></span>${ic2('chevron-down')}</button>`;
  const inRow = (id, icon, label, val, ph, o = {}) =>
    `<label class="sh-row vo-in"><span class="vo-ic">${ic2(icon)}</span><span class="sh-t"><small>${esc(label)}</small>` +
    `<input id="${id}" type="${o.type || 'text'}" dir="ltr" autocomplete="off" spellcheck="false" placeholder="${esc(ph)}" value="${esc(val)}"${o.list ? ` list="${id}L"` : ''}${o.ro ? ' readonly' : ''}></span>` +
    `${o.list ? `<datalist id="${id}L">${o.list.map(m => `<option value="${esc(m)}">`).join('')}</datalist>` : ''}</label>`;
  const btnRow = (id, icon, title) => `<button type="button" class="sh-row" id="${id}">${ic2(icon)}<span class="sh-t"><b>${esc(title)}</b></span></button>`;

  function provRows(k){
    const sec = voiceCfg[k], P = k === 'stt' ? STT_PROVIDERS : TTS_PROVIDERS, d = P[sec.p], c = cfgOf(k);
    const conn = voiceConnsFor(k).find(x => x.id === sec.conn);
    let h = pickRow(k + 'Prov', 'monitor', 'المزوّد', conn ? voiceConnLabel(conn) : 'اختر مزوّدًا (أضف API أولًا)');
    if (!(k === 'tts' && d.voiceIsModel)) h += inRow(k + 'Model', 'cpu', 'النموذج', c.model || d.model || '', 'اسم النموذج', { list:d.models });
    return h;
  }

  /* ---------- اتصالات الصوت (API): تُضاف مرة واحدة وتُختار للقراءة والتعرّف ---------- */
  let vcPreset = 'openai';
  const connCard = c => {
    const caps = voiceConnCaps(c), used = ['tts', 'stt'].filter(k => voiceCfg[k].conn === c.id);
    const keyTxt = c.key ? 'المفتاح: ••••' + esc(c.key.slice(-4)) : 'بدون مفتاح';
    const usedTxt = used.length ? ' · مستخدم في ' + used.map(k => k === 'tts' ? 'القراءة' : 'التعرّف').join(' و') : '';
    return `<div class="ep-card${c.enabled ? '' : ' off'}" data-vc="${esc(c.id)}"><div class="ep-top" style="cursor:default"><div class="ep-info">` +
      `<div class="ep-name"><b dir="ltr">${esc(voiceConnHost(c))}</b>${caps.tts ? '<span class="tag">قراءة</span>' : ''}${caps.stt ? '<span class="tag">تعرّف</span>' : ''}${c.enabled ? '' : '<span class="tag mute">معطّلة</span>'}</div>` +
      `<small>${keyTxt}${usedTxt}</small></div>` +
      `<button type="button" class="ep-btn" data-vca="en">${c.enabled ? 'تعطيل' : 'تفعيل'}</button><button type="button" class="ep-btn del" data-vca="del">حذف</button></div>` +
      `<div class="ep-url"><span>${esc(c.url || VOICE_PRESETS[c.preset].url)}</span><button type="button" class="ep-copy" data-vca="copy" aria-label="نسخ العنوان">${ic2('copy')}</button></div></div>`;
  };
  function connSection(){
    const P = VOICE_PRESETS[vcPreset];
    let h = '<p class="vo-sec">مفاتيح الصوت (API)</p><div class="panel vo-conn">' +
      `<div class="f-join"><input class="fld" id="vcUrl" type="text" dir="ltr" autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1" value="${esc(P.url)}"${P.fixed ? ' readonly' : ''}>` +
      `<div class="sel-wrap"><select class="fld" id="vcPreset" aria-label="المزوّد">${Object.entries(VOICE_PRESETS).map(([k, v]) => `<option value="${k}"${k === vcPreset ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select><svg class="i caret"><use href="#i-chevron-down"/></svg></div></div>` +
      `<div class="f-row"><input class="fld f-key" id="vcKey" type="password" dir="ltr" autocomplete="off" spellcheck="false" placeholder="${P.custom ? 'مفتاح API (اختياري)' : 'مفتاح API'}">` +
      `<button type="button" class="f-btn" id="vcTest">اختبار</button><button type="button" class="f-btn pri" id="vcAdd">إضافة</button></div>` +
      `<div class="key-help" id="vcHelp">${voiceConnHelp(vcPreset)}</div></div>`;
    h += '<div class="panel vo-conn"><div class="ep-title">' + ic2('monitor') + '<b>المفاتيح المضافة</b></div><div class="ep-line"></div>' +
      '<p class="panel-desc">أضف المفتاح مرة واحدة ثم اختره كمزوّد في صفحة «الصوت» (القراءة الصوتية والتعرّف على الكلام).</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
      (voiceCfg.conns.length ? voiceCfg.conns.map(connCard).join('') : '<div class="empty-list">لم تُضف أي API بعد. استخدم النموذج أعلاه لإضافة أول واحد.</div>') + '</div></div>';
    return h;
  }

  /* اسم الصوت الحالي للقراءة (يُدار من صفحة النماذج ← الأصوات) */
  function curVoiceName(){
    const p = voiceCfg.tts.p, d = TTS_PROVIDERS[p], tc = cfgOf('tts');
    const id = d.voiceIsModel ? (tc.model || d.model) : (tc.voice || d.voice);
    const v = ttsVoiceList(p).find(x => x.id === id);
    return v ? v.name : (id || 'غير محدد');
  }

  /* ---------- مفاتيح الصوت (داخل المفاتيح والنماذج) ---------- */
  function renderKeys(){
    kbody.innerHTML = connSection() +
      '<p class="vo-help">تُحفظ المفاتيح على جهازك فقط وتُرسل مباشرة إلى المزوّد الذي تختاره، وتُحفظ التغييرات فورًا. قد يرفض بعض المزوّدين الطلبات المباشرة من المتصفح (CORS).</p>';
  }
  function applyKeysTab(){
    $('keysText').hidden = kTab !== 'text'; kbody.hidden = kTab !== 'voice';
    $('keysTabs').querySelectorAll('[data-ktab]').forEach(b => { const on = b.dataset.ktab === kTab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    if (kTab === 'voice') renderKeys();
  }
  const refresh = () => { renderKeys(); render(); };

  function render(){
    const ttsP = TTS_PROVIDERS[voiceCfg.tts.p];
    const sttP = STT_PROVIDERS[voiceCfg.stt.p];

    /* شريط التبويبين */
    let h = `<div class="vo-tabs" role="tablist"><button type="button" role="tab" class="vo-tab${voTab === 'tts' ? ' on' : ''}" data-votab="tts" aria-selected="${voTab === 'tts'}">${ic2('sh-wave')}<span>القراءة الصوتية</span></button>` +
      `<button type="button" role="tab" class="vo-tab${voTab === 'stt' ? ' on' : ''}" data-votab="stt" aria-selected="${voTab === 'stt'}">${ic2('mic')}<span>التعرّف على الكلام</span></button></div>`;

    if (!voiceConnsFor(voTab).length){
      h += `<div class="panel vo-nokey"><p class="panel-desc">لم تُضف مفتاح API يدعم ${voTab === 'tts' ? 'القراءة الصوتية' : 'التعرّف على الكلام'} بعد. أضفه من «المفاتيح والنماذج» ← «مفاتيح الصوت».</p><button type="button" class="f-btn pri" data-vokeys>إضافة مفتاح صوت</button></div>`;
    }
    if (voTab === 'tts'){
      /* ===== تبويب القراءة الصوتية ===== */
      h += '<div class="sh-grp">' + provRows('tts');
      h += `<button type="button" class="sh-row vo-pick" id="ttsVoiceGo">${ic2('user')}<span class="sh-t"><b>الصوت</b><small>${esc(curVoiceName())}</small></span>${ic2('chevron-down')}</button>`;
      h += `<div class="sh-row vo-rate"><div class="vo-rt"><span class="sh-t"><b>سرعة القراءة</b></span><em id="ttsRateV">${rateTxt(voiceCfg.tts.rate || 1)}</em></div><input type="range" id="ttsRate" min="0.5" max="2" step="0.1" value="${voiceCfg.tts.rate || 1}"></div>`;
      h += btnRow('ttsTest', 'sh-wave', 'تجربة القراءة');
      h += '</div>';
      if (ttsP.help) h += `<p class="vo-help">${ttsP.help}</p>`;
      h += '<p class="vo-help">لاختيار الصوت أو إضافة صوت مخصص افتح «النماذج» ← تبويب «الأصوات».</p>';
    } else {
      /* ===== تبويب التعرّف على الكلام ===== */
      h += '<div class="sh-grp">' + provRows('stt');
      h += pickRow('sttLang', 'globe', 'اللغة', langName(voiceCfg.stt.lang)) + btnRow('sttTest', 'mic', 'اختبار (تسجيل 4 ثوانٍ)') + '</div>';
      if (sttP.help) h += `<p class="vo-help">${sttP.help}</p>`;
      h += '<p class="vo-res" id="voRes" hidden></p>';
    }
    body.innerHTML = h;
  }

  /* ---------- قائمة الاختيار السفلية ---------- */
  function pick(title, opts, cur, done){
    const ov = document.createElement('div'); ov.className = 'vo-sheet';
    ov.innerHTML = `<div class="vo-bd"></div><div class="vo-box" role="listbox"><h3>${esc(title)}</h3>` +
      opts.map(o => `<button type="button" class="vo-opt${o.v === cur ? ' on' : ''}" data-v="${esc(o.v)}"><span>${esc(o.l)}</span>${o.v === cur ? ic2('check') : ''}</button>`).join('') + '</div>';
    const close = () => { ov.classList.remove('show'); setTimeout(() => ov.remove(), 200); };
    ov.addEventListener('click', e => {
      if (e.target.classList.contains('vo-bd')) return close();
      const b = e.target.closest('.vo-opt'); if (b){ close(); done(b.dataset.v); }
    });
    $('modal').appendChild(ov); requestAnimationFrame(() => ov.classList.add('show'));
  }

  /* ---------- أحداث ---------- */
  body.addEventListener('click', async e => {
    const vt = e.target.closest('[data-votab]');
    if (vt){ if (vt.dataset.votab !== voTab){ speakStop(); voTab = vt.dataset.votab; render(); $('modal').querySelector('.set-body').scrollTop = 0; } return; }
    if (e.target.closest('[data-vokeys]')) return window.__openVoiceKeys();
    if (e.target.closest('#ttsVoiceGo')) return window.__openVoices?.();
    const pk = e.target.closest('[data-pick]');
    if (pk){
      const id = pk.dataset.pick;
      if (id === 'sttLang') return pick('اللغة', STT_LANGS.map(([v, l]) => ({ v, l })), voiceCfg.stt.lang, v => { voiceCfg.stt.lang = v; saveVoiceCfg(); render(); });
      const k = id.slice(0, 3), list = voiceConnsFor(k);
      if (!list.length){ toast('أضف API أولًا من «مفاتيح الصوت»'); window.__openVoiceKeys(); return; }
      return pick('المزوّد', list.map(c => ({ v:c.id, l:voiceConnLabel(c) })), voiceCfg[k].conn, v => {
        const c = voiceCfg.conns.find(x => x.id === v); if (!c) return;
        speakStop(); voiceCfg[k].conn = v; voiceCfg[k].p = c.preset; saveVoiceCfg(); render();
      });
    }
    if (e.target.closest('#ttsTest')){
      const c = voiceConf('tts');
      if (!c.key && !c.def.keyOptional){ toast('أضف API أولًا من «المفاتيح والنماذج» ← «مفاتيح الصوت»'); return; }
      speakText(voiceCfg.tts.p === 'deepgram' ? SAMPLE_EN : SAMPLE_AR, $('ttsTest')); return;
    }
    if (e.target.closest('#sttTest')) testStt();
  });
  body.addEventListener('input', e => {
    const t = e.target, id = t.id; if (!id) return;
    if (id === 'ttsRate'){ voiceCfg.tts.rate = +t.value; $('ttsRateV').textContent = rateTxt(t.value); saveVoiceCfg(); return; }
    const k = id.slice(0, 3), prop = id.slice(3).toLowerCase();
    if (id === 'ttsModel' && voiceCfg.tts.p === 'elevenlabs' && /^[A-Za-z0-9]{20}$/.test(t.value.trim()) && !/^eleven_/.test(t.value.trim()))
      toast('هذا يبدو معرّف صوت وليس نموذجًا — ضعه في «معرّف صوت مخصص» واستخدم eleven_multilingual_v2 للنموذج');
    if (!['stt', 'tts'].includes(k) || !['key', 'model', 'url', 'voice'].includes(prop)) return;
    cfgOf(k)[prop] = t.value.trim(); saveVoiceCfg();
  });
  /* ---------- نموذج إضافة API ---------- */
  function vcRead(){
    const P = VOICE_PRESETS[vcPreset], key = $('vcKey').value.trim();
    let url = $('vcUrl').value.trim().replace(/\/+$/, '');
    if (P.fixed) url = '';
    else if (!/^https?:\/\/\S+/i.test(url)){ toast('أدخل عنوان API صحيحًا يبدأ بـ http'); return null; }
    if (!key && !P.custom){ toast('أدخل مفتاح API'); return null; }
    return { preset:vcPreset, url:url === P.url ? '' : url, key };
  }
  async function vcTest(){
    const v = vcRead(); if (!v) return;
    const b = $('vcTest'); b.disabled = true;
    try{ await voiceConnTest(v.preset, v.url, v.key); toast('الاتصال ناجح'); }
    catch(err){ toast('فشل الاتصال: ' + netErr(err)); }
    b.disabled = false;
  }
  function vcAdd(){
    const v = vcRead(); if (!v) return;
    if (voiceCfg.conns.some(c => c.preset === v.preset && c.key === v.key && (c.url || '') === v.url)){ toast('هذا الـ API مضاف مسبقًا'); return; }
    voiceCfg.conns.push({ id:voiceConnId(), ...v, enabled:true });
    voiceAutoConn(); saveVoiceCfg(); refresh(); toast('تمت إضافة الـ API');
  }
  kbody.addEventListener('change', e => {
    if (e.target.id !== 'vcPreset') return;
    vcPreset = e.target.value; const P = VOICE_PRESETS[vcPreset], u = $('vcUrl');
    u.value = P.url; u.readOnly = !!P.fixed;
    $('vcKey').placeholder = P.custom ? 'مفتاح API (اختياري)' : 'مفتاح API';
    $('vcHelp').innerHTML = voiceConnHelp(vcPreset);
  });
  kbody.addEventListener('click', async e => {
    if (e.target.closest('#vcTest')) return vcTest();
    if (e.target.closest('#vcAdd')) return vcAdd();
    const va = e.target.closest('[data-vca]'); if (!va) return;
    const card = va.closest('[data-vc]'), c = card && voiceCfg.conns.find(x => x.id === card.dataset.vc); if (!c) return;
    const a = va.dataset.vca;
    if (a === 'copy'){ const ok = await copyText(c.url || VOICE_PRESETS[c.preset].url); toast(ok ? 'تم نسخ العنوان' : 'تعذّر النسخ'); return; }
    if (a === 'en'){ c.enabled = !c.enabled; speakStop(); voiceAutoConn(); saveVoiceCfg(); refresh(); return; }
    if (a === 'del'){
      if (!await qConfirm('حذف هذا الـ API؟ لن يعمل أي قسم يستخدمه حتى تختار غيره.', { ok:'حذف' })) return;
      voiceCfg.conns = voiceCfg.conns.filter(x => x.id !== c.id); speakStop(); voiceAutoConn(); saveVoiceCfg(); refresh(); toast('تم الحذف');
    }
  });
  $('keysTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-ktab]'); if (!b || b.dataset.ktab === kTab) return;
    kTab = b.dataset.ktab; applyKeysTab(); el.modal.querySelector('.set-body').scrollTop = 0;
  });

  /* اختبار التعرّف: تسجيل 4 ثوانٍ ثم تحويله */
  async function testStt(){
    const b = $('sttTest'), res = $('voRes'); res.hidden = false; res.className = 'vo-res';
    const c = voiceConf('stt');
    if (!c.key && !c.def.keyOptional){ res.textContent = 'أدخل مفتاح API أولًا'; res.classList.add('bad'); return; }
    if (!(navigator.mediaDevices && window.MediaRecorder)){ res.textContent = 'التسجيل غير مدعوم هنا'; res.classList.add('bad'); return; }
    b.disabled = true; let stream;
    try{ stream = await navigator.mediaDevices.getUserMedia({ audio:true }); }
    catch{ res.textContent = 'اسمح للتطبيق بالوصول إلى الميكروفون'; res.classList.add('bad'); b.disabled = false; return; }
    try{
      const chunks = [], mr = new MediaRecorder(stream);
      mr.ondataavailable = ev => ev.data && ev.data.size && chunks.push(ev.data);
      const stopped = new Promise(r => mr.onstop = r);
      mr.start(); let left = 4; res.textContent = `تحدّث الآن… ${left}`;
      const iv = setInterval(() => { left--; if (left > 0) res.textContent = `تحدّث الآن… ${left}`; }, 1000);
      await new Promise(r => setTimeout(r, 4000)); clearInterval(iv); mr.stop(); await stopped;
      stream.getTracks().forEach(t => t.stop());
      res.textContent = 'جارٍ التحويل…';
      const t = await sttTranscribe(new Blob(chunks, { type:mr.mimeType || 'audio/webm' }));
      res.textContent = t ? 'النتيجة: ' + t : 'نجح الاتصال لكن لم يُفهم أي كلام'; res.classList.add(t ? 'ok' : 'bad');
    }catch(err){
      stream.getTracks().forEach(t => t.stop());
      res.textContent = 'فشل: ' + netErr(err); res.classList.add('bad');
    }
    b.disabled = false;
  }

  window.renderVoice = render;
  window.renderKeysVoice = applyKeysTab;
  /* فتح «المفاتيح والنماذج» على تبويب «مفاتيح الصوت» */
  window.__openVoiceKeys = () => { kTab = 'voice'; openSettings('keys'); };
})();
