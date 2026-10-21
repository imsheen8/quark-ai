/* QUARK AI — التوليد وإرسال الرسالة والعنوان التلقائي */
'use strict';

/* ================= عنوان تلقائي ================= */
async function completeOnce({ ep, model }, prompt, signal, opts = {}){
  if (ep.proto === 'ondevice') return window.__od.engine.once({ ep, model }, prompt, signal, opts);
  if (await gwReady()){
    try{ return await gwOnce({ ep, model }, prompt, signal); }
    catch(e){ if (!e.gwDown) throw e; }
  }
  const base = ep.url.replace(/\/+$/, '');
  if (ep.proto === 'anthropic'){
    const res = await fetch(base + '/messages', { method:'POST', signal,
      headers:{ 'content-type':'application/json', 'x-api-key':ep.key, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true' },
      body: JSON.stringify({ model, max_tokens:opts.max || 60, messages:[{ role:'user', content:prompt }] }) });
    if (!res.ok) throw new Error(await errText(res));
    const j = await res.json();
    return (j.content || []).map(b => b.text || '').join('');
  }
  const headers = { 'content-type':'application/json' };
  if (ep.key) headers.authorization = 'Bearer ' + ep.key;
  if (/openrouter\.ai/.test(base)) headers['X-Title'] = 'QUARK AI';
  const res = await fetch(base + chatPath(base), { method:'POST', signal, headers,
    body: JSON.stringify({ model, stream:false, messages:[{ role:'user', content:prompt }] }) });
  if (!res.ok) throw new Error(await errText(res));
  const j = await res.json();
  return j.choices?.[0]?.message?.content || '';
}
function cleanTitle(t){
  t = String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  t = (t.split('\n').map(x => x.trim()).find(Boolean) || '');
  t = t.replace(/^(العنوان|عنوان المحادثة|title)\s*[:：]\s*/i, '').replace(/^[#>*\-\s"'«»“”`]+|[\s"'«»“”`*.،。!؟?:؛;]+$/g, '').replace(/\s+/g, ' ');
  if (t.length > 50){ t = t.slice(0, 50); t = t.slice(0, t.lastIndexOf(' ') > 20 ? t.lastIndexOf(' ') : 50); }
  return t;
}
async function makeTitle(c, am, manual = false){
  am = am || activeModel();
  const ams = window.utilChain ? window.utilChain(am) : (am && (am.ep.kind === 'local' || am.ep.key) ? [am] : []);
  if (!ams.length){ if (manual) toast('أضف نقطة اتصال أولًا'); return false; }
  const u = c.messages.find(m => m.role === 'user' && !m.error), a = c.messages.find(m => m.role === 'assistant' && !m.error);
  if (!u){ return false; }
  const before = c.title, cut = (x, n) => x.length > n ? x.slice(0, n) + '…' : x;
  const prompt = 'اكتب عنوانًا قصيرًا جدًا (من 2 إلى 5 كلمات) يلخّص موضوع هذه المحادثة، بنفس لغة المستخدم، دون علامات اقتباس ودون نقطة في النهاية. أجب بالعنوان فقط.\n\n' +
    'المستخدم: ' + cut(u.content, 600) + (a ? '\n\nالمساعد: ' + cut(a.content, 600) : '');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  try{
    let t = '', err = null;
    for (const m of ams){          /* النموذج الخاص ثم بدائله ثم نموذج المحادثة */
      try{ t = cleanTitle(await completeOnce(m, prompt, ctl.signal)); err = null; if (t) break; }
      catch(e){ err = e; if (e.name === 'AbortError') break; }
    }
    if (err && !t) throw err;
    if (!t){ if (manual) toast('لم يتمكن النموذج من توليد عنوان'); return false; }
    if (!manual && (!c.autoTitle || c.title !== before) ) return false;   // أعاد المستخدم تسميتها أثناء ذلك
    if (!chats.includes(c)) return false;
    c.title = t; c.autoTitle = false; save(); renderList();
    if (c.id === currentId){ el.title.textContent = t; el.title.classList.remove('title-pop'); void el.title.offsetWidth; el.title.classList.add('title-pop'); }
    if (manual) toast('تم تحديث عنوان المحادثة');
    return true;
  }catch(e){
    if (manual) toast('تعذّر توليد العنوان: ' + (e.name === 'AbortError' ? 'انتهت المهلة' : e.message === 'Failed to fetch' ? 'تعذّر الاتصال' : e.message));
    return false;
  }finally{ clearTimeout(timer); }
}

async function generate(c){
  const node = msgNode({ role:'assistant', content:'' }, { stream:true });
  const bubble = node.querySelector('.bubble');
  bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  el.messages.appendChild(node); scrollDown(true);

  setBusy(true); controller = new AbortController();
  const am0 = activeModel(), chainAM = window.chatChain ? window.chatChain(c) : [am0];
  let usedAM = null, webSrc = null; const apiLog = [];
  const ag = window.agActive?.() ? window.agBegin(c, controller.signal) : null;   /* وضع الوكيل */
  if (ag) window.__agRun = ag;
  const hideTool = t => ag ? t.replace(/```[ \t]*tool[ \t]*\r?\n[\s\S]*?(```|$)/gi, '').trim() : t;   /* لا نعرض كتلة الأداة الخام أثناء البث */
  const waitHtml = msg => `${ag ? ag.liveHtml() : ''}<span class="typing"><i></i><i></i><i></i></span><div class="gen-wait">${esc(msg)}</div>`;
  let full = '', reason = '', raf = 0, final = null, t0 = 0, t1 = 0;
  const view = () => {
    const sp0 = splitThink(full), sp = ag ? { think:sp0.think, ans:hideTool(sp0.ans) } : sp0, think = [reason, sp.think].filter(Boolean).join('\n\n');
    if (think && !t0) t0 = Date.now();
    if (sp.ans && t0 && !t1) t1 = Date.now();
    const live = !sp.ans && !!think;
    return { think, ans:sp.ans, live, secs:t0 ? Math.max(1, Math.round(((t1 || Date.now()) - t0) / 1000)) : 0 };
  };
  const paint = () => { raf = 0; const v = view(); paintBubble(bubble, v.think, v.ans, v.live, v.secs); scrollDown(); };
  const build = () => {
    const v = view(); const o = { role:'assistant', content:v.ans, model:shortModel((usedAM || activeModel())?.model), ts:Date.now() };
    if (webSrc && webSrc.length) o.web = webSrc;
    if (apiLog.length) o.api = apiLog.slice();
    if (ag && (ag.steps.length || ag.plan.length)) o.agent = ag.snapshot();
    if (v.think){ o.thinking = v.think; if (v.secs) o.thinkSecs = v.secs; }
    return o;
  };
  try{
    await ensureImgs(c);
    if (!ag && window.wsOn && window.wsOn()){
      bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span><div class="gen-wait">يبحث في الويب…</div>';
      try{ webSrc = await window.wsPrep(c, controller.signal); if (!webSrc.length) toast('لم تُعثر على نتائج ويب، سيُجاب دون بحث'); }
      catch(e){ if (e.name === 'AbortError') throw e; toast('تعذّر بحث الويب: ' + (e.message === 'Failed to fetch' ? 'تعذّر الاتصال' : e.message)); }
    }
    let hist = buildHistory(c); window.__intLive = !ag;
    for (let round = 0; ; round++){
      for await (const chunk of (window.callChain ? window.callChain(chainAM, hist, controller.signal, c, a => { usedAM = a; }) : callModel(hist, controller.signal, c))){
        if (typeof chunk === 'string') full += chunk; else reason += chunk.think;
        if (!raf) raf = requestAnimationFrame(paint);
      }
      if (raf){ cancelAnimationFrame(raf); raf = 0; }
      const ans = splitThink(full).ans;
      /* وضع الوكيل: أداة واحدة في كل جولة ← النتيجة تعود للنموذج ← جولة جديدة، حتى يكتب جوابًا بلا كتلة tool */
      if (ag){
        const r = await ag.step(ans, msg => { bubble.innerHTML = waitHtml(msg); });
        if (!r) break;
        if (r.stop){ full = full.replace(/```[ \t]*tool[ \t]*\r?\n[\s\S]*?(```|$)/gi, '').trim(); full += (full ? '\n\n' : '') + '⚠️ توقف الوكيل عن استخدام الأدوات (بلغ الحد الأقصى للخطوات أو كرّر الاستدعاءات). راجع سجل الخطوات أدناه، أو أعد المحاولة بسؤال أدق.'; break; }
        bubble.innerHTML = waitHtml('يفكّر في الخطوة التالية…');
        hist = ag.compact(hist.concat([{ role:'assistant', content:ans }, { role:'user', content:r.text }]));
        full = ''; reason = ''; t0 = t1 = 0;
        if (round >= 60) break;
        continue;
      }
      /* التكاملات: إن طلب النموذج استدعاء API ننفّذه (بموافقة المستخدم للتغييرات) ونعيد النتيجة إليه */
      const pc = window.intChatActive?.() && window.intParseCall ? window.intParseCall(ans) : null;
      if (!pc) break;
      if (round >= 4){ full = full.replace(pc.raw, '').trim(); break; }
      const nm = pc.call ? pc.call.integration : '';
      bubble.innerHTML = `<span class="typing"><i></i><i></i><i></i></span><div class="gen-wait">${esc('يستدعي ' + (nm || 'تكاملًا') + '…')}</div>`;
      const res = await window.intRunModelCall(pc, controller.signal);
      apiLog.push(res.log);
      hist = hist.concat([{ role:'assistant', content:ans }, { role:'user', content:res.text }]);
      full = ''; reason = ''; t0 = t1 = 0;
    }
    if (!full && !reason) throw new Error('لم يصل أي رد من النموذج. تأكد من صحة معرّف النموذج.');
    final = build();
    if (!final.content) throw new Error('انتهى النموذج من التفكير دون إجابة نهائية. جرّب إعادة المحاولة أو زِد قيمة Max Tokens.');
  }catch(err){
    if (raf) cancelAnimationFrame(raf);
    if (err.name === 'AbortError'){
      const part = build();
      if (part.content) final = part;
      else {
        node.remove();
        const u = c.messages.pop();
        if (u && u.vers && editFrom.has(u)) undoEdit(c, u);
        else if (u) restorePending(u);
        if (!c.messages.length){ chats = chats.filter(x => x !== c); currentId = null; }
        renderMessages();
      }
      toast('تم الإيقاف');
    } else {
      const msg = err.message === 'Failed to fetch'
        ? 'تعذّر الاتصال. تحقق من الإنترنت أو من عنوان API.'
        : err.message;
      final = { role:'assistant', content:msg, error:true };
      window.QuarkAuth?.onError?.(msg);
    }
  }finally{
    setBusy(false); controller = null; window.__wsCtx = ''; window.__intLive = false; window.__agRun = null;
  }
  if (final){
    c.messages.push(final);
    revealedMsgs.add(final);
    const hadSheet = thinkSheet.tk && node.contains(thinkSheet.tk), nn = msgNode(final, { last:true, noanim:true });
    node.replaceWith(nn);
    if (hadSheet){ thinkSheet.tk = nn.querySelector('.think'); thinkSheet.tk ? renderSheet() : closeThink(); }
  }
  c.ts = Date.now(); save(); renderList(); scrollDown(true);
  if (final && !final.error && !c.temp) window.intEmit?.('chat.completed', { chat_id:c.id, title:c.title, model:final.model || '', text:final.content });
  if (final && !final.error && c.autoTitle && settings.autoTitle && c.messages.length === 2) makeTitle(c, am0);
}

async function toDataUrl(u){
  if (/^data:/.test(u)) return u;
  try{
    const b = await (await fetch(u)).blob();
    return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  }catch{ return u; }
}
async function generateImage(c, imgAM){
  const { ep, model } = imgAM || activeModel();
  const node = msgNode({ role:'assistant', content:'' }, { stream:true });
  node.querySelector('.bubble').innerHTML = '<span class="typing"><i></i><i></i><i></i></span><div class="gen-wait">يولّد الصورة…</div>';
  el.messages.appendChild(node); scrollDown(true);
  setBusy(true); controller = new AbortController();
  let final = null;
  try{
    await ensureImgs(c);
    const only = !!modelMeta(ep, model)?.imgOnly;
    let urls = [], text = '';
    if (await gwReady()){
      try{ const r = await gwImage({ ep, model }, buildHistory(c), controller.signal, only); urls = r.images.map(x => x.data || x.url).filter(Boolean); text = r.text || ''; }
      catch(e){ if (!e.gwDown) throw e; }
    }
    if (!urls.length){
      if (ep.proto === 'anthropic') throw new Error('توليد الصور يتطلب نقطة اتصال بصيغة OpenAI (مثل OpenRouter).');
      const hist = wireMsgs(buildHistory(c), 'openai'), base = ep.url.replace(/\/+$/, '');
      const headers = { 'content-type':'application/json' };
      if (ep.key) headers.authorization = 'Bearer ' + ep.key;
      if (/openrouter\.ai/.test(base)) headers['X-Title'] = 'QUARK AI';
      const order = only ? [['image'], ['image', 'text']] : [['image', 'text'], ['image']];
      let j = null, lastErr = '';
      for (const mods of order){
        const res = await fetch(base + chatPath(base), { method:'POST', signal:controller.signal, headers,
          body: JSON.stringify({ model, messages:hist, modalities:mods, stream:false }) });
        if (res.ok){ j = await res.json(); break; }
        lastErr = await errText(res);
        if (![400, 404, 422].includes(res.status)) break;
      }
      if (!j) throw new Error(lastErr || 'فشل توليد الصورة');
      if (j.error) throw new Error(j.error.message || 'خطأ من المزوّد');
      const msg = j.choices?.[0]?.message || {};
      (msg.images || []).forEach(x => { const u = x?.image_url?.url || x?.url; if (typeof u === 'string' && u) urls.push(u); });
      if (Array.isArray(msg.content)) msg.content.forEach(p => { if (p?.type === 'image_url' && p.image_url?.url) urls.push(p.image_url.url); });
      text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.filter(p => p?.type === 'text').map(p => p.text).join('\n') : '';
    }
    if (!urls.length) throw new Error(text ? 'لم يُنتج النموذج صورة. ردّه: ' + text.slice(0, 300) : 'لم يُنتج النموذج أي صورة. تأكد أن النموذج يدعم توليد الصور.');
    const gen = [];
    for (const u of urls){
      const d = await toDataUrl(u);
      if (/^data:image\//.test(d)){ const o = { id:uid(), name:'generated.png', mime:(d.match(/^data:([^;]+)/) || [])[1] || 'image/png' }; await imgSave({ id:o.id, data:d }); gen.push(o); }
      else gen.push({ url:u });
    }
    final = { role:'assistant', content:text, gen, model:shortModel(model), ts:Date.now() };
  }catch(err){
    if (err.name === 'AbortError'){
      node.remove();
      const u = c.messages.pop();
      if (u && u.vers && editFrom.has(u)) undoEdit(c, u); else if (u) restorePending(u);
      if (!c.messages.length){ chats = chats.filter(x => x !== c); currentId = null; }
      renderMessages(); toast('تم الإيقاف');
    } else final = { role:'assistant', error:true, content: err.message === 'Failed to fetch' ? 'تعذّر الاتصال. تحقق من الإنترنت أو من عنوان API.' : err.message };
  }finally{ setBusy(false); controller = null; }
  if (final){
    c.messages.push(final); revealedMsgs.add(final);
    node.replaceWith(msgNode(final, { last:true, noanim:true }));
  }
  c.ts = Date.now(); save(); renderList(); scrollDown(true);
}

async function sendMessage(){
  if (busy){ controller?.abort(); return; }
  voiceStop(true);
  let text = el.input.value.trim(); if (!text && !pending.length) return;
  let imgAM = null;
  const ip = window.imgPrefix && window.imgPrefix(text);
  if (ip){
    if (!ip.am){ toast('حدّد نموذج توليد الصور من الإعدادات ← النماذج التلقائية'); return; }
    if (!ip.text){ toast('اكتب وصف الصورة بعد الأمر'); return; }
    imgAM = ip.am; text = ip.text;
  }
  const am = activeModel();
  if (!am){ toast('أضف نقطة اتصال واختر نموذجًا أولًا'); openSettings(); return; }
  if (am.ep.kind !== 'local' && !am.ep.key){ toast('أدخل مفتاح API أولًا'); openSettings(); return; }
  if (!cmpReady()) return;
  bumpUse(am); if (cmpState.on) bumpUse(cmpModel());

  if (!current()){ chats.unshift({ id:uid(), title:'محادثة جديدة', messages:[], ts:Date.now(), ...(incog ? { temp:true } : {}) }); currentId = chats[0].id; }
  const c = current();
  const files = pending.filter(f => !f.kind).map(f => ({ ...f }));
  const imgs = pending.filter(f => f.kind === 'image');
  if (!c.messages.length){ c.title = (text || files[0]?.name || 'صورة').slice(0, 40); if (settings.autoTitle && !c.temp) c.autoTitle = true; }
  const um = { role:'user', content:text }; if (files.length) um.files = files;
  if (imgs.length){ um.imgs = imgs.map(({ id, name, mime, w, h }) => ({ id, name, mime, w, h })); imgs.forEach(imgSave); }
  const prevMsg = c.messages[c.messages.length - 1];
  c.messages.push(um);
  if (!c.temp){ if (c.messages.length === 1) window.intEmit?.('session.created', { chat_id:c.id, title:c.title }); window.intEmit?.('chat.message', { chat_id:c.id, title:c.title, text }); }
  c.ts = Date.now();
  el.input.value = ''; pending = []; renderPending(); autosize(); updateSendState(); save(); renderList();
  if (c.messages.length === 1) el.messages.innerHTML = '';
  document.querySelector('.main').classList.remove('empty');
  el.messages.querySelectorAll('.msg.ai > .qrow').forEach(q => q.remove());
  el.messages.querySelectorAll('.msg.ai > .actions').forEach(a => { a.querySelector('[data-regen]')?.remove(); if (a.children.length) a.className = 'u-tools'; else a.remove(); });
  const ln = el.messages.lastElementChild;
  if (ln && prevMsg && ln._m === prevMsg && prevMsg.cmp){
    if (prevMsg.pick == null){
      const k = prevMsg.cmp.findIndex(x => !x.error && x.content);
      if (k >= 0){ prevMsg.pick = k; prevMsg.content = prevMsg.cmp[k].content; toast('تم اعتماد رد ' + shortModel(prevMsg.cmp[k].model)); save(); }
    }
    refreshCmp(ln, { last:false });
  }
  el.title.textContent = c.title;
  el.messages.appendChild(msgNode(um));
  closePop();
  await runGen(c, null, imgAM);
}

