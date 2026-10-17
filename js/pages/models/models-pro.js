/* QUARK AI — صفحة النماذج: الميزات المتقدمة
   بيانات لكل نموذج (اسم مستعار/ملاحظة/لون/سجل اختبارات) + لوحة تفاصيل + ساحة تجربة + مقارنة أداء + نظرة عامة + تصدير/استيراد */
'use strict';

(() => {
  const mdMeta = store.get('ai_model_meta', {});
  const saveMeta = () => store.set('ai_model_meta', mdMeta);
  const meta = k => mdMeta[k] || {};
  const metaW = k => mdMeta[k] || (mdMeta[k] = {});
  const I = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const LABELS = ['#e5484d', '#f08c3a', '#e5b93a', '#2f9e5a', '#3e8ede', '#9a6ad8'];

  /* ---------- تقديرات بحسب الاسم (تقريبية) ---------- */
  const FAMS = [['GPT', /gpt|chatgpt|(^|[\/\-_:.])o[1-9](-|$|:)|davinci/i], ['Claude', /claude/i], ['Gemini', /gemini|gemma|palm/i], ['Llama', /llama/i],
    ['Qwen', /qwen|qwq/i], ['DeepSeek', /deepseek/i], ['Mistral', /mistral|mixtral|codestral|pixtral|ministral/i], ['Grok', /grok/i]];
  const famOf = id => (FAMS.find(f => f[1].test(id)) || ['أخرى'])[0];
  function ctxOf(id){
    for (const e of settings.endpoints){ const m = e.models.find(x => x.id === id && x.ctx); if (m) return m.ctx; }
    const s = id.toLowerCase(), k = s.match(/(?:^|[^\d.])(\d{1,4})k(?:[^a-z]|$)/);
    if (k && +k[1] >= 8 && +k[1] <= 2000) return +k[1] * 1000;
    if (/gemini-?(1\.5|2|2\.5|3)/.test(s) || /gpt-4\.1/.test(s)) return 1e6;
    if (/gpt-5/.test(s)) return 4e5;
    if (/claude/.test(s)) return 2e5;
    if (/(^|[\/\-_:.])o[134](-|$|:)/.test(s)) return 2e5;
    if (/gpt-4o|gpt-4-turbo|llama-?3\.[1-3]|llama-?4|deepseek|qwen|mistral-(large|small|medium)|mixtral/.test(s)) return 128000;
    if (/grok-?4/.test(s)) return 256000;
    if (/gpt-4/.test(s)) return 8192;
    if (/gpt-3\.5/.test(s)) return 16385;
    return 0;
  }
  const fmtCtx = n => !n ? '—' : n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : Math.round(n / 1000) + 'K';
  const ago = ts => {
    if (!ts) return '—'; const d = (Date.now() - ts) / 1000;
    return d < 60 ? 'الآن' : d < 3600 ? 'قبل ' + Math.floor(d / 60) + ' د' : d < 86400 ? 'قبل ' + Math.floor(d / 3600) + ' س' : 'قبل ' + Math.floor(d / 86400) + ' يوم';
  };
  const secs = ms => ms == null ? '—' : (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';
  const estTok = t => Math.max(1, Math.round(String(t).length / 3.2));

  /* ---------- سجل الاختبارات ---------- */
  function record(key, r){
    const m = metaW(key); (m.hist = m.hist || []).push({ ts:Date.now(), ok:!!r.ok, ms:r.ms || 0, err:r.ok ? '' : String(r.err || '').slice(0, 140), ttft:r.ttft || 0, tps:r.tps || 0 });
    if (m.hist.length > 10) m.hist.splice(0, m.hist.length - 10); saveMeta();
  }
  const lastOf = key => { const h = meta(key).hist; return h && h.length ? h[h.length - 1] : null; };
  function statusOf(key){
    const t = mdTest[key]; if (t && t.busy) return 'busy';
    if (t) return t.ok ? 'ok' : 'bad';
    const l = lastOf(key); return l ? (l.ok ? 'ok' : 'bad') : 'none';
  }
  const latOf = key => { const t = mdTest[key]; if (t && t.ok) return t.ms; const l = lastOf(key); return l && l.ok ? l.ms : null; };

  /* ---------- نافذة منبثقة عامة (ورقة سفلية) ---------- */
  function sheet(title, html, cls = ''){
    const ov = document.createElement('div'); ov.className = 'sheet-ov show md-sheet-ov';
    ov.innerHTML = `<div class="sheet md-sheet ${cls}" role="dialog" aria-modal="true"><div class="sheet-handle"></div><div class="sheet-head"><span></span><h3>${esc(title)}</h3><button type="button" class="sheet-x" data-x aria-label="إغلاق">${ic('x')}</button></div><div class="sheet-body">${html}</div></div>`;
    const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); e.preventDefault(); close(); } };
    const hooks = []; const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); hooks.forEach(f => f()); };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) close(); });
    document.body.appendChild(ov);
    return { ov, close, body:ov.querySelector('.sheet-body'), onClose:f => hooks.push(f) };
  }

  /* ---------- بطاقة: إضافات العرض ---------- */
  const cardExtra = it => {
    const m = meta(it.key), c = ctxOf(it.m.id), l = latOf(it.key);
    return { alias:m.alias || '', note:m.note || '', color:m.color || '', ctx:c, lat:l, fam:famOf(it.m.id) };
  };

  /* ---------- لوحة التفاصيل ---------- */
  function detail(it){
    const { ep, m, key } = it, mt = meta(key), u = modelUse[key], ex = cardExtra(it), am = activeModel();
    const hist = (mt.hist || []).slice(-8), mx = Math.max(1, ...hist.map(h => h.ms));
    const P = cleanParams(settings.params.models[key]), pg = cleanParams(settings.params.global);
    const prm = ['temperature', 'top_p', 'max_tokens'].map(k => `<div class="md-kv"><span>${k}</span><b>${P[k] != null ? P[k] : pg[k] != null ? pg[k] + ' <small>(عام)</small>' : '<small>افتراضي</small>'}</b></div>`).join('');
    const isA = isActiveItem(it, am), fav = modelFav.has(key);
    const s = sheet('تفاصيل النموذج', `
      <div class="md-dh"><span class="md-dot" style="${ex.color ? `background:${ex.color}` : ''}"></span><div><h2 dir="ltr">${esc(m.id)}</h2><p dir="ltr">${esc(hostOf(ep.url))} · ${esc(ep.proto === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible')}</p></div></div>
      <div class="md-chips-row"><span class="lib-badge acc">${esc(ex.fam)}</span>${isImgModel(ep, m.id) ? '<span class="lib-badge acc">توليد صور</span>' : ''}${capReason(m.id) ? '<span class="lib-badge">تفكير</span>' : ''}${capVision(m.id) ? '<span class="lib-badge">رؤية</span>' : ''}${ep.kind === 'local' ? '<span class="lib-badge">محلي</span>' : ''}${isA ? '<span class="lib-badge ok">الحالي</span>' : ''}</div>
      <div class="md-stats4">
        <div><b>${u?.n || 0}</b><small>استخدام</small></div><div><b>${ago(u?.ts)}</b><small>آخر استخدام</small></div>
        <div><b>${ex.ctx ? '≈' + fmtCtx(ex.ctx) : '—'}</b><small>نافذة السياق (تقدير)</small></div><div><b>${ex.lat != null ? secs(ex.lat) : '—'}</b><small>زمن الاستجابة</small></div>
      </div>
      <div class="md-acts">
        <button class="lib-btn pri" data-d="use"${!ep.enabled || isA ? ' disabled' : ''}>${I('check')}${isA ? 'قيد الاستخدام' : 'استخدام'}</button>
        <button class="lib-btn" data-d="play">${I('send')}ساحة التجربة</button>
        <button class="lib-btn" data-d="test">${I('clock')}اختبار</button>
        <button class="lib-btn" data-d="second">${I('columns')}للمقارنة</button>
        <button class="lib-btn" data-d="fav">${I('lib-star')}${fav ? 'إزالة المفضلة' : 'مفضلة'}</button>
        <button class="lib-btn" data-d="params">${I('settings')}المعاملات</button>
      </div>
      <p class="vo-sec">سجل الاختبارات</p>
      ${hist.length ? `<div class="md-spark">${hist.map(h => `<i class="${h.ok ? '' : 'bad'}" style="height:${h.ok ? Math.max(12, h.ms / mx * 100) : 100}%" title="${esc(h.ok ? secs(h.ms) : h.err)}"></i>`).join('')}</div>
        <div class="md-hist">${hist.slice().reverse().slice(0, 4).map(h => `<div><span>${ago(h.ts)}</span><b class="${h.ok ? 'ok' : 'bad'}">${h.ok ? '✓ ' + secs(h.ms) + (h.tps ? ' · ≈' + h.tps + ' tok/s' : '') : '✕ ' + esc(h.err || 'فشل')}</b></div>`).join('')}</div>`
        : '<p class="vo-help">لم يُختبر بعد. اضغط «اختبار» لقياس الاتصال وزمن الاستجابة.</p>'}
      <p class="vo-sec">تخصيص</p>
      <label class="lib-f">اسم مستعار <span class="tc-opt">(يظهر في بطاقة النموذج)</span><input type="text" id="mdAl" maxlength="40" value="${esc(mt.alias || '')}" placeholder="مثال: المترجم السريع"></label>
      <label class="lib-f">ملاحظة<textarea id="mdNt" maxlength="300" placeholder="متى تستخدم هذا النموذج؟ نقاط قوته وضعفه…" style="min-height:76px">${esc(mt.note || '')}</textarea></label>
      <div class="lib-f"><span>لون التصنيف</span><div class="md-lbls"><button type="button" class="md-lb none${ex.color ? '' : ' on'}" data-lb="">${I('x')}</button>${LABELS.map(c => `<button type="button" class="md-lb${ex.color === c ? ' on' : ''}" data-lb="${c}" style="background:${c}"></button>`).join('')}</div></div>
      <p class="vo-sec">المعاملات الفعّالة</p><div class="md-kvs">${prm}</div>
      <div class="md-acts" style="margin-top:14px"><button class="lib-btn" data-d="copy">${I('copy')}نسخ المعرّف</button><button class="lib-btn" data-d="toggle">${I('lib-power')}${m.on ? 'تعطيل' : 'تفعيل'}</button><button class="lib-btn dng" data-d="del">${I('trash')}حذف</button></div>`, 'md-detail');
    const q = x => s.ov.querySelector(x);
    q('#mdAl').addEventListener('input', e => { const v = e.target.value.trim(); const w = metaW(key); v ? w.alias = v : delete w.alias; saveMeta(); });
    q('#mdNt').addEventListener('input', e => { const v = e.target.value.trim(); const w = metaW(key); v ? w.note = v : delete w.note; saveMeta(); });
    s.onClose(() => mdRender());
    s.ov.addEventListener('click', async e => {
      const lb = e.target.closest('[data-lb]');
      if (lb){ const w = metaW(key); lb.dataset.lb ? w.color = lb.dataset.lb : delete w.color; saveMeta();
        s.ov.querySelectorAll('.md-lb').forEach(x => x.classList.toggle('on', x === lb)); q('.md-dot').style.background = lb.dataset.lb || ''; return; }
      const a = e.target.closest('[data-d]')?.dataset.d; if (!a) return;
      if (a === 'use'){ mdUse(it); s.close(); }
      else if (a === 'second'){ mdSecond(it); s.close(); }
      else if (a === 'fav'){ mdToggleFav(it); s.close(); detail(it); }
      else if (a === 'test'){ s.close(); await mdTestOne(it); detail(itemOf(key) || it); }
      else if (a === 'play'){ s.close(); play(it); }
      else if (a === 'params'){ s.close(); mdParams(it); }
      else if (a === 'copy') toast(await copyText(m.id) ? 'تم نسخ المعرّف' : 'تعذّر النسخ');
      else if (a === 'toggle'){ m.on = !m.on; persistSettings(); mdRender(); s.close();  }
      else if (a === 'del'){ s.close(); mdAskDelete([key]); }
    });
  }

  /* ---------- تشغيل نموذج مع قياس الأداء ---------- */
  async function run(it, prompt, opts, onChunk, signal){
    const am = { ep:it.ep, model:it.m.id }, t0 = performance.now();
    let first = 0, out = '', think = '';
    const chat = { params:{ ...(opts.temperature != null ? { temperature:opts.temperature } : {}), ...(opts.max_tokens ? { max_tokens:opts.max_tokens } : {}) } };
    for await (const ch of callModel([{ role:'user', content:prompt }], signal, chat, am)){
      if (!first) first = performance.now() - t0;
      if (typeof ch === 'object' && ch.think){ think += ch.think; } else out += ch;
      onChunk && onChunk(out, think);
    }
    const ms = performance.now() - t0, gen = Math.max(ms - first, 1);
    return { ok:true, ms:Math.round(ms), ttft:Math.round(first), out, think, tps:Math.round(estTok(out + think) / (gen / 1000)) };
  }

  /* ---------- ساحة التجربة ---------- */
  const PRESETS = [['اشرح', 'اشرح لي مفهوم الذكاء الاصطناعي في ثلاث جمل بسيطة.'], ['ترجم', 'Translate to Arabic: "The best way to predict the future is to invent it."'],
    ['كود', 'اكتب دالة بلغة Python تتحقق إن كان نص ما palindrome.'], ['منطق', 'لدي 3 صناديق، أحدها فيه جائزة. اشرح خطوة بخطوة مسألة مونتي هول.'], ['إبداع', 'اكتب قصيدة قصيرة (4 أبيات) عن القمر.']];
  function play(it){
    const key = it.key, saved = store.get('ai_md_play', { p:PRESETS[0][1], t:0.7, m:0 });
    const s = sheet('ساحة التجربة', `
      <div class="md-dh sm"><span class="md-dot" style="${meta(key).color ? `background:${meta(key).color}` : ''}"></span><div><h2 dir="ltr">${esc(it.m.id)}</h2><p dir="ltr">${esc(hostOf(it.ep.url))}</p></div></div>
      <div class="md-presets">${PRESETS.map(p => `<button type="button" class="md-chip" data-pr="${esc(p[1])}">${p[0]}</button>`).join('')}</div>
      <label class="lib-f"><textarea id="plQ" placeholder="اكتب سؤالك لتجربة هذا النموذج…" style="min-height:92px"></textarea></label>
      <div class="md-ctrls"><label>الحرارة <em id="plTv"></em><input type="range" id="plT" min="0" max="2" step="0.1"></label>
        <label>أقصى طول <em id="plMv"></em><input type="range" id="plM" min="0" max="8192" step="256"></label></div>
      <div class="md-acts"><button class="lib-btn pri" id="plGo">${I('send')}تشغيل</button><button class="lib-btn" id="plCp" disabled>${I('copy')}نسخ</button></div>
      <div class="md-metrics" id="plMt" hidden></div>
      <div class="md-think" id="plTh" hidden></div>
      <div class="md-out" id="plOut" hidden></div>`, 'md-play');
    const q = x => s.ov.querySelector(x); let ctl = null;
    q('#plQ').value = saved.p; q('#plT').value = saved.t; q('#plM').value = saved.m;
    const lbl = () => { q('#plTv').textContent = (+q('#plT').value).toFixed(1); q('#plMv').textContent = +q('#plM').value ? q('#plM').value : 'تلقائي'; }; lbl();
    const stop = () => { ctl?.abort(); ctl = null; };
    s.onClose(stop);
    s.ov.addEventListener('input', e => { if (e.target.id === 'plT' || e.target.id === 'plM') lbl(); });
    s.ov.addEventListener('click', async e => {
      const pr = e.target.closest('[data-pr]'); if (pr){ q('#plQ').value = pr.dataset.pr; return; }
      if (e.target.closest('#plCp')){ toast(await copyText(q('#plOut').textContent) ? 'تم النسخ' : 'تعذّر النسخ'); return; }
      if (!e.target.closest('#plGo')) return;
      if (ctl){ stop(); return; }
      const prompt = q('#plQ').value.trim(); if (!prompt){ toast('اكتب سؤالًا أولًا'); return; }
      if (!it.ep.enabled){ toast('نقطة الاتصال معطّلة'); return; }
      store.set('ai_md_play', { p:prompt, t:+q('#plT').value, m:+q('#plM').value });
      const out = q('#plOut'), th = q('#plTh'), mt = q('#plMt'), go = q('#plGo');
      out.hidden = false; out.textContent = ''; th.hidden = true; mt.hidden = true; q('#plCp').disabled = true;
      go.innerHTML = I('square', 'fill') + 'إيقاف'; ctl = new AbortController(); const my = ctl;
      try{
        const r = await run(it, prompt, { temperature:+q('#plT').value, max_tokens:+q('#plM').value || 0 }, (o, t) => {
          out.textContent = o; if (t){ th.hidden = false; th.textContent = t; } out.scrollTop = out.scrollHeight;
        }, my.signal);
        mdTest[key] = { ok:true, ms:r.ms }; record(key, r); q('#plCp').disabled = false;
        mt.hidden = false; mt.innerHTML = `<div><b>${secs(r.ttft)}</b><small>أول رمز</small></div><div><b>${secs(r.ms)}</b><small>الإجمالي</small></div><div><b>≈${r.tps}</b><small>رمز/ثانية</small></div><div><b>≈${estTok(r.out)}</b><small>رمز</small></div>`;
        bumpUse({ ep:it.ep, model:it.m.id });
      }catch(err){
        if (err.name !== 'AbortError'){ out.textContent = '⚠ ' + niceErr(err); out.classList.add('bad'); mdTest[key] = { ok:false, err:niceErr(err) }; record(key, mdTest[key]); }
      }finally{ ctl = null; go.innerHTML = I('send') + 'تشغيل'; setTimeout(() => out.classList.remove('bad'), 50); }
    });
  }

  /* ---------- مقارنة أداء عدة نماذج ---------- */
  function bench(items){
    items = items.slice(0, 8);
    const s = sheet(`مقارنة أداء (${items.length})`, `
      <p class="vo-help" style="padding:0 0 10px">يُرسل السؤال نفسه إلى كل النماذج المحددة، ويقيس أول رمز والزمن الكلي والسرعة التقريبية.</p>
      <div class="md-presets">${PRESETS.map(p => `<button type="button" class="md-chip" data-pr="${esc(p[1])}">${p[0]}</button>`).join('')}</div>
      <label class="lib-f"><textarea id="bnQ" style="min-height:84px" placeholder="سؤال المقارنة…"></textarea></label>
      <div class="md-acts"><button class="lib-btn pri" id="bnGo">${I('send')}ابدأ المقارنة</button><button class="lib-btn" id="bnCp" disabled>${I('copy')}نسخ النتائج</button></div>
      <div class="md-bn" id="bnRes">${items.map(it => `<div class="md-bnr" data-k="${esc(it.key)}"><div class="h"><b dir="ltr">${esc(it.m.id)}</b><small dir="ltr">${esc(hostOf(it.ep.url))}</small><span class="st">بانتظار التشغيل</span></div><div class="m"></div><details><summary>عرض الرد</summary><div class="md-out"></div></details></div>`).join('')}</div>`, 'md-bench');
    const q = x => s.ov.querySelector(x); let ctl = null, results = [];
    q('#bnQ').value = store.get('ai_md_play', { p:PRESETS[0][1] }).p;
    s.onClose(() => ctl?.abort());
    const row = k => [...s.ov.querySelectorAll('.md-bnr')].find(r => r.dataset.k === k);
    s.ov.addEventListener('click', async e => {
      const pr = e.target.closest('[data-pr]'); if (pr){ q('#bnQ').value = pr.dataset.pr; return; }
      if (e.target.closest('#bnCp')){
        const t = results.map((r, i) => `${i + 1}. ${r.it.m.id} (${hostOf(r.it.ep.url)}) — ${r.ok ? `أول رمز ${secs(r.ttft)} · الكلي ${secs(r.ms)} · ≈${r.tps} tok/s` : 'فشل: ' + r.err}`).join('\n');
        toast(await copyText(t) ? 'تم نسخ النتائج' : 'تعذّر النسخ'); return;
      }
      if (!e.target.closest('#bnGo')) return;
      if (ctl){ ctl.abort(); return; }
      const prompt = q('#bnQ').value.trim(); if (!prompt){ toast('اكتب سؤالًا أولًا'); return; }
      ctl = new AbortController(); const my = ctl; results = [];
      const go = q('#bnGo'); go.innerHTML = I('square', 'fill') + 'إيقاف'; q('#bnCp').disabled = true;
      s.ov.querySelectorAll('.md-bnr').forEach(r => { r.className = 'md-bnr'; r.querySelector('.st').textContent = 'بانتظار التشغيل'; r.querySelector('.m').innerHTML = ''; r.querySelector('.md-out').textContent = ''; });
      const queue = items.slice();
      const worker = async () => {
        for (let it; (it = queue.shift()) && !my.signal.aborted;){
          const r = row(it.key); r.classList.add('run'); r.querySelector('.st').innerHTML = '<i class="md-spin"></i>يعمل…';
          try{
            if (!it.ep.enabled) throw new Error('نقطة الاتصال معطّلة');
            const res = await run(it, prompt, { max_tokens:700 }, o => { r.querySelector('.md-out').textContent = o; }, my.signal);
            results.push({ it, ...res }); mdTest[it.key] = { ok:true, ms:res.ms }; record(it.key, res);
            r.classList.remove('run'); r.classList.add('done'); r.querySelector('.st').textContent = '✓ اكتمل';
          }catch(err){
            if (my.signal.aborted) break;
            results.push({ it, ok:false, err:niceErr(err) }); mdTest[it.key] = { ok:false, err:niceErr(err) }; record(it.key, mdTest[it.key]);
            r.classList.remove('run'); r.classList.add('fail'); r.querySelector('.st').textContent = '✕ فشل'; r.querySelector('.md-out').textContent = niceErr(err); r.querySelector('details').open = true;
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      ctl = null; go.innerHTML = I('send') + 'إعادة المقارنة';
      const okR = results.filter(r => r.ok); if (!okR.length) return;
      const fast = Math.min(...okR.map(r => r.ms)), top = Math.max(...okR.map(r => r.tps)), ft = Math.min(...okR.map(r => r.ttft));
      results.sort((a, b) => (b.ok - a.ok) || a.ms - b.ms);
      const box = q('#bnRes'); results.forEach(r => box.appendChild(row(r.it.key)));
      okR.forEach(r => {
        row(r.it.key).querySelector('.m').innerHTML =
          `<span class="${r.ttft === ft ? 'best' : ''}">أول رمز <b>${secs(r.ttft)}</b></span><span class="${r.ms === fast ? 'best' : ''}">الكلي <b>${secs(r.ms)}</b></span><span class="${r.tps === top ? 'best' : ''}">السرعة <b>≈${r.tps}</b> tok/s</span><span>الطول <b>≈${estTok(r.out)}</b></span>`;
      });
      q('#bnCp').disabled = false; mdRender(); toast('اكتملت المقارنة');
    });
  }

  /* ---------- النظرة العامة ---------- */
  const bars = (rows, cls = '') => rows.map(([l, n, mx, tip]) => `<div class="md-bar ${cls}"><span dir="auto">${esc(l)}</span><i><u style="width:${mx ? Math.max(3, n / mx * 100) : 0}%"></u></i><b>${tip != null ? tip : n}</b></div>`).join('');
  function overview(all){
    const st = { ok:0, bad:0, none:0 }; all.forEach(x => { const s = statusOf(x.key); st[s === 'busy' ? 'none' : s]++; });
    const fams = {}; all.forEach(x => { const f = famOf(x.m.id); fams[f] = (fams[f] || 0) + 1; });
    const famRows = Object.entries(fams).sort((a, b) => b[1] - a[1]).slice(0, 6), fmx = famRows[0] ? famRows[0][1] : 0;
    const top = all.filter(x => modelUse[x.key]?.n).sort((a, b) => modelUse[b.key].n - modelUse[a.key].n).slice(0, 5), tmx = top[0] ? modelUse[top[0].key].n : 0;
    const speed = all.filter(x => latOf(x.key) != null).sort((a, b) => latOf(a.key) - latOf(b.key)).slice(0, 5), smx = speed.length ? latOf(speed[speed.length - 1].key) : 0;
    const dupMap = {}; all.forEach(x => { (dupMap[x.m.id] = dupMap[x.m.id] || []).push(x); });
    const dups = Object.values(dupMap).filter(a => a.length > 1);
    const total = all.length || 1;
    return `<div class="md-ov">
      <div class="md-card"><h4>صحة الاتصال</h4>
        <div class="md-health"><u class="ok" style="flex:${st.ok}"></u><u class="bad" style="flex:${st.bad}"></u><u class="none" style="flex:${st.none}"></u></div>
        <div class="md-legend"><span><i class="ok"></i>سليم ${st.ok}</span><span><i class="bad"></i>فاشل ${st.bad}</span><span><i class="none"></i>لم يُختبر ${st.none}</span></div>
        <div class="md-acts"><button class="lib-btn" data-p="testOn"${all.length ? '' : ' disabled'}>${I('clock')}اختبار المفعّلة</button><button class="lib-btn" data-p="testNew"${st.none ? '' : ' disabled'}>اختبار غير المختبرة</button><button class="lib-btn" data-p="bad"${st.bad ? '' : ' disabled'}>عرض الفاشلة</button></div></div>
      <div class="md-card"><h4>الأسرع استجابةً</h4>${speed.length ? bars(speed.map(x => [shortModel(x.m.id), latOf(x.key), smx, secs(latOf(x.key))]), 'sp') : '<p class="vo-help">اختبر بعض النماذج لتظهر هنا.</p>'}</div>
      <div class="md-card"><h4>الأكثر استخدامًا</h4>${top.length ? bars(top.map(x => [(meta(x.key).alias || shortModel(x.m.id)), modelUse[x.key].n, tmx])) : '<p class="vo-help">لم تستخدم أي نموذج بعد.</p>'}</div>
      <div class="md-card"><h4>العائلات</h4>${famRows.length ? bars(famRows.map(([f, n]) => [f, n, fmx, n + ' · ' + Math.round(n / total * 100) + '%'])) : '<p class="vo-help">لا توجد نماذج.</p>'}</div>
      ${dups.length ? `<div class="md-card"><h4>نماذج مكررة عبر النقاط <small>${dups.length}</small></h4><div class="md-dups">${dups.slice(0, 6).map(a => `<div><b dir="ltr">${esc(a[0].m.id)}</b><small dir="ltr">${a.map(x => esc(hostOf(x.ep.url))).join(' · ')}</small></div>`).join('')}</div></div>` : ''}
      <div class="md-card"><h4>النسخ الاحتياطي</h4><p class="vo-help" style="padding:0 0 10px">يحفظ المفضلة والأسماء المستعارة والملاحظات والألوان وقوائم النماذج — دون مفاتيح API.</p>
        <div class="md-acts"><button class="lib-btn" data-p="export">${I('download')}تصدير</button><button class="lib-btn" data-p="import">${I('upload')}استيراد</button><button class="lib-btn" data-p="dedupe"${dups.length ? '' : ' disabled'}>تنظيف المكررات</button></div></div>
    </div>`;
  }

  /* ---------- تصدير / استيراد ---------- */
  function exportCfg(){
    const data = { app:'quark-ai-models', v:1, ts:Date.now(), fav:[...modelFav], meta:mdMeta,
      endpoints:settings.endpoints.map(e => ({ id:e.id, url:e.url, models:e.models.map(m => ({ id:m.id, on:m.on })) })) };
    saveFile(new Blob([JSON.stringify(data, null, 2)], { type:'application/json' }), 'quark-models-' + new Date().toISOString().slice(0, 10) + '.json');
    toast('تم تصدير النماذج');
  }
  function importCfg(){
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try{
        const d = JSON.parse(await f.text()); if (d.app !== 'quark-ai-models') throw new Error('x');
        let added = 0;
        (d.endpoints || []).forEach(se => {
          const ep = settings.endpoints.find(e => e.id === se.id) || settings.endpoints.find(e => e.url.replace(/\/+$/, '') === String(se.url).replace(/\/+$/, ''));
          if (!ep) return;
          (se.models || []).forEach(m => { if (m && m.id && !ep.models.some(x => x.id === m.id)){ ep.models.push({ id:String(m.id), on:m.on !== false }); added++; } });
        });
        (d.fav || []).forEach(k => modelFav.add(k)); Object.entries(d.meta || {}).forEach(([k, v]) => { if (!mdMeta[k]) mdMeta[k] = v; });
        saveFav(); saveMeta(); persistSettings(); mdRender(); toast(`تم الاستيراد — ${added} نموذج جديد`);
      }catch{ toast('ملف غير صالح'); }
    };
    inp.click();
  }
  function dedupe(){
    qConfirm('يُبقي نسخة واحدة من كل نموذج مكرر (الأولى حسب ترتيب النقاط) ويحذف البقية من قائمتك فقط.', { title:'تنظيف المكررات', ok:'تنظيف' }).then(ok => {
      if (!ok) return; const seen = new Set(), kill = [];
      mdItems().forEach(x => { seen.has(x.m.id) ? kill.push(x.key) : seen.add(x.m.id); });
      if (kill.length) mdRemove(kill); toast(`حُذف ${kill.length} مكرر`);
    });
  }

  /* ---------- أحداث النظرة العامة ---------- */
  document.addEventListener('click', e => {
    const b = e.target.closest('#stOv [data-p]'); if (!b) return;
    const p = b.dataset.p, all = mdItems();
    if (p === 'testOn'){ const l = all.filter(x => x.m.on && x.ep.enabled); if (l.length){ toast(`يختبر ${l.length} نموذجًا…`); mdTestMany(l); } }
    else if (p === 'testNew'){ const l = all.filter(x => x.ep.enabled && statusOf(x.key) === 'none'); if (l.length){ toast(`يختبر ${l.length} نموذجًا…`); mdTestMany(l); } }
    else if (p === 'bad'){ mdUi.tab = 'all'; mdUi.st = 'bad'; mdUi.ep = 'all'; saveMdUi(); openModels(); }
    else if (p === 'export') exportCfg();
    else if (p === 'import') importCfg();
    else if (p === 'dedupe') dedupe();
  });

  window.__mdPro = { meta, cardExtra, famOf, ctxOf, fmtCtx, statusOf, latOf, record, detail, play, bench, overview, FAMS, LABELS, secs };
})();
