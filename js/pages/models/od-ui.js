/* QUARK AI — صفحة النماذج ← تبويب «على الجهاز»: فحص الجهاز، اقتراحات مناسبة له، بحث Hugging Face، إدارة التنزيلات والتخزين */
'use strict';
(() => {
  const od = window.__od;
  if (!od || !od.store) return;
  const { device: DV, catalog: CT, fit: FT, store: ST, engine: EN } = od;
  const GB = 1024 ** 3;
  const $m = id => document.getElementById(id);
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = s => '<bdi dir="ltr">' + s + '</bdi>';
  const num = n => String(n).replace(/\d/g, d => d);                         /* أرقام لاتينية كما في بقية التطبيق */
  const S = { dev: null, items: [], group: 'best', results: null, searching: false, q: '', resolved: {}, open: false, engineOk: null, showNo: false };
  const EP_URL = 'ondevice://device';

  /* =============== نقطة الاتصال «على الجهاز» =============== */
  function epEnsure(){
    let ep = settings.endpoints.find(e => e.proto === 'ondevice');
    if (!ep){ ep = { id: epId(), preset: 'ondevice', url: EP_URL, key: '', proto: 'ondevice', kind: 'local', enabled: true, models: [] }; settings.endpoints.push(ep); }
    return ep;
  }
  function register(rec){
    const ep = epEnsure();
    const em = ep.models.find(m => m.id === rec.id);
    if (!em) ep.models.push({ id: rec.id, on: true, ctx: rec.ctx || undefined, ...(rec.vision ? { vision: true } : {}) });
    else if (rec.vision) em.vision = true;
    ep.enabled = true;
    if (!settings.sel || !activeModel()) settings.sel = { ep: ep.id, model: rec.id };
    persistSettings(); try{ updateModelLabels(); }catch{} try{ mdRender(); }catch{}
  }
  function unregister(id){
    const ep = settings.endpoints.find(e => e.proto === 'ondevice'); if (!ep) return;
    ep.models = ep.models.filter(m => m.id !== id);
    const key = ep.id + '|' + id;
    delete settings.params.models[key]; modelFav.delete(key); delete modelUse[key]; saveFav(); store.set('ai_model_use', modelUse);
    if (settings.sel && settings.sel.ep === ep.id && settings.sel.model === id){
      settings.sel = null;
      outer: for (const e of settings.endpoints){ if (!e.enabled) continue; const m = e.models.find(x => x.on); if (m){ settings.sel = { ep: e.id, model: m.id }; break outer; } }
    }
    if (cmpState.sel && cmpState.sel.ep === ep.id && cmpState.sel.model === id){ cmpState.sel = null; cmpState.on = false; saveCmp(); }
    persistSettings(); try{ updateModelLabels(); }catch{}
  }
  const isCurrent = id => { const am = activeModel(); return !!am && am.ep.proto === 'ondevice' && am.model === id; };

  /* =============== الجهاز والاقتراحات =============== */
  async function scan(force){
    if (force) EN.resetDevice();
    S.dev = await DV.detect();
    od.__freeGB = S.dev.freeGB;
    buildItems();
    return S.dev;
  }
  /* أكبر حجم ملف يتسع في ميزانية الذاكرة (لاختيار صيغة التكميم) */
  const budgetBytes = params => S.dev ? Math.max(0, (S.dev.usableGB * GB - FT.kvBytes(params, 2048) - 0.35 * GB) / 1.06) : 0;
  function buildItems(){
    if (!S.dev) return;
    /* نماذج الرؤية المتخصصة لا تعمل بمحرك WASM — تُخفى حين لا يتوفر المحرك الأصلي */
    S.items = CT.SEED.filter(s => S.dev.native || !(s.tags.includes('vision') && !s.tags.includes('chat'))).map(s => {
      const vars = S.resolved[s.repo], v = vars ? CT.pickVariant(vars, budgetBytes(s.params)) : null;
      const vis = !!(s.vision && S.dev.native), extra = vis ? (v && v.msize ? v.msize : 0.7 * GB) : 0;
      const it = { ...s, sizeBytes: v ? v.size : CT.approxBytes(s.params), approx: !v, quant: v ? v.quant : 'Q4_K_M', variant: v, extraBytes: extra, vis };
      it.fit = FT.fit(it, S.dev);
      return it;
    });
  }
  /* يقرأ الأحجام الحقيقية لأفضل المرشحين في الخلفية */
  async function refine(){
    if (!S.dev) return;
    const top = [...S.items].filter(i => i.fit.level !== 'no' && !S.resolved[i.repo]).sort((a, b) => b.fit.score - a.fit.score).slice(0, 6);
    const cfg = DV.cfgGet(); let any = false;
    await Promise.all(top.map(async it => { try{ S.resolved[it.repo] = await CT.resolveRepo(it.repo, cfg); any = true; }catch{ S.resolved[it.repo] = null; } }));
    if (any){ buildItems(); if (S.open) render(); }
  }
  const listFor = g => {
    const ok = S.items.filter(i => i.fit.level !== 'no'), by = (a, f) => [...a].sort((x, y) => f(y) - f(x));
    if (g === 'fast') return by(ok, i => i.fit.tps - i.params * 0.001);
    if (g === 'smart') return by(ok.filter(i => i.fit.rank >= 2), i => i.params);
    if (g === 'ar') return by(ok.filter(i => i.ar >= 2), i => i.fit.score);
    if (g === 'code') return by(ok.filter(i => i.tags.includes('code')), i => i.fit.score);
    if (g === 'all') return [...by(ok, i => i.fit.score), ...S.items.filter(i => i.fit.level === 'no')];
    return by(ok, i => i.fit.score);
  };
  const best = () => FT.pickGroups(S.items).best;

  /* =============== حالة النموذج (من السجل) =============== */
  const recsOf = repo => ST.list().filter(r => r.repo.toLowerCase() === repo.toLowerCase());
  const recFor = repo => { const l = recsOf(repo); return l.find(r => r.state === 'ready') || l[0] || null; };

  /* =============== التنسيق =============== */
  const bytes = FT.fmtBytes;
  const dur = s => !isFinite(s) || s < 0 ? '—' : s < 60 ? Math.ceil(s) + ' ث' : s < 3600 ? Math.round(s / 60) + ' د' : (s / 3600).toFixed(1) + ' س';
  const speed = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB/s' : Math.round(b / 1024) + ' KB/s';
  const kfmt = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
  const pct = r => r.size ? Math.min(100, Math.floor(100 * (r.bytes || 0) / r.size)) : 0;
  const ICO = n => ic(n);
  const arLabel = a => a >= 2 ? 'عربي جيد' : a === 1 ? 'عربي مقبول' : 'ضعيف بالعربية';

  /* =============== الواجهة =============== */
  const root = () => $m('mdDl');
  function devCard(){
    const d = S.dev; if (!d) return '<div class="od-card od-skel">جارٍ فحص جهازك…</div>';
    const b = best(), name = d.model || (d.mobile ? 'هاتفك' : 'هذا الجهاز');
    const ramTxt = (d.ramGuess ? '≈' : '') + DV.fmtGB(d.ram, d.ram % 1 ? 1 : 0), ramLbl = d.ramManual ? 'الذاكرة (يدوي)' : d.ramGuess ? 'الذاكرة (تقدير)' : 'الذاكرة';
    const chip = (i, l, v, x) => `<div class="od-chip"><span class="i">${ICO(i)}</span><div><small>${l}</small><b>${v}</b></div>${x || ''}</div>`;
    const free = d.freeGB != null ? DV.fmtGB(d.freeGB) : '—';
    return `<div class="od-card od-dev">
      <div class="od-dev-top"><div><b class="od-dev-name" dir="auto">${E(name)}</b><small>${E(DV.TIERS[d.tier])}${d.android ? ' · Android ' + num(d.android) : ''}${d.soc ? ' · ' + E(d.soc) : ''}</small></div>
        <button type="button" class="lib-ib" data-od="rescan" aria-label="إعادة الفحص" title="إعادة الفحص">${ICO('refresh')}</button></div>
      <div class="od-chips">
        ${chip('cpu', ramLbl, ramTxt, `<button type="button" class="od-mini" data-od="ram">تعديل</button>`)}
        ${chip('layers', 'المعالج', num(d.cores) + ' أنوية')}
        ${chip('database', 'المساحة الحرة', free)}
        ${chip('sparkles', 'المحرك', d.native ? 'أصلي (llama.cpp)' : d.threads ? 'WASM متعدد الخيوط' : 'WASM خيط واحد')}
      </div>
      <p class="od-sum">${b ? `يناسب جهازك نماذج حتى <b>≈${b.params >= 1 ? b.params.toFixed(1).replace(/\.0$/, '') : b.params} مليار</b> معامل بسرعة تقديرية <b>≈${FT.fmtTps(b.fit.tps)} رمز/ث</b>.` : 'ذاكرة جهازك محدودة جدًا لتشغيل النماذج المحلية، جرّب تغيير الذاكرة يدويًا إن كان التقدير خاطئًا.'}
        ${d.bwMeasured ? ' <span class="od-ok">التقديرات مُعايَرة بسرعة جهازك الفعلية.</span>' : ' <span class="od-dim">التقديرات تتحسن بعد أول تشغيل فعلي.</span>'}
        ${d.ramGuess ? ' <span class="od-dim">لم نستطع قراءة الذاكرة بدقة، عدّلها لنتائج أدق.</span>' : ''}</p>
    </div>`;
  }
  function fitBadge(f){ return `<span class="od-fit ${f.cls}" title="${E(f.why.join(' · '))}">${E(f.label)}</span>`; }
  function actionsFor(it, r){
    if (r && r.state === 'ready') return `<span class="od-done">${ICO('check')} منزَّل</span><button type="button" class="lib-btn pri" data-od="use" data-id="${E(r.id)}">${isCurrent(r.id) ? 'قيد الاستخدام' : 'استخدام'}</button>`;
    if (r && r.state === 'downloading') return `<button type="button" class="lib-btn" data-od="pause" data-id="${E(r.id)}">${ICO('pause')} إيقاف مؤقت</button>`;
    if (r && r.state === 'queued') return `<button type="button" class="lib-btn" data-od="pause" data-id="${E(r.id)}">في الانتظار… (إلغاء)</button>`;
    if (r && (r.state === 'paused' || r.state === 'error')) return `<button type="button" class="lib-btn pri" data-od="resume" data-id="${E(r.id)}">${ICO('play')} متابعة</button>`;
    return `<button type="button" class="lib-btn pri" data-od="get" data-s="${E(it.id)}">${ICO('download')} تنزيل</button>`;
  }
  const progHtml = r => {
    if (!r || r.state === 'ready') return '';
    const p = pct(r), left = r.bps > 0 ? (r.size - (r.bytes || 0)) / r.bps : NaN;
    const msg = r.state === 'error' ? `<span class="od-err">${E(r.err)}</span>` : r.state === 'paused' ? `<span>${E(r.err || 'متوقف مؤقتًا')}</span>` : r.state === 'queued' ? '<span>في قائمة الانتظار</span>'
      : r.retry ? `<span class="od-warn">انقطع الاتصال، إعادة المحاولة (${num(r.retry)})…</span>` : `<span>${r.bps > 0 ? speed(r.bps) + ' · متبقي ' + dur(left) : 'جارٍ البدء…'}</span>`;
    return `<div class="od-pg" data-pg="${E(r.id)}"><div class="od-bar"><i style="width:${p}%"></i></div><div class="od-pgt"><b>${p}%</b><span class="m">${msg}</span><small>${bytes(r.bytes || 0)} / ${bytes(r.size)}</small></div></div>`;
  };
  function card(it, i){
    const r = recFor(it.repo), tags = [];
    if (S.group === 'best' && i === 0 && it.fit.level !== 'no') tags.push('<span class="od-tag acc">الأنسب لك</span>');
    tags.push(`<span class="od-tag">${arLabel(it.ar)}</span>`);
    if (it.tags.includes('think')) tags.push('<span class="od-tag">تفكير</span>');
    if (it.tags.includes('code')) tags.push('<span class="od-tag">برمجة</span>');
    if (it.vis) tags.push('<span class="od-tag acc">يفهم الصور</span>');
    return `<article class="od-card od-m${it.fit.level === 'no' ? ' no' : ''}" data-s="${E(it.id)}">
      <div class="od-row"><h4 dir="ltr">${E(it.name)}</h4>${fitBadge(it.fit)}</div>
      <p class="od-note">${E(it.note)}</p>
      <div class="od-meta"><span>${it.params >= 1 ? it.params.toFixed(1).replace(/\.0$/, '') : it.params}B</span><span>${L((it.approx ? '≈' : '') + bytes(it.sizeBytes))}${it.vis ? ' <small>' + L('+' + bytes(it.extraBytes)) + ' للصور</small>' : ''}</span><span dir="ltr">${E(it.quant)}</span>
        <span>${it.fit.level === 'no' ? 'لا يعمل' : L('≈' + FT.fmtTps(it.fit.tps)) + ' رمز/ث'}</span><span>ذاكرة ${L('≈' + bytes(it.fit.needBytes))}</span></div>
      <div class="od-tags">${tags.join('')}</div>
      ${progHtml(r)}
      <div class="od-act">${actionsFor(it, r)}<button type="button" class="lib-btn" data-od="info" data-s="${E(it.id)}">${ICO('info')} التفاصيل</button></div>
    </article>`;
  }
  const GROUPS = [['best', 'الأنسب'], ['fast', 'الأسرع'], ['smart', 'الأذكى'], ['ar', 'عربي'], ['code', 'برمجة'], ['all', 'الكل']];
  function recSection(){
    if (!S.dev) return '';
    const l = listFor(S.group), yes = l.filter(i => i.fit.level !== 'no'), no = l.filter(i => i.fit.level === 'no');
    const cards = yes.slice(0, S.group === 'all' ? 99 : 8).map(card).join('') || '<div class="od-empty">لا نماذج مطابقة في هذه الفئة لجهازك.</div>';
    const noN = S.group === 'all' ? no : [];
    return `<section class="od-sec"><h3>مقترحة لجهازك</h3>
      <div class="od-gr" role="tablist">${GROUPS.map(([k, l2]) => `<button type="button" class="md-chip${S.group === k ? ' on' : ''}" data-od="grp" data-g="${k}">${l2}</button>`).join('')}</div>
      <div class="od-list">${cards}${noN.length ? `<div class="od-no-h">لا تناسب جهازك (${noN.length})</div>` + noN.map(card).join('') : ''}</div></section>`;
  }
  function searchSection(){
    const res = S.results;
    let body = '';
    if (S.searching) body = '<div class="od-empty"><i class="md-spin"></i> جارٍ البحث…</div>';
    else if (res && res.err) body = `<div class="od-empty od-err">${E(res.err)}</div>`;
    else if (res) body = res.list.length ? res.list.map(m => `<button type="button" class="od-res" data-od="open" data-repo="${E(m.repo)}"><span class="n" dir="ltr">${E(m.repo)}</span><span class="d">${m.params ? m.params + 'B · ' : ''}${ICO('download')} ${kfmt(m.downloads)}${m.gated ? ' · يتطلب موافقة' : ''}</span></button>`).join('') : '<div class="od-empty">لا نتائج.</div>';
    else body = '<div class="od-hint">ابحث بالاسم (qwen، gemma، llama…) أو الصق معرّف المستودع <span dir="ltr">owner/repo</span> أو رابط ملف GGUF من Hugging Face.</div>';
    return `<section class="od-sec"><h3>بحث في Hugging Face</h3>
      <form class="od-search" data-od-form="search"><input type="text" id="odQ" value="${E(S.q)}" placeholder="اسم نموذج أو رابط أو owner/repo" dir="ltr" autocomplete="off" spellcheck="false" enterkeyhint="search"><button type="submit" class="lib-btn pri">${ICO('search')} بحث</button></form>
      <div class="od-results">${body}</div></section>`;
  }
  function recRow(r){
    const cur = isCurrent(r.id), bench = DV.benchGet().models[r.id];
    const meta = `${E(r.quant)} · ${bytes(r.size)}${r.vision ? ' · يدعم الصور' : ''}${bench ? ' · سرعة فعلية ≈' + FT.fmtTps(bench.tps) + ' رمز/ث' : ''}`;
    const st = r.state === 'ready' ? '' : progHtml(r) + (r.storage === 'native' && (r.state === 'downloading' || r.state === 'queued') ? '<small class="od-dim">يستمر التنزيل في الخلفية بإشعار — يمكنك إغلاق التطبيق.</small>' : '');
    const btns = r.state === 'ready' ? `<button type="button" class="lib-btn${cur ? '' : ' pri'}" data-od="use" data-id="${E(r.id)}">${cur ? 'قيد الاستخدام' : 'استخدام'}</button><button type="button" class="lib-btn" data-od="test" data-id="${E(r.id)}">${ICO('clock')} اختبار</button>`
      : r.state === 'downloading' || r.state === 'queued' ? `<button type="button" class="lib-btn" data-od="pause" data-id="${E(r.id)}">${ICO('pause')} إيقاف</button>` : `<button type="button" class="lib-btn pri" data-od="resume" data-id="${E(r.id)}">${ICO('play')} متابعة</button>`;
    return `<div class="od-rec" data-id="${E(r.id)}"><div class="od-row"><div><b dir="ltr">${E(r.name)}</b><small dir="auto">${meta}</small></div>${cur ? '<span class="od-fit ok">الحالي</span>' : r.state === 'ready' ? '<span class="od-fit ok">جاهز</span>' : ''}</div>${st}<div class="od-act">${btns}<button type="button" class="lib-btn dng" data-od="del" data-id="${E(r.id)}">${ICO('trash')} حذف</button></div></div>`;
  }
  function libSection(){
    const l = ST.list(), used = ST.totalBytes(), free = S.dev && S.dev.freeGB != null ? S.dev.freeGB * GB : 0;
    return `<section class="od-sec"><h3>نماذجك على الجهاز <small>${l.length ? l.length : ''}</small></h3>
      ${l.length ? `<div class="od-stor"><span>المساحة المستخدمة</span><b>${bytes(used)}</b>${free ? `<span>· المتاح ${bytes(free)}</span>` : ''}</div><div class="od-list">${l.map(recRow).join('')}</div>`
        : '<div class="od-empty">لم تنزّل أي نموذج بعد. اختر من الاقتراحات أعلاه — تعمل النماذج المنزَّلة بلا إنترنت وبخصوصية كاملة.</div>'}</section>`;
  }
  function settingsSection(){
    const c = DV.cfgGet(), baseSel = c.base === 'https://huggingface.co' ? 'hf' : c.base === 'https://hf-mirror.com' ? 'mirror' : 'custom';
    const sw = (k, t, d, on) => `<button type="button" class="opt-row" role="switch" aria-checked="${on}" data-od="sw" data-k="${k}"><span>${t}<small>${d}</small></span><i class="tg"></i></button>`;
    const nat = od.native && od.native.available(), ni = od.native && od.native.readInfo ? od.native.readInfo() : null;
    const eng = nat ? '<span class="od-ok">المحرك الأصلي (llama.cpp) يعمل ✓ — أسرع بعدة أضعاف من WASM</span>' + (ni && ni.sys ? `<small class="od-dim" dir="ltr">${E(String(ni.sys).slice(0, 140))}</small>` : '')
      : ni && ni.error && ni.error !== 'no-bridge' ? `<span class="od-warn">تعذّر تحميل المحرك الأصلي (${E(String(ni.error).slice(0, 100))}) — يُستخدم المحرك البديل WASM.</span>` + (S.engineOk == null ? ' <button type="button" class="od-mini" data-od="engine">فحص WASM</button>' : '')
      : S.engineOk == null ? '<button type="button" class="od-mini" data-od="engine">فحص المحرك</button>' : S.engineOk ? '<span class="od-ok">المحرك متاح ✓</span>' : '<span class="od-err">المحرك غير متاح — ابنِ التطبيق بعد npm install أو اتصل بالإنترنت لمرة واحدة</span>';
    return `<details class="od-sec od-set"${S.setOpen ? ' open' : ''}><summary><h3>إعدادات التنزيل والتشغيل</h3></summary>
      <label class="lib-f">مصدر التنزيل<select class="fld" data-od-f="base"><option value="hf"${baseSel === 'hf' ? ' selected' : ''}>Hugging Face (الأصلي)</option><option value="mirror"${baseSel === 'mirror' ? ' selected' : ''}>hf-mirror.com (مرآة)</option><option value="custom"${baseSel === 'custom' ? ' selected' : ''}>عنوان مخصص…</option></select></label>
      ${baseSel === 'custom' ? `<label class="lib-f">العنوان<input class="fld" dir="ltr" data-od-f="custom" value="${E(c.base)}" placeholder="https://mirror.example.com"></label>` : ''}
      <label class="lib-f">رمز Hugging Face (اختياري، للنماذج المقيَّدة)<input class="fld" type="password" dir="ltr" data-od-f="token" value="${E(c.token)}" placeholder="hf_…" autocomplete="off"></label>
      ${sw('wifiOnly', 'التنزيل عبر الواي فاي فقط', 'يسألك قبل استهلاك بيانات الجوال', c.wifiOnly)}
      ${sw('think', 'تفعيل التفكير في نماذج Qwen3', 'ردود أذكى لكنها أبطأ بكثير على الهاتف', c.think)}
      ${sw('autoTitle', 'عنوان المحادثة بالنموذج المحلي', 'يوفر البطارية عند إيقافه: يؤخذ العنوان من أول كلمات سؤالك', c.autoTitle)}
      <label class="lib-f">حجم السياق<select class="fld" data-od-f="ctx">${[[0, 'تلقائي (حسب الذاكرة)'], [1024, '1024'], [2048, '2048'], [4096, '4096'], [8192, '8192 (يحتاج ذاكرة كبيرة)']].map(([v, t]) => `<option value="${v}"${c.ctx === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="lib-f">تفريغ النموذج من الذاكرة عند عدم الاستخدام<select class="fld" data-od-f="idleMin">${[[0, 'أبدًا'], [3, 'بعد 3 دقائق'], [10, 'بعد 10 دقائق'], [30, 'بعد 30 دقيقة']].map(([v, t]) => `<option value="${v}"${c.idleMin === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      ${nat ? `<label class="lib-f">عدد الخيوط<select class="fld" data-od-f="threads">${[[0, 'تلقائي (الأنوية السريعة)'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']].map(([v, t]) => `<option value="${v}"${c.threads === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}
      <div class="od-eng">${eng}</div>
      <p class="od-dim">${nat ? 'يعمل النموذج مباشرة على معالج الهاتف عبر llama.cpp الأصلي. السرعة تتوقف على الجهاز وحجم النموذج؛ أجهزة 8GB فأكثر تشغّل نماذج حتى ≈ 4–8 مليار معامل بسرعة معقولة. إن سخن الهاتف قلّل عدد الخيوط.' : 'يعمل المحرك داخل التطبيق عبر llama.cpp (WebAssembly) على المعالج، فهو أبطأ من المحرك الأصلي: الأفضل نماذج حتى ≈ 1.5–3 مليار معامل. المحرك الأصلي الأسرع يتوفر في تطبيق أندرويد المبني بالنسخة الأحدث.'}</p>
    </details>`;
  }
  function render(){
    const r = root(); if (!r) return;
    const keep = r.querySelector('#odQ') === document.activeElement, st = r.scrollTop;
    const had = keep ? { s: r.querySelector('#odQ').selectionStart } : null;
    r.innerHTML = `<div class="od-wrap">${devCard()}${recSection()}${libSection()}${searchSection()}${settingsSection()}</div>`;
    if (keep){ const q = r.querySelector('#odQ'); q.focus(); try{ q.setSelectionRange(had.s, had.s); }catch{} }
    r.scrollTop = st;
  }
  /* تحديث شريط التقدم فقط (بلا إعادة بناء) */
  function paint(id){
    const r = ST.get(id), root_ = root(); if (!r || !root_) return;
    root_.querySelectorAll(`[data-pg="${CSS.escape(id)}"]`).forEach(n => {
      const p = pct(r), left = r.bps > 0 ? (r.size - (r.bytes || 0)) / r.bps : NaN;
      n.querySelector('.od-bar i').style.width = p + '%'; n.querySelector('b').textContent = p + '%';
      n.querySelector('.m').innerHTML = r.retry ? `<span class="od-warn">انقطع الاتصال، إعادة المحاولة (${num(r.retry)})…</span>` : (r.bps > 0 ? speed(r.bps) + ' · متبقي ' + dur(left) : 'جارٍ البدء…');
      n.querySelector('small').textContent = bytes(r.bytes || 0) + ' / ' + bytes(r.size);
    });
  }

  /* =============== ورقة التفاصيل والتنزيل =============== */
  function layer(html){
    const ov = document.createElement('div'); ov.className = 'sheet-ov q-sheet show od-ov'; ov.innerHTML = html;
    const close = () => { document.removeEventListener('keydown', key, true); ov.remove(); };
    const key = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) close(); });
    document.body.appendChild(ov); return { ov, close };
  }
  const sheetHtml = (title, body) => `<div class="sheet od-sheet" role="dialog" aria-label="${E(title)}"><div class="sheet-handle"></div><div class="sheet-head"><button type="button" class="sheet-x" data-x aria-label="إغلاق">${ic('x')}</button><h3 dir="auto">${E(title)}</h3><span></span></div><div class="sheet-body">${body}</div></div>`;

  /* spec: { repo, name, params, ar, tags, ctx, pick? } */
  async function openModel(spec){
    const { ov, close } = layer(sheetHtml(spec.name, '<div class="od-empty"><i class="md-spin"></i> جارٍ قراءة ملفات المستودع…</div>'));
    const body = ov.querySelector('.sheet-body');
    let vars;
    try{ vars = S.resolved[spec.repo] || (S.resolved[spec.repo] = await CT.resolveRepo(spec.repo, DV.cfgGet())); }
    catch(e){ S.resolved[spec.repo] = undefined; body.innerHTML = `<div class="od-empty od-err">${E(e.message || e)}</div>`; return; }
    if (!S.dev) await scan();
    const mk = v => {
      const params = spec.params || +(v.size * 8 / ((CT.BITS[v.quant] || 4.85) * 1e9)).toFixed(2);
      const it = { sizeBytes: v.size, params, ar: spec.ar || 0, tags: spec.tags || [] };
      return { v, it, f: FT.fit(it, S.dev) };
    };
    const rows = vars.map(mk).sort((a, b) => {
      const qa = CT.QUANT_PREF.indexOf(a.v.quant), qb = CT.QUANT_PREF.indexOf(b.v.quant);
      return (qa < 0 ? 99 : qa) - (qb < 0 ? 99 : qb) || a.v.size - b.v.size;
    });
    const canVis = !!(S.dev.native && rows.some(x => x.v.mmproj)); let withVision = canVis && (spec.vision || rows.some(x => x.v.mmproj && x.v.msize && x.v.msize < 2 * GB));
    const refit = x => { x.f = FT.fit({ ...x.it, extraBytes: withVision && x.v.mmproj ? x.v.msize : 0 }, S.dev); return x; };
    let sel = rows.find(x => spec.pick && x.v.files.some(f => f.path === spec.pick)) || (() => { const p = CT.pickVariant(vars, budgetBytes(rows[0].it.params), null); return rows.find(x => x.v === p) || rows[0]; })();
    const total = () => sel.v.size + (withVision && sel.v.mmproj ? sel.v.msize : 0);
    const draw = () => {
      rows.forEach(refit);
      const done = rows.map(x => ST.get(CT.modelId(spec.repo, x.v.quant))).find(r => r && r.state === 'ready');
      body.innerHTML = `
        ${spec.note ? `<p class="od-note">${E(spec.note)}</p>` : ''}
        <div class="od-fitbox ${sel.f.cls}"><div class="od-row"><b>${E(sel.f.label)}</b><span dir="ltr">${E(sel.v.quant)} · ${bytes(sel.v.size)}</span></div>
          <div class="od-meta"><span>سرعة ${L('≈' + FT.fmtTps(sel.f.tps))} رمز/ث</span><span>ذاكرة ${L('≈' + bytes(sel.f.needBytes))}</span><span>سياق ${num(sel.f.ctx)}</span>${sel.v.files.length > 1 ? `<span>${num(sel.v.files.length)} أجزاء</span>` : ''}</div>
          ${sel.f.why.length ? `<ul class="od-why">${sel.f.why.map(w => `<li>${E(w)}</li>`).join('')}</ul>` : ''}</div>
        ${sel.v.mmproj && canVis ? `<button type="button" class="opt-row" role="switch" aria-checked="${withVision}" data-vis><span>تنزيل ملف الرؤية لفهم الصور<small>${L('+' + bytes(sel.v.msize))} · يتيح إرفاق صور في المحادثة</small></span><i class="tg"></i></button>` : sel.v.mmproj && !S.dev.native ? '<p class="od-dim">هذا النموذج يدعم الصور، لكن تحليلها يحتاج المحرك الأصلي (تطبيق أندرويد المبني بالنسخة الأحدث).</p>' : ''}
        <div class="od-vh">اختر الصيغة (التكميم): الأقل رقمًا أصغر وأسرع وأقل دقة</div>
        <div class="od-vars">${rows.map((x, i) => `<button type="button" class="od-var${x === sel ? ' on' : ''}" data-i="${i}"><span class="q" dir="ltr">${E(x.v.quant)}</span><span class="s">${bytes(x.v.size)}</span><span class="od-fit ${x.f.cls}">${E(x.f.label)}</span></button>`).join('')}</div>
        <div class="od-act">${done ? `<span class="od-done">${ic('check')} منزَّل (${E(done.quant)})</span>` : `<button type="button" class="lib-btn pri" data-go>${ic('download')} تنزيل ${L(bytes(total()))}</button>`}</div>`;
    };
    draw();
    body.addEventListener('click', async e => {
      const vb = e.target.closest('.od-var'); if (vb){ sel = rows[+vb.dataset.i]; draw(); return; }
      if (e.target.closest('[data-vis]')){ withVision = !withVision; draw(); return; }
      if (!e.target.closest('[data-go]')) return;
      const ok = await startDownload({ ...spec, v: sel.v, fit: sel.f, withVision: withVision && !!sel.v.mmproj });
      if (ok) close();
    });
  }
  async function startDownload(x){
    const v = x.v, c = DV.cfgGet();
    if (x.fit && x.fit.level === 'no' && !await qConfirm('هذا النموذج لا يناسب جهازك وقد يتعطل التطبيق عند تشغيله. هل تريد تنزيله رغم ذلك؟', { ok: 'تنزيل رغم ذلك' })) return false;
    const cell = (od.__net ? od.__net() : navigator.connection || {}).type === 'cellular', tot = v.size + (x.withVision && v.mmproj ? v.msize : 0);
    if (cell && c.wifiOnly && !await qConfirm('أنت متصل ببيانات الجوال وحجم التنزيل ' + bytes(tot) + '. المتابعة؟', { ok: 'متابعة', danger: false })) return false;
    try{
      await ST.enqueue({ id: CT.modelId(x.repo, v.quant), repo: x.repo, quant: v.quant, name: (x.name || x.repo.split('/')[1]) + ' · ' + v.quant, fam: CT.familyOf(x.repo), params: x.params || 0, ar: x.ar || 0, tags: x.tags || [], ctx: x.ctx ? Math.min(x.ctx, 32768) : 0,
        files: [...v.files.map(f => ({ path: f.path, size: f.size })), ...(x.withVision && v.mmproj ? [{ path: v.mmproj.path, size: v.mmproj.size, role: 'mmproj' }] : [])] }, { force: cell && c.wifiOnly });
      toast('بدأ التنزيل'); render(); return true;
    }catch(e){ toast(e.message || 'تعذّر بدء التنزيل'); return false; }
  }

  /* =============== الأحداث =============== */
  const seedBy = id => S.items.find(i => i.id === id);
  async function onAction(btn){
    const a = btn.dataset.od, id = btn.dataset.id;
    if (a === 'grp'){ S.group = btn.dataset.g; render(); }
    else if (a === 'rescan'){ btn.disabled = true; await scan(true); render(); toast('تم فحص الجهاز'); }
    else if (a === 'ram'){ ramDialog(); }
    else if (a === 'get' || a === 'info'){ const it = seedBy(btn.dataset.s); if (it) openModel({ repo: it.repo, name: it.name, params: it.params, ar: it.ar, tags: it.tags, ctx: it.ctx, note: it.note, vision: !!it.vision }); }
    else if (a === 'open'){ openModel({ repo: btn.dataset.repo, name: btn.dataset.repo.split('/')[1].replace(/-GGUF$/i, ''), params: CT.paramsFromName(btn.dataset.repo), ar: CT.seedFor(btn.dataset.repo)?.ar || 0, tags: CT.seedFor(btn.dataset.repo)?.tags || [] }); }
    else if (a === 'pause') ST.pause(id);
    else if (a === 'resume'){ const r = ST.get(id); ST.resume(id, { force: r && r.errCode === 'wifi' }); }
    else if (a === 'use'){ const ep = epEnsure(); register(ST.get(id)); settings.sel = { ep: ep.id, model: id }; persistSettings(); try{ updateModelLabels(); }catch{} toast('تم اختيار النموذج المحلي'); render(); }
    else if (a === 'del'){
      const r = ST.get(id); if (!r) return;
      if (!await qConfirm('حذف «' + r.name + '» من الجهاز؟ ' + (r.state === 'ready' ? 'يمكنك تنزيله مجددًا لاحقًا.' : 'يُحذف ما نُزّل منه.'), { ok: 'حذف' })) return;
      await ST.remove(id); unregister(id); render(); toast('تم الحذف وتحرير ' + bytes(r.size));
    }
    else if (a === 'test'){
      const r = ST.get(id); btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = '<i class="md-spin"></i> يختبر…';
      try{
        const t = await EN.selfTest(id);
        toast(t.ok ? `يعمل ✓ — ${t.tps ? '≈' + FT.fmtTps(t.tps) + ' رمز/ث' : 'تم'} (التحميل ${dur(t.ms / 1000)})` : 'لم يُنتج النموذج ردًا');
        await scan();
      }catch(e){ toast('فشل الاختبار: ' + (e.message || e)); }
      render();
    }
    else if (a === 'sw'){ const k = btn.dataset.k, c = DV.cfgGet(); DV.cfgSet({ [k]: !c[k] }); S.setOpen = true; render(); }
    else if (a === 'engine'){ btn.disabled = true; S.engineOk = await EN.available(); S.setOpen = true; render(); }
  }
  function ramDialog(){
    const c = DV.cfgGet();
    const { ov, close } = layer(`<div class="lib-dlg q-dlg" role="dialog"><h2>ذاكرة الجهاز (RAM)</h2>
      <p class="q-msg">إن كان التقدير غير دقيق، اكتب ذاكرة هاتفك بالجيجابايت (مثل 6 أو 8). اتركها 0 للكشف التلقائي.</p>
      <input class="fld" id="odRamIn" type="number" inputmode="decimal" min="0" max="64" step="0.5" value="${c.ramGB || 0}" dir="ltr">
      <div class="lib-acts"><button type="button" class="lib-btn" data-x>إلغاء</button><button type="button" class="lib-btn pri" id="odRamOk">حفظ</button></div></div>`);
    ov.className = 'lib-ov q-confirm show od-ov';
    ov.querySelector('#odRamOk').addEventListener('click', async () => {
      DV.cfgSet({ ramGB: Math.max(0, Math.min(64, parseFloat(ov.querySelector('#odRamIn').value) || 0)) });
      close(); await scan(true); render(); toast('تم تحديث التقييم');
    });
  }
  async function doSearch(q){
    q = q.trim(); S.q = q; if (!q) return;
    const cfg = DV.cfgGet(), direct = CT.parseUrl(q), repo = CT.cleanRepo(q);
    if (direct){ openModel({ repo: direct.repo, name: direct.repo.split('/')[1].replace(/-GGUF$/i, ''), params: CT.paramsFromName(direct.repo), ar: 0, tags: [], pick: direct.path }); return; }
    if (/^https?:\/\//i.test(q) || (q.includes('/') && CT.validRepo(repo))){ if (CT.validRepo(repo)){ openModel({ repo, name: repo.split('/')[1].replace(/-GGUF$/i, ''), params: CT.paramsFromName(repo), ar: 0, tags: [] }); return; } }
    S.searching = true; S.results = null; render();
    try{ S.results = { list: await CT.search(q, cfg) }; }
    catch(e){ S.results = { err: (e.message === 'Failed to fetch' ? 'تعذّر الاتصال بـ Hugging Face — تحقق من الإنترنت أو جرّب المرآة من الإعدادات.' : e.message) }; }
    S.searching = false; render();
  }
  function bind(){
    const r = root(); if (!r || r.dataset.bound) return; r.dataset.bound = '1';
    r.addEventListener('click', e => { const b = e.target.closest('[data-od]'); if (b && !b.matches('form')) onAction(b); });
    r.addEventListener('submit', e => { const f = e.target.closest('[data-od-form="search"]'); if (f){ e.preventDefault(); doSearch(f.querySelector('input').value); } });
    r.addEventListener('change', e => {
      const f = e.target.closest('[data-od-f]'); if (!f) return;
      const k = f.dataset.odF, v = f.value;
      if (k === 'base'){ DV.cfgSet({ base: v === 'hf' ? 'https://huggingface.co' : v === 'mirror' ? 'https://hf-mirror.com' : (DV.cfgGet().base || 'https://') }); S.resolved = {}; buildItems(); S.setOpen = true; render(); refine(); }
      else if (k === 'custom'){ const u = v.trim().replace(/\/+$/, ''); if (/^https?:\/\/[^\s/]+/i.test(u)){ DV.cfgSet({ base: u }); S.resolved = {}; toast('تم الحفظ'); } else toast('عنوان غير صالح'); }
      else if (k === 'token') DV.cfgSet({ token: v.trim() });
      else DV.cfgSet({ [k]: Number(v) });
      if (k === 'ctx' || k === 'idleMin' || k === 'threads') EN.unload && EN.unload();
    });
  }

  /* =============== شريط الاقتراح في الصفحات الأخرى =============== */
  const BANNER_KEY = 'ai_od_banner_x';
  function banner(){
    const host = $m('mdRec'); if (!host) return;
    const hide = () => { host.innerHTML = ''; host.hidden = true; };
    if (mdUi.tab === 'dl' || !S.dev || ST.list().some(r => r.state === 'ready') || store.get(BANNER_KEY, 0) > Date.now() - 7 * 864e5){ hide(); return; }
    const b = best(); if (!b){ hide(); return; }
    host.hidden = false;
    host.innerHTML = `<div class="od-ban"><span class="i">${ICO('download')}</span><div><b>شغّل نموذجًا على جهازك بلا إنترنت</b><small dir="auto">يناسب جهازك: ${E(b.name)} (≈${bytes(b.sizeBytes)}، ≈${FT.fmtTps(b.fit.tps)} رمز/ث)</small></div>
      <button type="button" class="lib-btn pri" data-ban="go">عرض</button><button type="button" class="lib-ib" data-ban="x" aria-label="إخفاء">${ICO('x')}</button></div>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ban]'); if (!b) return;
    if (b.dataset.ban === 'x'){ store.set(BANNER_KEY, Date.now()); banner(); }
    else { mdUi.tab = 'dl'; saveMdUi(); mdRender(); }
  });

  /* =============== الربط بالصفحة =============== */
  async function show(){
    if (S.open && S.dev){ render(); return; }
    S.open = true; bind(); render();
    await scan(); render();
    ST.verify().then(ch => { if (ch) render(); });
    refine();
  }
  function hide(){ S.open = false; }
  async function prepare(){ if (!S.dev){ try{ await scan(); }catch{} banner(); } }

  ST.on(ev => {
    const r = ST.get(ev.id);
    if (ev.kind === 'ready' && r){ register(r); toast('اكتمل تنزيل ' + r.name + ' ✓'); }
    if (ev.kind === 'removed') unregister(ev.id);
    if (!S.open) return;
    if (ev.kind === 'progress') paint(ev.id); else render();
  });
  EN.on(s => {
    if (s.state === 'loading') toast('جارٍ تحميل النموذج المحلي في الذاكرة… قد يستغرق دقيقة');
    else if (s.state === 'ready' && s.loadMs) toast('النموذج المحلي جاهز (' + dur(s.loadMs / 1000) + ')');
    else if (s.state === 'error' && s.msg) toast(s.msg);
  });
  window.__od_ui = { show, hide, render, banner, prepare, register, unregister, openModel, scan, state: S };

  /* عند الإقلاع: سجّل ما نُزّل سابقًا واستأنف ما كان جاريًا */
  (async () => {
    try{
      await ST.init();
      ST.list().filter(r => r.state === 'ready').forEach(r => { const ep = settings.endpoints.find(e => e.proto === 'ondevice'); if (!ep || !ep.models.some(m => m.id === r.id)) register(r); });
      setTimeout(prepare, 1500);
    }catch(e){ console.warn('od init', e); }
  })();
})();
