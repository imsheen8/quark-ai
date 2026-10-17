/* QUARK AI — صفحة الأصوات (استوديو الأصوات)
   تجربة كل صوت مباشرة، نص تجريبي قابل للتعديل، سرعة ونموذج لكل مزوّد، مفضلة، بحث وفلاتر، مقارنة بالتتابع،
   اختبار المفتاح، أصوات مخصصة (إضافة/تعديل/تكرار/استيراد/تصدير)، ونافذة «إضافة» (نموذج أو صوت) */
'use strict';

(() => {
  const SAMPLE_AR = 'مرحبًا! هذا اختبار للصوت من تطبيق كوارك. Hello, this is a voice test.';
  const SAMPLE_EN = 'Hello! This is a voice test from Quark AI.';
  const SAMPLES = [
    ['عربي', SAMPLE_AR], ['English', SAMPLE_EN],
    ['خبر', 'أعلنت الشركة اليوم عن إطلاق خدمة جديدة تهدف إلى تسهيل حياة المستخدمين في أنحاء العالم العربي.'],
    ['قصة', 'في قديم الزمان، كان هناك صياد يعيش بجوار البحر، وكل صباح كان يخرج بقاربه الصغير قبل شروق الشمس.'],
    ['أرقام', 'الساعة الآن الثالثة والنصف، ودرجة الحرارة خمس وعشرون درجة مئوية، ورقم طلبك: 4 7 1 9 0 2.'],
  ];
  const ic2 = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const pcfg = p => (voiceCfg.tts.cfg[p] = voiceCfg.tts.cfg[p] || {});
  const voiceKey = p => TTS_PROVIDERS[p].voiceIsModel ? 'model' : 'voice';
  let vp = '';

  /* واجهة الاستوديو: تُحفظ بين الجلسات */
  const ui = { view:'grid', f:'all', sort:'def', text:'', ...store.get('ai_vo_ui', {}) };
  Object.assign(ui, { q:'', cmp:false });
  const saveUi = () => store.set('ai_vo_ui', { view:ui.view, f:ui.f, sort:ui.sort, text:ui.text });
  const vfav = new Set(store.get('ai_voice_fav', []));
  const saveFavV = () => store.set('ai_voice_fav', [...vfav]);
  const vkey = (p, id) => p + '|' + id;
  const cmpSel = new Set();

  /* ---------- المزوّدون الذين لديهم مفتاح مضاف ---------- */
  const provs = () => { const a = []; voiceConnsFor('tts').forEach(c => { if (!a.includes(c.preset)) a.push(c.preset); }); return a; };
  const provLabel = p => (VOICE_PRESETS[p] || {}).label || p;
  function viewProv(){
    const ps = provs();
    if (!ps.includes(vp)) vp = ps.includes(voiceCfg.tts.p) ? voiceCfg.tts.p : (ps[0] || '');
    return vp;
  }
  const selId = p => { const d = TTS_PROVIDERS[p], c = pcfg(p); return d.voiceIsModel ? (c.model || d.model) : (c.voice || d.voice); };
  const connFor = p => { const l = voiceConnsFor('tts'); return l.find(x => x.id === voiceCfg.tts.conn && x.preset === p) || l.find(x => x.preset === p); };
  /* استخدام صوت = تفعيل مزوّده للقراءة + حفظ الصوت المختار له */
  function activate(p){
    const c = connFor(p); if (!c) return false;
    voiceCfg.tts.conn = c.id; voiceCfg.tts.p = p; return true;
  }
  function setVoice(p, id){ activate(p); pcfg(p)[voiceKey(p)] = id; saveVoiceCfg(); }
  const sampleText = p => ui.text || (p === 'deepgram' ? SAMPLE_EN : SAMPLE_AR);
  const hueOf = (p, id) => { let h = 0; const s = p + id; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
  const rateTxt = v => (+v).toFixed(2).replace(/0$/, '').replace(/\.0$/, '') + '×';
  const secs = ms => (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';

  /* ---------- محرّك المعاينة: يجرّب أي صوت دون تغيير الصوت المختار ---------- */
  const cache = new Map(), pl = { audio:null, url:'', ctl:null, key:'', raf:0, dur:0 }, lat = {};
  function synthFor(p, voiceId, text, signal){
    const sec = voiceCfg.tts, tc = pcfg(p), k = voiceKey(p), snap = { conn:sec.conn, p:sec.p, val:tc[k] };
    const c = connFor(p); sec.conn = c.id; sec.p = p; tc[k] = voiceId;
    try{ return ttsSynth(text, signal, 'preview'); } finally { sec.conn = snap.conn; sec.p = snap.p; if (snap.val === undefined) delete tc[k]; else tc[k] = snap.val; }
  }
  function stopPlay(){
    pl.ctl?.abort(); pl.ctl = null; cancelAnimationFrame(pl.raf);
    if (pl.audio){ pl.audio.onended = pl.audio.onerror = null; try{ pl.audio.pause(); }catch{} pl.audio = null; }
    if (pl.url){ URL.revokeObjectURL(pl.url); pl.url = ''; }
    const k = pl.key; pl.key = ''; paintPlay(k);
  }
  function paintPlay(old){
    const box = $('voBox'); if (!box) return;
    box.querySelectorAll('[data-vk]').forEach(n => { const on = n.dataset.vk === pl.key; n.classList.toggle('playing', on && !!pl.audio); n.classList.toggle('loading', on && !pl.audio); });
    const dk = $('vsDock'); if (dk){ const on = pl.key && pl.key === dk.dataset.vk; dk.classList.toggle('playing', on && !!pl.audio); dk.classList.toggle('loading', on && !pl.audio); }
    const pb = $('vsPlay'); if (pb) pb.innerHTML = (pl.key && pb.closest('#vsDock').dataset.vk === pl.key) ? ic2('square') : ic2('play');
  }
  /* يعيد وعدًا يُحَلّ عند انتهاء التشغيل (أو التوقف) */
  async function playVoice(p, v){
    const key = vkey(p, v.id), c = connFor(p);
    if (pl.key === key){ stopPlay(); return; }
    stopPlay(); speakStop();
    if (!c || (!c.key && !TTS_PROVIDERS[p].custom)){ toast('أضف مفتاح API لهذا المزوّد أولًا من «مفاتيح الصوت»'); return; }
    const ctl = new AbortController(); pl.ctl = ctl; pl.key = key; paintPlay();
    const text = sampleText(p), rate = Number(voiceCfg.tts.rate) || 1, mdl = v.custom && v.model ? v.model : pcfg(p).model || '';
    const ck = [p, v.id, mdl, rate, text].join('\u0001'), t0 = performance.now();
    try{
      let blob = cache.get(ck), hit = !!blob;
      if (!blob){ blob = await synthFor(p, v.id, text, ctl.signal); cache.set(ck, blob); if (cache.size > 24) cache.delete(cache.keys().next().value); }
      if (pl.ctl !== ctl) return;
      lat[key] = hit ? 0 : Math.round(performance.now() - t0); paintLat(key, hit);
      if (hit) window.__usage?.log({ t:'tts', p, v:v.id, m:mdl, c:speakClean(text).length, s:'preview', r:rate, ok:true, ms:0, cache:1 });
      pl.url = URL.createObjectURL(blob);
      const a = new Audio(pl.url); pl.audio = a;
      if (p !== 'openai' && p !== 'custom') a.playbackRate = Math.min(2, Math.max(.5, rate));
      await a.play(); paintPlay();
      const bar = $('vsBar'), tm = $('vsTime');
      const tick = () => {
        if (pl.audio !== a) return; const d = a.duration || 0;
        if (bar) bar.style.width = (d ? a.currentTime / d * 100 : 0) + '%';
        if (tm) tm.textContent = a.currentTime.toFixed(1) + ' / ' + (d ? d.toFixed(1) : '…') + ' s';
        pl.raf = requestAnimationFrame(tick);
      }; tick();
      await new Promise(res => { a.onended = a.onerror = res; ctl.signal.addEventListener('abort', res); });
    }catch(e){
      if (e.name !== 'AbortError') toast('تعذّرت القراءة: ' + (e.message === 'Failed to fetch' ? 'تحقق من الاتصال' : e.message));
    }finally{
      if (pl.ctl === ctl) stopPlay();
      const bar = $('vsBar'); if (bar) bar.style.width = '0'; const tm = $('vsTime'); if (tm) tm.textContent = '';
    }
  }
  function paintLat(key, hit){
    document.querySelectorAll('#voBox [data-vk]').forEach(n => { if (n.dataset.vk !== key) return; const l = n.querySelector('[data-lat]'); if (l) l.textContent = hit ? 'من الذاكرة' : '⚡ ' + secs(lat[key]); });
    const dl = $('vsLat'); if (dl && $('vsDock')?.dataset.vk === key) dl.textContent = hit ? 'من الذاكرة المؤقتة' : 'زمن التوليد ' + secs(lat[key]);
  }
  /* تشغيل قائمة أصوات بالتتابع للمقارنة */
  let seqRun = 0;
  async function playSeq(p, list){
    const my = ++seqRun; stopPlay();
    for (const v of list){
      if (my !== seqRun) break;
      toast('▶ ' + v.name);
      await playVoice(p, v);
      if (my !== seqRun) break;
      await new Promise(r => setTimeout(r, 350));
    }
  }

  /* ---------- بيانات الأصوات ---------- */
  function listFor(p){
    const cur = selId(p), isCur = voiceCfg.tts.p === p;
    let a = ttsVoiceList(p).map((v, i) => ({ ...v, i, p, cur:isCur && v.id === cur, fav:vfav.has(vkey(p, v.id)) }));
    const q = ui.q.trim().toLowerCase();
    if (q) a = a.filter(v => (v.name + ' ' + v.desc + ' ' + v.id).toLowerCase().includes(q));
    if (ui.f === 'fav') a = a.filter(v => v.fav); else if (ui.f === 'cust') a = a.filter(v => v.custom);
    if (ui.sort === 'name') a.sort((x, y) => x.name.localeCompare(y.name));
    else if (ui.sort === 'fav') a.sort((x, y) => (y.fav - x.fav) || (y.cur - x.cur) || x.i - y.i);
    else if (ui.sort === 'fast') a.sort((x, y) => (lat[vkey(p, x.id)] ?? 1e9) - (lat[vkey(p, y.id)] ?? 1e9) || x.i - y.i);
    return a;
  }
  const count = () => provs().reduce((n, p) => n + ttsVoiceList(p).length, 0);

  /* ---------- العرض ---------- */
  function cardHtml(v){
    const k = vkey(v.p, v.id), st = pl.key === k ? (pl.audio ? ' playing' : ' loading') : '';
    const clr = v.color ? `--oc:${esc(v.color)}` : `--hue:${hueOf(v.p, v.id)}`;
    const more = v.custom ? `<button type="button" class="vo-mi more" data-va="more" aria-haspopup="menu" aria-label="المزيد">${ic2('more')}</button>` : '';
    const star = v.custom ? '' : `<button type="button" class="vo-mi fav${v.fav ? ' on' : ''}" data-va="fav" aria-label="مفضلة">${ic2('lib-star')}</button>`;
    return `<div class="vc-card${v.cur ? ' cur' : ''}${st}${cmpSel.has(k) ? ' sel' : ''}" data-vk="${esc(k)}" data-id="${esc(v.id)}">
      <button type="button" class="vc-orb" data-va="play" aria-label="تجربة الصوت" style="${clr}"${v.color ? ' data-c' : ''}><span class="o">${ic2('play')}${ic2('square')}</span><i class="vc-ring"></i></button>
      <div class="vc-info"><h4>${esc(v.name)}${v.custom ? '<span class="vo-badge">مخصص</span>' : ''}${v.cur ? '<span class="vo-badge ok">الحالي</span>' : ''}</h4>
        <p>${esc(v.desc)}</p><small data-lat>${lat[k] != null ? (lat[k] ? '⚡ ' + secs(lat[k]) : 'من الذاكرة') : ''}</small></div>
      <div class="vc-act">${ui.cmp ? `<span class="vc-chk" data-va="sel">${ic2('check')}</span>` :
        `${star}<button type="button" class="lib-btn${v.cur ? '' : ' pri'} vc-use" data-va="use"${v.cur ? ' disabled' : ''}>${v.cur ? 'مستخدم' : 'استخدام'}</button>${more}`}</div></div>`;
  }
  function listHtml(p){
    const a = listFor(p);
    const emp = ttsVoiceList(p).length
      ? `<div class="lib-empty">${ui.f === 'fav' ? 'لا توجد أصوات مفضلة بعد — اضغط ★ على أي صوت.' : ui.f === 'cust' ? 'لا توجد أصوات مخصصة لهذا المزوّد.' : 'لا نتائج مطابقة للبحث.'}</div>`
      : '<div class="lib-empty">لا توجد أصوات جاهزة لهذا المزوّد.<br>أضف صوتًا مخصصًا بمعرّفه من زر «+».</div>';
    return a.length ? a.map(cardHtml).join('') : emp;
  }
  function dockHtml(p){
    const cur = ttsVoiceList(p).find(v => v.id === selId(p)) || { id:selId(p), name:selId(p) || 'صوت افتراضي', desc:'' }, k = vkey(p, cur.id);
    const d = TTS_PROVIDERS[p], tc = pcfg(p), rate = Number(voiceCfg.tts.rate) || 1, active = voiceCfg.tts.p === p;
    const clr = cur.color ? `--oc:${esc(cur.color)}` : `--hue:${hueOf(p, cur.id)}`;
    const mdls = d.voiceIsModel ? '' : (() => {
      const cm = tc.model || d.model, opts = [...new Set([...(d.models || []), cm])];
      return `<label class="vs-f">النموذج<select class="fld" id="vsModel">${opts.map(m => `<option value="${esc(m)}"${m === cm ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></label>`;
    })();
    const c = connFor(p);
    return `<div class="vs-dock" id="vsDock" data-vk="${esc(k)}" data-id="${esc(cur.id)}">
      <div class="vs-top"><button type="button" class="vs-orb" id="vsOrb" style="${clr}" aria-label="تجربة"><i></i></button>
        <div class="vs-now"><small>${active ? 'الصوت المستخدم للقراءة' : 'صوت هذا المزوّد (غير مفعّل للقراءة)'}</small><h3>${esc(cur.name)}</h3><p>${esc(provLabel(p))}${c ? ' · ' + esc(voiceConnLabel(c)) : ''}</p></div>
        <button type="button" class="vs-play" id="vsPlay" aria-label="تشغيل">${ic2('play')}</button></div>
      <div class="vs-prog"><i id="vsBar"></i></div><div class="vs-meta"><span id="vsTime"></span><span id="vsLat"></span></div>
      <div class="vs-grid">
        <label class="vs-f vs-rate"><span>السرعة <em id="vsRv">${rateTxt(rate)}</em></span><input type="range" id="vsRate" min="0.5" max="2" step="0.05" value="${rate}">
          <div class="vs-pre">${[0.75, 1, 1.25, 1.5].map(r => `<button type="button" data-rt="${r}" class="${Math.abs(rate - r) < .01 ? 'on' : ''}">${rateTxt(r)}</button>`).join('')}</div></label>
        ${mdls}
      </div>
      <div class="vs-sample"><div class="vs-pre">${SAMPLES.map((s, i) => `<button type="button" data-sm="${i}" class="${(ui.text || sampleText(p)) === s[1] ? 'on' : ''}">${s[0]}</button>`).join('')}</div>
        <textarea id="vsText" maxlength="500" placeholder="اكتب نصًّا لتجربته بالأصوات…" dir="auto">${esc(ui.text || sampleText(p))}</textarea></div>
      <div class="vs-keys"><button type="button" class="lib-btn" id="vsKey">${ic2('key')}اختبار المفتاح</button><span id="vsKeyR" class="vs-kr"></span></div>
    </div>`;
  }
  function toolbarHtml(p){
    const nF = ttsVoiceList(p).filter(v => vfav.has(vkey(p, v.id))).length, nC = ttsCustoms(p).length, nA = ttsVoiceList(p).length;
    const chip = (k, l, n) => `<button type="button" class="md-chip ${ui.f === k ? 'on' : ''}" data-vf="${k}">${l}<small>${n}</small></button>`;
    return `<div class="vs-tool"><div class="vs-search">${ic2('search')}<input type="text" id="vsQ" placeholder="ابحث عن صوت…" autocomplete="off" spellcheck="false" dir="auto" value="${esc(ui.q)}"></div>
      <div class="md-chips">${chip('all', 'الكل', nA)}${chip('fav', 'المفضلة', nF)}${chip('cust', 'المخصصة', nC)}</div>
      <div class="vs-tr"><div class="sel-wrap"><select class="fld" id="vsSort" aria-label="الترتيب"><option value="def"${ui.sort === 'def' ? ' selected' : ''}>الترتيب الافتراضي</option><option value="name"${ui.sort === 'name' ? ' selected' : ''}>الاسم</option><option value="fav"${ui.sort === 'fav' ? ' selected' : ''}>المفضلة أولًا</option><option value="fast"${ui.sort === 'fast' ? ' selected' : ''}>الأسرع توليدًا</option></select><svg class="i caret"><use href="#i-chevron-down"/></svg></div>
        <div class="md-vm" id="vsVm"><button type="button" data-vv="grid" class="${ui.view === 'grid' ? 'on' : ''}" aria-label="شبكة">${ic2('grid')}</button><button type="button" data-vv="list" class="${ui.view === 'list' ? 'on' : ''}" aria-label="قائمة">${ic2('rows')}</button></div></div></div>
      <div class="vs-bar"><button type="button" class="lib-btn${ui.cmp ? ' pri' : ''}" id="vsCmp">${ic2('columns')}${ui.cmp ? 'إنهاء المقارنة' : 'مقارنة أصوات'}</button>
        ${ui.cmp ? `<button type="button" class="lib-btn pri" id="vsSeq"${cmpSel.size < 2 ? ' disabled' : ''}>${ic2('play')}تشغيل المحدد (${cmpSel.size})</button>` : `<button type="button" class="lib-btn" id="vsAll">${ic2('play')}جرّب الكل بالتتابع</button>`}
        <span class="sp"></span><button type="button" class="lib-btn" id="vsExp">${ic2('download')}تصدير</button><button type="button" class="lib-btn" id="vsImp">${ic2('upload')}استيراد</button><button type="button" class="lib-btn pri" id="vsAdd">${ic2('plus')}صوت</button></div>`;
  }
  function drawList(){
    closeMore();
    const p = viewProv(), l = $('vcList'); if (!l) return;
    l.className = 'vc-grid' + (ui.view === 'list' ? ' list' : '') + (ui.cmp ? ' cmp' : ''); l.innerHTML = listHtml(p);
  }
  function drawTool(){ const t = $('vsToolBox'); if (t){ t.innerHTML = toolbarHtml(viewProv()); } drawList(); }
  function drawDock(){ const d = $('vsDockBox'); if (d) d.innerHTML = dockHtml(viewProv()); paintPlay(); }

  function render(){
    closeMore();
    const box = $('voBox'); if (!box) return;
    const ps = provs();
    if (!ps.length){
      box.innerHTML = '<div class="lib-empty">لا يوجد مفتاح صوت مضاف بعد.<br>أضف مفتاحًا من الإعدادات ← المفاتيح والنماذج ← مفاتيح الصوت لتظهر الأصوات هنا.</div>' +
        '<div style="text-align:center;padding-bottom:20px"><button type="button" class="lib-btn pri" data-vo="keys">إضافة مفتاح صوت</button></div>';
      return;
    }
    const p = viewProv(), d = TTS_PROVIDERS[p], tc = pcfg(p);
    /* صوت مكتوب يدويًا سابقًا ولا يوجد في القائمة يتحول إلى صوت مخصص محفوظ */
    if (!d.voiceIsModel && (d.voices || []).length && tc.voice && !ttsVoiceList(p).some(v => v.id === tc.voice)){
      (tc.customVoices = tc.customVoices || []).push({ cid:uid(), name:'صوت مخصص', desc:'', voiceId:tc.voice, model:'', color:'' }); saveVoiceCfg();
    }
    let h = '';
    if (ps.length > 1) h += '<div class="md-chips vo-provs">' + ps.map(x => `<button type="button" class="md-chip ${x === p ? 'on' : ''}" data-vp="${x}"><span>${esc(provLabel(x))}</span><small>${ttsVoiceList(x).length}</small></button>`).join('') + '</div>';
    h += '<div id="vsDockBox"></div><div id="vsToolBox"></div><div id="vcList"></div>';
    h += '<p class="vo-help vs-foot">اضغط على الدائرة لتجربة أي صوت بالنص التجريبي دون تغيير الصوت المستخدم، ثم «استخدام» لاعتماده للقراءة الصوتية في المحادثات.</p>';
    box.innerHTML = h; drawDock(); drawTool();
  }

  /* ---------- الأحداث ---------- */
  const box = $('voBox');
  const curV = (p, el) => { const k = el.closest('[data-vk]'); if (!k) return null; return ttsVoiceList(p).find(v => v.id === k.dataset.id); };
  async function doKeyTest(){
    const p = viewProv(), c = connFor(p), r = $('vsKeyR'); if (!c) return;
    if (!c.key && !TTS_PROVIDERS[p].custom){ r.className = 'vs-kr bad'; r.textContent = 'لا يوجد مفتاح'; return; }
    r.className = 'vs-kr'; r.innerHTML = '<i class="md-spin"></i>يختبر…'; const t0 = performance.now();
    try{ await voiceConnTest(p, c.url, c.key); r.className = 'vs-kr ok'; r.textContent = '✓ المفتاح سليم · ' + secs(performance.now() - t0); }
    catch(e){ r.className = 'vs-kr bad'; r.textContent = '✕ ' + (e.message === 'Failed to fetch' ? 'تعذّر الاتصال' : e.message); }
  }
  function exportVoices(){
    const out = {}; provs().forEach(p => { const c = ttsCustoms(p); if (c.length) out[p] = c.map(({ name, desc, voiceId, model, color }) => ({ name, desc, voiceId, model, color })); });
    if (!Object.keys(out).length){ toast('لا توجد أصوات مخصصة للتصدير'); return; }
    saveFile(new Blob([JSON.stringify({ app:'quark-ai-voices', v:1, voices:out, fav:[...vfav] }, null, 2)], { type:'application/json' }), 'quark-voices.json'); toast('تم تصدير الأصوات المخصصة');
  }
  function importVoices(){
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      try{
        const d = JSON.parse(await inp.files[0].text()); if (d.app !== 'quark-ai-voices') throw 0;
        let n = 0;
        Object.entries(d.voices || {}).forEach(([p, list]) => {
          if (!TTS_PROVIDERS[p]) return; const tc = pcfg(p); tc.customVoices = tc.customVoices || [];
          (list || []).forEach(v => { if (!v || !v.voiceId || ttsVoiceList(p).some(x => x.id === v.voiceId)) return; tc.customVoices.push({ cid:uid(), name:String(v.name || 'صوت').slice(0, 30), desc:String(v.desc || '').slice(0, 80), voiceId:String(v.voiceId), model:String(v.model || ''), color:/^#[0-9a-f]{6}$/i.test(v.color || '') ? v.color : '' }); n++; });
        });
        (d.fav || []).forEach(k => vfav.add(k)); saveFavV(); saveVoiceCfg(); render(); toast(`تم الاستيراد — ${n} صوت جديد`);
      }catch{ toast('ملف غير صالح'); }
    };
    inp.click();
  }

  async function doAct(a, p, v){
    const k = vkey(p, v.id);
    if (a === 'fav'){ vfav.has(k) ? vfav.delete(k) : vfav.add(k); saveFavV(); drawTool(); return; }
    if (a === 'edit'){ const cv = ttsCustoms(p).find(x => x.cid === v.cid); if (cv) openAdd(cv); return; }
    if (a === 'dup'){
      const cv = ttsCustoms(p).find(x => x.cid === v.cid); if (!cv) return;
      let id = cv.voiceId + '-copy', n = 2; while (ttsVoiceList(p).some(x => x.id === id)) id = cv.voiceId + '-copy' + n++;
      pcfg(p).customVoices.push({ ...cv, cid:uid(), name:(cv.name + ' (نسخة)').slice(0, 30), voiceId:id }); saveVoiceCfg(); drawTool(); toast('تم تكرار الصوت — عدّل معرّفه ليطابق صوتًا حقيقيًا'); return;
    }
    if (a === 'del'){
      const cv = ttsCustoms(p).find(x => x.cid === v.cid); if (!cv) return;
      if (!(await qConfirm(`حذف الصوت «${cv.name}»؟`, { ok:'حذف' }))) return;
      const d = TTS_PROVIDERS[p], tc = pcfg(p), kk = voiceKey(p), wasOn = tc[kk] === cv.voiceId;
      tc.customVoices = tc.customVoices.filter(x => x.cid !== cv.cid); vfav.delete(k); cmpSel.delete(k); saveFavV();
      if (wasOn) tc[kk] = d.voiceIsModel ? d.model : d.voice;
      stopPlay(); saveVoiceCfg(); render(); toast('تم حذف الصوت');
    }
  }

  /* ---------- قائمة «المزيد» (ثلاث نقاط) للأصوات المخصصة ---------- */
  let moreEl = null, moreBtn = null;
  function closeMore(){
    if (!moreEl) return;
    moreEl.remove(); moreEl = null; moreBtn?.classList.remove('open'); moreBtn = null;
    document.removeEventListener('pointerdown', moreOutside, true); document.removeEventListener('keydown', moreKey, true);
    window.removeEventListener('resize', closeMore); $('voView')?.removeEventListener('scroll', closeMore);
  }
  const moreOutside = e => { if (moreEl && !moreEl.contains(e.target) && !(moreBtn && moreBtn.contains(e.target))) closeMore(); };
  const moreKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); e.preventDefault(); closeMore(); } };
  function openMore(btn, p, v){
    if (!btn) return;
    if (moreBtn === btn){ closeMore(); return; }
    closeMore();
    const fav = vfav.has(vkey(p, v.id));
    const m = document.createElement('div');
    m.className = 'ctx-menu vc-menu'; m.setAttribute('role', 'menu');
    const it = (a, icon, label, cls = '') => `<button type="button" role="menuitem" data-vm="${a}"${cls ? ` class="${cls}"` : ''}>${ic2(icon)}<span>${label}</span></button>`;
    m.innerHTML = it('fav', 'lib-star', fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة', fav ? 'on' : '') + it('edit', 'lib-edit', 'تعديل') + it('dup', 'copy', 'تكرار') + '<hr>' + it('del', 'trash', 'حذف', 'danger');
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-vm]'); if (!b) return;
      const a = b.dataset.vm; closeMore(); doAct(a, p, v);
    });
    document.body.appendChild(m);
    moreEl = m; moreBtn = btn; btn.classList.add('open');
    const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    let top = r.bottom + 6; if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    m.style.left = left + 'px'; m.style.top = top + 'px';
    document.addEventListener('pointerdown', moreOutside, true); document.addEventListener('keydown', moreKey, true);
    window.addEventListener('resize', closeMore); $('voView')?.addEventListener('scroll', closeMore, { passive:true });
  }

  box.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-vo="keys"]')) return window.__openVoiceKeys();
    const vpb = t.closest('[data-vp]');
    if (vpb){ seqRun++; stopPlay(); speakStop(); vp = vpb.dataset.vp; cmpSel.clear(); render(); return; }
    const p = viewProv(); if (!p) return;
    /* --- الاستوديو العلوي --- */
    if (t.closest('#vsPlay') || t.closest('#vsOrb')){
      const dk = $('vsDock'), v = ttsVoiceList(p).find(x => x.id === dk.dataset.id) || { id:dk.dataset.id, name:dk.dataset.id };
      if (!ttsVoiceList(p).length && !v.id){ toast('لا يوجد صوت محدد'); return; }
      seqRun++; return playVoice(p, v);
    }
    const rt = t.closest('[data-rt]'); if (rt){ voiceCfg.tts.rate = +rt.dataset.rt; saveVoiceCfg(); cache.clear(); drawDock(); return; }
    const sm = t.closest('[data-sm]'); if (sm){ ui.text = SAMPLES[+sm.dataset.sm][1]; saveUi(); $('vsText').value = ui.text; box.querySelectorAll('[data-sm]').forEach(b => b.classList.toggle('on', b === sm)); return; }
    if (t.closest('#vsKey')) return doKeyTest();
    /* --- شريط الأدوات --- */
    const vf = t.closest('[data-vf]'); if (vf){ ui.f = vf.dataset.vf; saveUi(); drawTool(); return; }
    const vv = t.closest('[data-vv]'); if (vv){ ui.view = vv.dataset.vv; saveUi(); drawTool(); return; }
    if (t.closest('#vsCmp')){ ui.cmp = !ui.cmp; cmpSel.clear(); seqRun++; stopPlay(); drawTool(); return; }
    if (t.closest('#vsSeq')){ const l = listFor(p).filter(v => cmpSel.has(vkey(p, v.id))); if (l.length > 1) playSeq(p, l); return; }
    if (t.closest('#vsAll')){ const l = listFor(p); if (!l.length){ toast('لا توجد أصوات'); return; } if (l.length > 12 && !(await qConfirm(`سيتم توليد ${l.length} صوتًا بالتتابع وقد يستهلك رصيدك. المتابعة؟`, { ok:'متابعة', danger:false }))) return; playSeq(p, l); return; }
    if (t.closest('#vsAdd')) return openAdd();
    if (t.closest('#vsExp')) return exportVoices();
    if (t.closest('#vsImp')) return importVoices();
    /* --- بطاقات الأصوات --- */
    const a = t.closest('[data-va]')?.dataset.va, card = t.closest('.vc-card'); if (!card) return;
    const v = curV(p, card); if (!v) return; const k = vkey(p, v.id);
    if (ui.cmp && (!a || a === 'sel' || a === 'use')){ cmpSel.has(k) ? cmpSel.delete(k) : cmpSel.add(k); card.classList.toggle('sel', cmpSel.has(k)); const sq = $('vsSeq'); if (sq){ sq.disabled = cmpSel.size < 2; sq.lastChild.textContent = `تشغيل المحدد (${cmpSel.size})`; } return; }
    if (a === 'play' || !a){ seqRun++; return playVoice(p, v); }
    if (a === 'use'){ seqRun++; stopPlay(); setVoice(p, v.id); drawDock(); drawList(); toast('الصوت المستخدم: ' + v.name); return; }
    if (a === 'more') return openMore(t.closest('[data-va="more"]'), p, v);
    return doAct(a, p, v);
  });
  box.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'vsQ'){ ui.q = t.value; drawList(); }
    else if (t.id === 'vsText'){ ui.text = t.value.slice(0, 500); saveUi(); box.querySelectorAll('[data-sm]').forEach(b => b.classList.remove('on')); }
    else if (t.id === 'vsRate'){ voiceCfg.tts.rate = +t.value; $('vsRv').textContent = rateTxt(t.value); saveVoiceCfg(); cache.clear(); box.querySelectorAll('[data-rt]').forEach(b => b.classList.toggle('on', Math.abs(+t.value - +b.dataset.rt) < .01)); }
  });
  box.addEventListener('change', e => {
    const t = e.target, p = viewProv();
    if (t.id === 'vsSort'){ ui.sort = t.value; saveUi(); drawList(); }
    else if (t.id === 'vsModel'){ pcfg(p).model = t.value; saveVoiceCfg(); cache.clear(); toast('نموذج الصوت: ' + t.value); }
  });

  /* ---------- نافذة «إضافة/تعديل صوت مخصص» ---------- */
  function openAdd(cv){
    const ps = provs(), editing = !!cv, p0 = viewProv() || ps[0] || '';
    const ov = document.createElement('div'); ov.className = 'lib-ov q-confirm show';
    const body = ps.length
      ? `<label class="lib-f">المزوّد<select class="fld" id="cvProv"${editing ? ' disabled' : ''}>${(editing ? [p0] : ps).map(x => `<option value="${x}"${x === p0 ? ' selected' : ''}>${esc(provLabel(x))}</option>`).join('')}</select></label>` +
        '<label class="lib-f">اسم الصوت<input type="text" id="cvName" maxlength="30" placeholder="مثال: صوت المذيع" autocomplete="off"></label>' +
        '<label class="lib-f"><span>الوصف <span class="tc-opt">(اختياري)</span></span><textarea id="cvDesc" maxlength="80" placeholder="وصف قصير للصوت"></textarea></label>' +
        '<label class="lib-f"><span id="cvIdT">معرّف الصوت (Voice ID)</span><input type="text" id="cvId" dir="ltr" autocomplete="off" spellcheck="false"></label>' +
        '<label class="lib-f" id="cvModelW"><span>النموذج <span class="tc-opt">(اختياري — يُستخدم مع هذا الصوت فقط)</span></span><input type="text" id="cvModel" dir="ltr" autocomplete="off" spellcheck="false"></label>' +
        '<div class="lib-f cv-clr"><span>لون الدائرة</span><input type="color" id="cvColor"></div>'
      : '<p class="vo-help">لا يوجد مفتاح صوت مضاف. أضف مفتاحًا من الإعدادات ← المفاتيح والنماذج ← مفاتيح الصوت أولًا.</p>';
    ov.innerHTML = `<div class="lib-dlg cv-dlg" role="dialog" aria-modal="true"><h2>${editing ? 'تعديل الصوت المخصص' : 'إضافة صوت مخصص'}</h2>${body}` +
      `<div class="lib-acts"><button type="button" class="lib-btn" data-cx>إلغاء</button><button type="button" class="lib-btn pri" data-cok>${editing ? 'حفظ' : 'إضافة'}</button></div></div>`;
    const q = s => ov.querySelector(s);
    let color = cv ? (cv.color || '') : '';
    const syncProv = () => {
      const sel = q('#cvProv'); if (!sel) return;
      const d = TTS_PROVIDERS[sel.value], vm = !!d.voiceIsModel;
      q('#cvIdT').textContent = vm ? 'معرّف الصوت (النموذج)' : 'معرّف الصوت (Voice ID)';
      q('#cvId').placeholder = d.voiceHint || 'Voice ID';
      q('#cvModelW').style.display = vm ? 'none' : ''; q('#cvModel').placeholder = d.model || '';
    };
    if (q('#cvName')){
      q('#cvName').value = cv ? cv.name : ''; q('#cvDesc').value = cv ? (cv.desc || '') : ''; q('#cvId').value = cv ? cv.voiceId : '';
      q('#cvModel').value = cv ? (cv.model || '') : '';
      q('#cvColor').value = /^#[0-9a-f]{6}$/i.test(color) ? color : '#d97757';
      q('#cvColor').addEventListener('input', e => { color = e.target.value; });
      q('#cvProv').addEventListener('change', syncProv); syncProv();
    }
    const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); e.preventDefault(); close(); } };
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.closest('[data-cx]')) return close();
      if (e.target.closest('[data-cok]')) saveVoice();
    });
    const saveVoice = () => {
      if (!ps.length){ close(); toast('أضف مفتاح صوت أولًا'); window.__openVoiceKeys(); return; }
      const p = q('#cvProv').value, d = TTS_PROVIDERS[p], vm = !!d.voiceIsModel, tc = pcfg(p);
      const name = q('#cvName').value.trim().replace(/\s+/g, ' '), vid = q('#cvId').value.trim();
      if (!name){ toast('اكتب اسم الصوت'); q('#cvName').focus(); return; }
      if (!vid){ toast('اكتب معرّف الصوت'); q('#cvId').focus(); return; }
      if (ttsVoiceList(p).some(v => v.id === vid && !(cv && v.cid === cv.cid))){ toast('هذا المعرّف مستخدم في صوت آخر'); return; }
      const rec = { name, desc:q('#cvDesc').value.trim().replace(/\s+/g, ' '), voiceId:vid, model:vm ? '' : q('#cvModel').value.trim(), color };
      const k = vm ? 'model' : 'voice';
      if (cv){
        const wasOn = tc[k] === cv.voiceId; Object.assign(cv, rec);
        if (wasOn) tc[k] = vid;
      } else {
        (tc.customVoices = tc.customVoices || []).push({ cid:uid(), ...rec }); tc[k] = vid; activate(p);
      }
      stopPlay(); speakStop(); saveVoiceCfg(); close();
      vp = p; render(); toast(cv ? 'تم حفظ التعديل' : 'تمت إضافة الصوت');
    };
    document.body.appendChild(ov);
    setTimeout(() => q('#cvName')?.focus(), 40);
  }

  /* ---------- فتح الصفحة وأزرار الرأس ---------- */
  function openVoicesPage(){
    mainEl.classList.remove('lib-open', 'set-open', 'pf-open', 'ch-open', 'md-open'); mainEl.classList.add('vo-open');
    closeDrawer(); render(); $('voView').querySelector('.vo-body').scrollTop = 0;
  }
  $('navVoices').addEventListener('click', openVoicesPage);
  $('voMenu').addEventListener('click', () => $('toggleSidebar').click());
  $('voAdd').addEventListener('click', () => openAdd());
  $('voKeys').addEventListener('click', () => window.__openVoiceKeys());
  $('voSet').addEventListener('click', () => openSettings('voice'));
  /* مغادرة الصفحة توقف التشغيل */
  new MutationObserver(() => { if (!mainEl.classList.contains('vo-open')){ seqRun++; stopPlay(); } }).observe(mainEl, { attributes:true, attributeFilter:['class'] });

  window.__openVoices = () => { vp = ''; openVoicesPage(); };
  window.__voRefresh = render;
})();
