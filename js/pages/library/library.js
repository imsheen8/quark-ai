/* QUARK AI — صفحة المكتبة */
'use strict';

/* ================= المكتبة ================= */
const sysPrompt = () => { const a = store.get('ai_active_persona', null), pf = getProfile(), nm = pf.nick || pf.name;
  return [settings.systemPrompt, a?.prompt ? 'الشخصية المطلوبة منك: ' + a.prompt : '',
    nm ? 'اسم المستخدم: ' + nm : '', pf.prefs ? 'تفضيلات المستخدم الشخصية (طبّقها في كل الردود): ' + pf.prefs : '', window.__mmCtx || '', window.__skCtx || '', window.__wsCtx || '', window.__intCtx || '', window.__agCtx || ''].filter(Boolean).join('\n\n'); };
(function library(){
  const $l = id => document.getElementById(id);
  const esc = x => String(x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ic = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
  const SEED = [
    {id:'t1',kind:'template',name:'اشرح لي ببساطة',text:'اشرح لي {{الموضوع}} بطريقة بسيطة جدًا كأنني مبتدئ، مع مثال من الحياة اليومية.'},
    {id:'t2',kind:'template',name:'لخّص النص',text:'لخّص النص التالي في نقاط قصيرة وواضحة مع إبراز الفكرة الرئيسية:\n'},
    {id:'t3',kind:'template',name:'صحّح لغويًا',text:'صحّح الأخطاء الإملائية والنحوية في النص التالي دون تغيير المعنى، ثم اذكر التعديلات:\n'},
    {id:'t4',kind:'template',name:'ترجمة احترافية',text:'ترجم النص التالي ترجمة دقيقة وطبيعية إلى {{اللغة|العربية}} مع الحفاظ على الأسلوب:\n{{النص}}'},
    {id:'p1',kind:'persona',name:'معلّم صبور',text:'أنت معلّم صبور ولطيف. اشرح خطوة بخطوة، استخدم أمثلة بسيطة، واسأل المستخدم للتأكد من فهمه.'},
    {id:'p2',kind:'persona',name:'مبرمج خبير',text:'أنت مهندس برمجيات خبير. قدّم حلولًا عملية وكودًا نظيفًا مع شرح مختصر لأفضل الممارسات.'},
    {id:'p3',kind:'persona',name:'كاتب مبدع',text:'أنت كاتب مبدع بأسلوب أدبي راقٍ. استخدم لغة غنية وصورًا بلاغية وحافظ على الإيقاع.'},
  ];
  let lib = store.get('ai_library', null); if (!lib){ lib = SEED; store.set('ai_library', lib); }
  /* تاريخ إنشاء لكل عنصر (للترتيب بالأحدث/الأقدم): القديم بلا تاريخ يُرتَّب حسب موضعه */
  if (lib.some(x => !x.ts)){ const base = 1700000000000; lib.forEach((x, i) => { if (!x.ts) x.ts = base + (lib.length - i) * 1000; }); store.set('ai_library', lib); }
  let fav = new Set(store.get('ai_library_fav', []));
  { let moved = false;   /* ترحيل مفضلة المحادثات القديمة إلى المحادثات نفسها */
    [...fav].forEach(k => { if (k.startsWith('chat:')){ const c = chats.find(x => x.id === k.slice(5)); if (c){ c.fav = true; moved = true; } fav.delete(k); } });
    if (moved) save(); store.set('ai_library_fav', [...fav]); }
  let activeP = store.get('ai_active_persona', null)?.id || null;
  let tab = 'all', query = '', multi = false; const sel = new Set();
  const TABS = [['all','الكل'],['fav','المفضلة'],['persona','الشخصيات'],['template','القوالب'],['research','البحث العميق'],['skills','المهارات'],['tasks','المهام']];
  const KIND = {persona:'شخصية',template:'قالب',research:'بحث عميق'};
  const stripMd = s => String(s).replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`|\-]|\[(\d+(?:[،, ]+\d+)*)\]|\(https?:[^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const rsItems = () => {
    const l = (typeof rsDB !== 'undefined' ? rsDB.list() : []).slice();
    return l.map(r => ({ id:r.id, kind:'research', name:r.title, text:rsCut(stripMd(r.report), 170), hay:r.q + ' ' + r.report, n:r.stats?.sources || 0, ts:r.ts, partial:!!r.partial }));
  };
  const key = x => x.kind + ':' + x.id;
  const all = () => [...lib, ...rsItems()];
  const saveLib = () => { store.set('ai_library', lib); store.set('ai_library_fav', [...fav]); };
  /* ---------- الترشيح والترتيب: قائمة تتغير حسب التبويب ---------- */
  const LF_KEY = 'ai_lib_filters';
  let lf = store.get(LF_KEY, {}) || {};
  { const old = store.get('ai_lib_rs_sort', null); if (old && !lf['research.sort']){ lf['research.sort'] = old; store.set(LF_KEY, lf); } }
  const fget = (t, n, d) => lf[t + '.' + n] ?? d;
  const fset = (t, n, v) => { lf[t + '.' + n] = v; store.set(LF_KEY, lf); };
  const TLABEL = Object.fromEntries(TABS);
  /* تبويبات مدمجة تُدار من صفحاتها: المهارات والمهام والنتائج */
  const EMB = { skills:{ view:'skView', api:() => window.__sk, ph:'ابحث في المهارات…' }, tasks:{ view:'tkTasksView', api:() => window.__tkApi, ph:'ابحث في المهام…' } };
  const embApi = () => EMB[tab]?.api();
  const embCount = k => EMB[k]?.api()?.count() || 0;
  const SORT_BASE = [['recent','الأحدث','clock'],['oldest','الأقدم','calendar'],['name','الاسم','pen']];
  const TYPE_OPTS = [['any','كل الأنواع','layers'],['template','القوالب','file'],['persona','الشخصيات','user'],['research','البحث العميق','search']];
  const nVars = x => x.kind === 'template' ? tplVars(x.text).size : 0;
  const GROUPS = {
    all:      () => [{ id:'sort', h:'الترتيب', opts:SORT_BASE, def:'recent' }, { id:'type', h:'النوع', opts:TYPE_OPTS, def:'any' }],
    fav:      () => [{ id:'sort', h:'الترتيب', opts:SORT_BASE, def:'recent' }, { id:'type', h:'النوع', opts:TYPE_OPTS, def:'any' }],
    persona:  () => [{ id:'sort', h:'الترتيب', opts:[...SORT_BASE, ['active','النشطة أولًا','lib-power']], def:'recent' }, { id:'state', h:'الحالة', opts:[['any','الكل','layers'],['active','النشطة فقط','lib-power']], def:'any' }],
    template: () => [{ id:'sort', h:'الترتيب', opts:[...SORT_BASE, ['vars','الأكثر متغيرات','code']], def:'recent' }, { id:'vars', h:'المتغيرات', opts:[['any','الكل','layers'],['with','بمتغيرات {{ }}','code'],['plain','بدون متغيرات','file']], def:'any' }],
    research: () => [{ id:'sort', h:'الترتيب', opts:[['recent','الأحدث','clock'],['oldest','الأقدم','calendar'],['sources','الأكثر مصادر','layers']], def:'recent' }, { id:'done', h:'الحالة', opts:[['any','كل التقارير','layers'],['full','المكتملة','check'],['partial','الجزئية','alert']], def:'any' }]
  };
  /* مجموعات التبويب الحالي (للمهارات تأتي من صفحتها) */
  const groupsOf = () => EMB[tab] ? (embApi()?.groups() || [])
    : GROUPS[tab]().map(g => ({ ...g, val:() => fget(tab, g.id, g.def), set:v => { fset(tab, g.id, v); } }));
  const dirty = () => groupsOf().some(g => g.val() !== g.def);
  const sorters = {
    recent:  (a, b) => b.ts - a.ts,
    oldest:  (a, b) => a.ts - b.ts,
    name:    (a, b) => a.name.localeCompare(b.name, 'ar'),
    sources: (a, b) => (b.n || 0) - (a.n || 0) || b.ts - a.ts,
    vars:    (a, b) => nVars(b) - nVars(a) || b.ts - a.ts,
    active:  (a, b) => (b.id === activeP && b.kind === 'persona') - (a.id === activeP && a.kind === 'persona') || b.ts - a.ts
  };
  const visible = () => { let a = all();
    if (tab === 'fav') a = a.filter(x => fav.has(key(x))); else if (tab !== 'all') a = a.filter(x => x.kind === tab);
    const g = (n, d) => fget(tab, n, d);
    if ((tab === 'all' || tab === 'fav') && g('type', 'any') !== 'any') a = a.filter(x => x.kind === g('type', 'any'));
    if (tab === 'persona' && g('state', 'any') === 'active') a = a.filter(x => x.id === activeP);
    if (tab === 'template'){ const v = g('vars', 'any'); if (v === 'with') a = a.filter(x => nVars(x) > 0); else if (v === 'plain') a = a.filter(x => !nVars(x)); }
    if (tab === 'research'){ const v = g('done', 'any'); if (v === 'full') a = a.filter(x => !x.partial); else if (v === 'partial') a = a.filter(x => x.partial); }
    if (query) a = a.filter(x => (x.name+' '+(x.hay||x.text)).toLowerCase().includes(query));
    return a.sort(sorters[g('sort', 'recent')] || sorters.recent); };

  /* شريط التحديد المتعدد (مشترك بين البطاقات والمهارات) */
  function syncBar(){
    const sk = EMB[tab] && embApi(), n = sk ? sk.selCount() : sel.size, v = sk ? [] : visible();
    $l('lbAll').textContent = (sk ? sk.allSelected() : (v.length && v.every(x => sel.has(key(x))))) ? 'إلغاء التحديد' : 'تحديد الكل';
    $l('lbDel').disabled = !n; $l('lbOk').disabled = !n;
    $l('lbCnt').textContent = n ? n + ' محدد' : '';
  }
  window.__libSync = syncBar;
  function paintTabs(a){
    a = a || all();
    $l('lbTabs').innerHTML = TABS.map(([k,l]) => {
      const n = EMB[k] ? embCount(k) : k==='all' ? a.length : k==='fav' ? a.filter(x => fav.has(key(x))).length : a.filter(x => x.kind===k).length;
      return `<button class="lib-tab ${tab===k?'on':''}" data-tab="${k}">${l}<small>${n}</small></button>`; }).join('');
    const on = $l('lbTabs').querySelector('.lib-tab.on');   /* التبويب النشط يظهر دائمًا ولو كان خارج الشاشة */
    if (on) requestAnimationFrame(() => { try{ on.scrollIntoView({ inline:'center', block:'nearest' }); }catch{} });
  }
  window.__libCounts = () => { if (main.classList.contains('lib-open')) paintTabs(); };
  function render(){
    const a = all();
    paintTabs(a);
    const emb = EMB[tab], api = embApi();
    $l('libView').dataset.section = tab;
    $l('lbGrid').hidden = !!emb;
    $l('skillsMount').hidden = !emb;
    Object.entries(EMB).forEach(([k, e]) => { const v = $l(e.view); if (v) v.hidden = k !== tab; });
    $l('lbQ').placeholder = emb ? emb.ph : 'ابحث في المكتبة…';
    $l('lbOk').hidden = !(api && api.approve);
    $l('lbAdd').hidden = !!api && !api.addMenu;
    $l('lbMulti').hidden = !!api && !api.setMulti;
    if (emb && !api?.setMulti) multi = false;
    if (api){ api.setQuery?.(query); api.refresh?.(); }
    paintSortBtn();
    $l('lbSortBtn').hidden = !!emb && !groupsOf().length;
    const v = emb ? [] : visible();
    $l('libView').classList.toggle('lib-sm', multi);
    $l('lbMulti').classList.toggle('on', multi);
    $l('lbBar').classList.toggle('show', multi);
    syncBar();
    $l('lbGrid').innerHTML = v.length ? v.map(card).join('') : (tab === 'research' ? '<div class="lib-empty">لا توجد تقارير بحث عميق بعد.<br>فعّل «بحث عميق» من قائمة (+) في المحادثة ثم اكتب سؤالك.</div>' : '<div class="lib-empty">لا توجد عناصر هنا بعد.<br>اضغط «إضافة عنصر» لإنشاء قالب أو شخصية.</div>');
  }
  function card(x){
    const k = key(x), f = fav.has(k), isA = x.kind==='persona' && x.id===activeP;
    let items = `<button data-a="rename">${ic('lib-edit')}إعادة تسمية</button><button data-a="fav">${ic('lib-star')}${f?'إزالة من المفضلة':'إضافة للمفضلة'}</button>`;
    if (x.kind==='research') items = `<button data-a="open">${ic('eye')}عرض التقرير</button>` + items;
    if (x.kind==='persona') items += `<button data-a="activate">${ic('lib-power')}${isA?'إلغاء التنشيط':'تنشيط'}</button>`;
    items += `<button class="d" data-a="del">${ic('trash')}حذف</button>`;
    const act = x.kind==='template' ? '<button class="lib-btn pri" data-a="use" style="height:34px">استخدام</button>'
              : x.kind==='chat' || x.kind==='research' ? '<button class="lib-btn" data-a="open" style="height:34px">'+(x.kind==='research'?'عرض':'فتح')+'</button>' : '';
    const star = f ? `<span class="lib-star">${ic('lib-star').replace('<svg class="i"','<svg class="i" style="fill:currentColor;width:16px;height:16px"')}</span>` : '';
    return `<div class="lib-card ${sel.has(k)?'sel':''} ${isA?'is-active':''}" data-k="${k}" data-kind="${x.kind}" data-id="${x.id}">
      <div class="lib-row"><span class="lib-chk">${ic('check')}</span><span class="lib-badge">${KIND[x.kind]}</span>${isA?'<span class="lib-badge ok">نشطة</span>':''}${star}
        <div class="lib-menu" ${f?'':'style="margin-inline-start:auto"'}><button class="lib-ib" data-a="menu" style="width:34px;height:34px">${ic('more')}</button><div class="lib-pop">${items}</div></div></div>
      <h3>${esc(x.name)}</h3><p>${esc(x.text)}</p>
      <div class="lib-foot"><span class="meta">${x.kind==='research'?x.n+' مصدرًا · '+new Date(x.ts).toLocaleDateString('ar'):x.kind==='chat'?x.n+' رسالة':x.kind==='template'&&tplVars(x.text).size?'{{ }} '+tplVars(x.text).size+(tplVars(x.text).size>2?' متغيرات':' متغير'):''}</span>${act}</div></div>`;
  }
  const main = document.querySelector('.main');
  function openLib(){ main.classList.remove('set-open','pf-open','ch-open','md-open','vo-open'); main.classList.add('lib-open'); multi = false; sel.clear(); Object.values(EMB).forEach(e => e.api()?.setMulti?.(false)); render(); if (typeof closeDrawer==='function') closeDrawer(); }
  function closeLib(){ main.classList.remove('lib-open'); renderAll(); }
  window.__openLib = openLib;
  function paintSortBtn(){
    const b = $l('lbSortBtn'); b.classList.toggle('on', dirty());
    b.title = 'ترشيح وترتيب: ' + TLABEL[tab];
  }
  function paintSort(){
    const m = $l('lbSortMenu'), gs = groupsOf(), n = EMB[tab] ? (embApi()?.count() || 0) : all().filter(x => tab === 'all' ? true : tab === 'fav' ? fav.has(key(x)) : x.kind === tab).length;
    m.innerHTML = `<div class="sort-h">${TLABEL[tab]} · ${n}</div>` + gs.map((g, gi) => (gs.length > 1 ? `<div class="sort-g">${g.h}</div>` : '') +
      g.opts.map(([k, l, i]) => { const on = g.val() === k; return `<button data-g="${gi}" data-v="${esc(k)}" class="${on ? 'sel' : ''}">${ic(i)}<span>${esc(l)}</span>${on ? ic('check', 'ck') : ''}</button>`; }).join('')).join('');
  }
  $l('lbSortBtn').addEventListener('click', e => { e.stopPropagation(); paintSort(); openMenu($l('lbSortMenu'), $l('lbSortBtn')); });
  $l('lbSortMenu').addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('[data-g]'); if (!b) return;
    const gs = groupsOf(), g = gs[+b.dataset.g]; if (!g) return;
    g.set(b.dataset.v); render();
    if (gs.length > 1) paintSort(); else closeMenus();
  });
  window.__libSetMulti = on => { multi = !!on; sel.clear(); render(); };
  window.__libRefresh = () => { if (main.classList.contains('lib-open')) render(); };
  window.__libTab = () => tab; window.__libSetTab = t => { tab = t; }; window.__libTabs = TABS.map(x => x[0]);
  $l('navLib').addEventListener('click', openLib);
  ['chatList','newChat','topNew'].forEach(id => $l(id)?.addEventListener('click', () => main.classList.remove('lib-open','set-open','pf-open','ch-open','md-open','vo-open')));
  $l('lbMenu').addEventListener('click', () => $l('toggleSidebar').click());
  $l('lbSearchBtn').addEventListener('click', () => { const s = $l('lbSearch'); s.classList.toggle('show');
    if (s.classList.contains('show')) $l('lbQ').focus(); else { query=''; $l('lbQ').value=''; render(); } });
  $l('lbQ').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); render(); });
  $l('lbMulti').addEventListener('click', () => { multi = !multi; sel.clear(); embApi()?.setMulti?.(multi); render(); });
  $l('lbAll').addEventListener('click', () => { if (EMB[tab]){ embApi()?.selectAll(); return; } const v = visible(), every = v.length && v.every(x => sel.has(key(x)));
    v.forEach(x => every ? sel.delete(key(x)) : sel.add(key(x))); render(); });
  $l('lbOk').addEventListener('click', () => { embApi()?.approve?.(); multi = false; render(); });
  $l('lbDel').addEventListener('click', () => { if (EMB[tab]){ Promise.resolve(embApi()?.remove()).then(ok => { if (ok){ multi = false; render(); } }); return; } dlg('حذف ' + sel.size + ' عنصر؟', '<p style="color:var(--text-2);line-height:1.8">لا يمكن التراجع عن الحذف.</p>',
    () => { removeKeys([...sel]); sel.clear(); multi = false; render(); toast('تم الحذف'); }, true); });

  document.addEventListener('click', e => {
    if (!main.classList.contains('lib-open')) return;
    if (!e.target.closest('.lib-menu')) document.querySelectorAll('.lib-pop.show').forEach(p => p.classList.remove('show'));
    const t = e.target.closest('[data-tab]'); if (t && t.closest('#lbTabs')){ if (t.dataset.tab !== tab){ multi = false; sel.clear(); embApi()?.setMulti?.(false); } tab = t.dataset.tab; closeMenus(); window.__syncHash?.(); return render(); }
    const c = e.target.closest('.lib-card'); if (!c || !c.closest('#lbGrid')) return;
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (multi){ const k = c.dataset.k; sel.has(k) ? sel.delete(k) : sel.add(k); return render(); }
    if (a === 'menu'){ const p = c.querySelector('.lib-pop'), was = p.classList.contains('show');
      document.querySelectorAll('.lib-pop.show').forEach(x => x.classList.remove('show')); if (!was) p.classList.add('show'); return; }
    if (a) act(a, c.dataset.kind, c.dataset.id);
    else if (c.dataset.kind === 'research') act('open', 'research', c.dataset.id);
  });
  document.querySelectorAll('.lib-ov').forEach(o => o.addEventListener('click', e => {
    if (e.target === o || e.target.closest('[data-lbclose]')) o.classList.remove('show'); }));

  function dlg(title, body, ok, danger){
    $l('lbDTitle').textContent = title; $l('lbDBody').innerHTML = body;
    const b = $l('lbDOk'); b.className = 'lib-btn ' + (danger ? 'dng' : 'pri'); b.onclick = () => { ok(); $l('lbOvDlg').classList.remove('show'); };
    $l('lbOvDlg').classList.add('show'); const i = $l('lbDBody').querySelector('input'); if (i){ i.focus(); i.select(); }
  }
  function removeKeys(keys){
    const rk = keys.filter(k => k.startsWith('research:')).map(k => k.slice(9)); if (rk.length) rsDB.del(rk);
    lib = lib.filter(x => !keys.includes(key(x))); keys.forEach(k => fav.delete(k));
    if (activeP && !lib.some(x => x.id === activeP)){ activeP = null; store.remove('ai_active_persona'); }
    saveLib();
  }
  function act(a, kind, id){
    const k = kind + ':' + id, x = all().find(z => key(z) === k); if (!x) return;
    if (x.kind === 'research'){
      if (a === 'open'){ rsDB.get(id) ? window.rsOpenReader(id) : toast('التقرير محذوف'); return; }
      if (a === 'rename'){ dlg('إعادة تسمية', `<label class="lib-f">الاسم الجديد<input type="text" id="lbRn" value="${esc(x.name)}" maxlength="120"></label>`, () => { const n = $l('lbRn').value.trim(), r = rsDB.get(id); if (!n || !r) return; r.title = n; rsDB.save(); render(); toast('تمت إعادة التسمية'); }); return; }
    }
    if (a === 'fav'){ fav.has(k) ? fav.delete(k) : fav.add(k); saveLib(); render(); toast(fav.has(k) ? 'أُضيف للمفضلة' : 'أُزيل من المفضلة'); }
    else if (a === 'del') dlg('حذف «' + x.name + '»؟', '<p style="color:var(--text-2);line-height:1.8">لا يمكن التراجع عن الحذف.</p>', () => { removeKeys([k]); render(); toast('تم الحذف'); }, true);
    else if (a === 'rename') dlg('إعادة تسمية', `<label class="lib-f">الاسم الجديد<input type="text" id="lbRn" value="${esc(x.name)}" maxlength="80"></label>`, () => {
      const n = $l('lbRn').value.trim(); if (!n) return;
      lib.find(z => z.id === id).name = n; saveLib();
      const ap = store.get('ai_active_persona', null); if (ap?.id === id) store.set('ai_active_persona', {...ap, name:n});
      render(); toast('تمت إعادة التسمية'); });
    else if (a === 'activate'){
      if (activeP === id){ activeP = null; store.remove('ai_active_persona'); toast('أُلغي تنشيط الشخصية'); }
      else { activeP = id; store.set('ai_active_persona', {id, name:x.name, prompt:x.text}); toast('تم تنشيط «' + x.name + '»'); }
      render(); }
    else if (a === 'use'){ fillTemplate(x.text, x.name, txt => { closeLib(); el.input.value = txt; autosize(); updateSendState(); el.input.focus(); }); }
  }
  window.__libTemplates = () => lib.filter(x => x.kind === 'template'); window.__dlg = dlg;
  window.__libItems = () => lib.filter(x => x.kind === 'template' || x.kind === 'persona');
  window.__libActive = () => activeP;
  window.__libTogglePersona = id => act('activate', 'persona', id);
  $l('lbAdd').addEventListener('click', e => { if (EMB[tab]){ embApi()?.addMenu?.($l('lbAdd')); return; } $l('lbName').value = ''; $l('lbText').value = '';
    document.querySelector('input[name=lbType][value=' + (tab==='persona' ? 'persona' : 'template') + ']').checked = true;
    $l('lbOvAdd').classList.add('show'); $l('lbName').focus(); });
  $l('lbSave').addEventListener('click', () => {
    const name = $l('lbName').value.trim(), text = $l('lbText').value.trim();
    if (!name || !text) return toast('أدخل الاسم والمحتوى');
    const kind = document.querySelector('input[name=lbType]:checked').value;
    lib.unshift({id:uid(), kind, name, text, ts:Date.now()}); saveLib(); $l('lbOvAdd').classList.remove('show');
    if (tab === 'chat' || (tab !== 'all' && tab !== 'fav' && tab !== kind)) tab = kind;
    render(); toast('تمت الإضافة'); });
})();

