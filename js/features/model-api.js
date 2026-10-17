/* QUARK AI — الاتصال بالنموذج والبث (streaming) */
'use strict';

/* ================= الاتصال بالنموذج ================= */
function setBusy(v){
  busy = v;
  el.send.classList.toggle('stop', v);
  el.send.innerHTML = v ? ic('square', 'fill') : ic('arrow-up');
  el.send.setAttribute('aria-label', v ? 'إيقاف' : 'إرسال');
  updateSendState();
}
function updateSendState(){ el.send.classList.toggle('idle', !busy && !el.input.value.trim() && !pending.length); }
async function* streamSSE(res){
  const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
  while (true){
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream:true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines){ const t = l.trim(); if (t.startsWith('data:')) yield t.slice(5).trim(); }
  }
}
async function errText(res){
  let t = ''; try{ const j = await res.json(); t = j.error?.message || JSON.stringify(j); }catch{ t = res.statusText; }
  if (res.status === 401) t = 'مفتاح API غير صالح. ' + t;
  if (res.status === 402) t = 'الرصيد غير كافٍ. ' + t;
  if (res.status === 404) t = 'النموذج أو العنوان غير موجود، تأكد من معرّف النموذج. ' + t;
  if (res.status === 429) t = 'تجاوزت حد الطلبات. ' + t;
  return `(${res.status}) ${t}`;
}
async function* openaiStyle(url, headers, model, history, signal, P = {}){
  const sp = sysPrompt(); const msgs = sp ? [{ role:'system', content:sp }, ...history] : history;
  const res = await fetch(url, { method:'POST', signal, headers:{ 'content-type':'application/json', ...headers },
    body: JSON.stringify({ model, messages:msgs, stream:true,
      ...(P.temperature != null && { temperature:P.temperature }),
      ...(P.top_p != null && { top_p:P.top_p }),
      ...(P.max_tokens != null && { [/api\.openai\.com/.test(url) ? 'max_completion_tokens' : 'max_tokens']:P.max_tokens }) }) });
  if (!res.ok) throw new Error(await errText(res));
  for await (const data of streamSSE(res)){
    if (data === '[DONE]') return;
    let j; try{ j = JSON.parse(data); }catch{ continue; }
    if (j.error) throw new Error(j.error.message || 'خطأ من المزوّد');
    const dl = j.choices?.[0]?.delta, rs = dl?.reasoning_content ?? dl?.reasoning;
    if (typeof rs === 'string' && rs) yield { think:rs };
    if (dl?.content) yield dl.content;
  }
}
const PRM_KEYS = ['temperature','top_p','max_tokens'];
const modelKey = am => am ? am.ep.id + '|' + am.model : null;
/* ----- نماذج توليد الصور ----- */
const IMG_NAME = /(^|[\/\-_:.])(image|imagen|flux|dall-e|sdxl|stable-diffusion|nano-banana|seedream|ideogram|recraft)([\/\-_:.]|$)/i;
const modelMeta = (ep, id) => ep.models.find(m => m.id === id);
function isImgModel(ep, id){ const m = modelMeta(ep, id); if (m && m.img !== undefined) return !!m.img; return IMG_NAME.test(id); }
const imgFlag = (ids, i) => { const v = ids.img && ids.img.get(i); return v ? (v.img ? { img:true, imgOnly:v.only } : { img:false }) : {}; };
const cleanParams = o => { const r = {}; PRM_KEYS.forEach(k => { const v = o?.[k]; if (typeof v === 'number' && isFinite(v)) r[k] = v; }); return r; };
function resolveParams(c, am0){
  const am = am0 || activeModel();
  return { ...cleanParams(settings.params.global), ...cleanParams(am && settings.params.models[modelKey(am)]), ...cleanParams(c?.params) };
}
async function* callModel(history, signal, chat, amOverride){
  const am = amOverride || activeModel(), { ep, model } = am;
  const P = resolveParams(chat, am);
  if (ep.proto === 'ondevice'){ yield* window.__od.engine.chat(am, history, signal, P, sysPrompt()); return; }
  if (await gwReady()){
    try{ yield* gwChat(am, history, signal, P, sysPrompt()); return; }
    catch(e){ if (!e.gwDown) throw e; }          // البوابة سقطت قبل أي رد → نكمل مباشرةً
  }
  if (['gemini', 'ollama'].includes(ep.proto)) throw new Error('هذه النقطة بصيغة ' + (ep.proto === 'gemini' ? 'Gemini' : 'Ollama') + ' الأصلية وتتطلب تشغيل البوابة (python3 serve.py) أو ضبط عنوان البوابة في الإعدادات. أو غيّر البروتوكول إلى OpenAI.');
  history = wireMsgs(history, ep.proto);
  const base = ep.url.replace(/\/+$/,'');
  if (ep.proto === 'anthropic'){
    const res = await fetch(base + '/messages', { method:'POST', signal,
      headers:{ 'content-type':'application/json', 'x-api-key':ep.key, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true' },
      body: JSON.stringify({ model, max_tokens:P.max_tokens ?? 4096, stream:true, system:sysPrompt() || undefined, messages:history,
        ...(P.temperature != null && { temperature:Math.min(P.temperature, 1) }),
        ...(P.temperature == null && P.top_p != null && { top_p:P.top_p }) }) });
    if (!res.ok) throw new Error(await errText(res));
    for await (const data of streamSSE(res)){
      let j; try{ j = JSON.parse(data); }catch{ continue; }
      if (j.type === 'content_block_delta' && j.delta?.thinking) yield { think:j.delta.thinking };
      if (j.type === 'content_block_delta' && j.delta?.text) yield j.delta.text;
      if (j.type === 'error') throw new Error(j.error?.message || 'خطأ من الخادم');
    }
  } else {
    const headers = ep.key ? { authorization:'Bearer ' + ep.key } : {};
    if (/openrouter\.ai/.test(base)) headers['X-Title'] = 'QUARK AI';
    yield* openaiStyle(base + '/chat/completions', headers, model, history, signal, P);
  }
}
function buildHistory(c){
  const out = [];
  for (const m of c.messages){
    if (m.error) continue;
    const last = out[out.length - 1];
    const fc = fullContent(m) || (m.gen && m.gen.length ? '[صورة مُولَّدة]' : '');
    const imgs = (m.imgs || []).map(i => ({ mime:i.mime, data:imgCache.get(i.id) })).filter(i => i.data);
    if (last && last.role === m.role){ last.content += '\n\n' + fc; if (imgs.length) (last.images = last.images || []).push(...imgs); }
    else out.push({ role:m.role, content:fc, ...(imgs.length ? { images:imgs } : {}) });
  }
  return out;
}

