/* QUARK AI — صفحة المهارات: القائمة، المحرّر، الاستيراد/التصدير، الاستخراج، التجربة، الإعدادات */
'use strict';
(() => {
  const view = $('skView'); if (!view) return;
  let q = '', chip = 'all', tag = '', sort = store.get('ai_sk_sort', 'name'), selMode = false;
  if (!['name', 'uses', 'recent'].includes(sort)) sort = 'name';
  const sel = new Set(), collapsed = new Set();
  const SRC = { builtin:'مدمجة', import:'مستوردة', extracted:'مستخرجة', manual:'' };
  const STT = { published:'منشورة', draft:'مسودة', off:'موقوفة' };
  const fold = x => skFold(x);
  const ago = ts => { if (!ts) return 'لم تُستخدم'; const d = Date.now() - ts, m = Math.round(d / 60000), h = Math.round(d / 3600000), dd = Math.round(d / 86400000); return 'آخر استخدام ' + (m < 2 ? 'الآن' : m < 60 ? `منذ ${m} د` : h < 48 ? `منذ ${h} س` : `منذ ${dd} يوم`); };
  const overlay = (title, bodyHtml, right = '') => {
    const ov = document.createElement('div'); ov.className = 'rs-ov';
    ov.innerHTML = `<div class="rs-ovh"><button class="lib-ib" data-x aria-label="إغلاق">${ic('x')}</button><h3 dir="auto">${esc(title)}</h3>${right}</div><div class="rs-ovb">${bodyHtml}</div>`;
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); ov._onClose?.(); };
    const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.querySelector('[data-x]').addEventListener('click', close);
    document.body.appendChild(ov); ov.close = close; return ov;
  };

  /* ---------- الرسم ---------- */
  function filtered(){
    const n = fold(q.trim());
    let l = skDB.list().filter(s => (chip === 'all' || s.status === chip) && (!tag || (s.tags || []).includes(tag)) &&
      (!n || fold([s.name, s.description, s.when, (s.tags || []).join(' '), s.category, s.body].join(' ')).includes(n)));
    if (sort === 'uses') l.sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name, 'ar'));
    else if (sort === 'recent') l.sort((a, b) => b.updatedAt - a.updatedAt);
    else l.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    return l;
  }
  function card(s, dupes){
    return `<div class="sk-card ${s.status === 'off' ? 'off' : s.status}${sel.has(s.id) ? ' sel' : ''}" data-s="${s.id}">
      <div class="tk-row"><div class="tk-nm" dir="auto">${esc(s.name)}</div><span class="sk-pill ${s.status === 'published' ? 'on' : s.status === 'draft' ? 'draft' : ''}">${STT[s.status]}</span>${SRC[s.source] ? `<span class="sk-pill">${SRC[s.source]}</span>` : ''}${dupes.has(s.id) ? '<span class="sk-pill dup" title="مشابهة لـ ' + esc(dupes.get(s.id)) + '">مكررة؟</span>' : ''}
        ${selMode ? '' : `<button type="button" class="tk-more" data-a="menu" aria-label="المزيد">${ic('more')}</button>`}</div>
      ${s.description ? `<div class="tk-sub" dir="auto">${esc(rsCut(s.description, 140))}</div>` : ''}
      ${s.when ? `<div class="tk-sub" dir="auto"><b>متى:</b> ${esc(rsCut(s.when, 120))}</div>` : ''}
      ${(s.tags || []).length ? `<div class="sk-tags">${s.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="rs-meta"><span>${s.uses ? `استُخدمت ${s.uses} مرة` : 'لم تُستخدم'}</span><span>${esc(ago(s.lastUsed))}</span></div></div>`;
  }
  function paint(){
    const all = skDB.list(), cnt = { all:all.length, published:0, draft:0, off:0 }; all.forEach(s => { cnt[s.status]++; });
    $('skSummary').textContent = `${all.length} مهارة · ${cnt.published} منشورة${cnt.draft ? ` · ${cnt.draft} مسودة` : ''} · ${all.reduce((n, s) => n + (s.uses || 0), 0)} استخدامًا${settings.skills.enabled ? '' : ' · المطابقة التلقائية متوقفة'}`;
    if (tag && !all.some(s => (s.tags || []).includes(tag))) tag = '';
    const l = filtered(), dupes = skDupes();
    if (!l.length){ $('skList').innerHTML = `<div class="rs-empty">${all.length ? 'لا نتائج مطابقة.' : 'لا توجد مهارات. اضغط + لإضافة مهارة.'}</div>`; }
    else {
      const groups = new Map(); l.forEach(s => { const c = s.category || 'عام'; (groups.get(c) || groups.set(c, []).get(c)).push(s); });
      $('skList').innerHTML = [...groups].map(([c, arr]) => (groups.size > 1 ? `<div class="sk-cat">${esc(c)} · ${arr.length}</div>` : '') + arr.map(s => card(s, dupes)).join('')).join('');
    }
    window.__libSync?.();
  }

  /* ---------- المحرّر ---------- */
  function openEditor(existing, draft){
    const s = existing ? JSON.parse(JSON.stringify(existing)) : (draft || skNew());
    const cats = [...new Set(['عام', 'كتابة', 'برمجة', 'تحليل', 'تعليم', ...skDB.list().map(x => x.category)])];
    const ov = overlay(existing ? 'تعديل المهارة' : 'مهارة جديدة', `<div class="tk-form">
      <label><small>الاسم</small><input class="fld" id="skeName" maxlength="80" value="${esc(s.name)}"></label>
      <label><small>الوصف (ماذا تفعل؟)</small><input class="fld" id="skeDesc" maxlength="400" value="${esc(s.description)}"></label>
      <label><small>متى تُستخدم؟ (أساس المطابقة التلقائية — كن محددًا)</small><textarea id="skeWhen" style="min-height:70px">${esc(s.when)}</textarea></label>
      <div class="tk-g2"><label><small>الفئة</small><input class="fld" id="skeCat" list="skeCats" value="${esc(s.category)}"><datalist id="skeCats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label><small>الحالة</small><select class="fld" id="skeStat"><option value="published">منشورة (تُطابَق تلقائيًا)</option><option value="draft">مسودة</option><option value="off">موقوفة</option></select></label></div>
      <label><small>الوسوم (افصل بفاصلة)</small><input class="fld" id="skeTags" value="${esc((s.tags || []).join('، '))}"></label>
      <label><small>التعليمات (Markdown)</small><textarea class="sk-body" id="skeBody" spellcheck="false" placeholder="1. ...&#10;2. ...">${esc(s.body)}</textarea></label>
      ${existing ? '<div class="rs-acts"><button class="lib-btn" data-a="test">تجربة</button><button class="lib-btn" data-a="export">تصدير SKILL.md</button><button class="lib-btn" data-a="dup">تكرار</button><button class="lib-btn danger" data-a="del">حذف</button></div>' : ''}</div>`,
      `<button class="lib-btn pri" data-save style="height:38px;padding:0 18px">حفظ</button>`);
    const g = id => ov.querySelector('#' + id); g('skeStat').value = s.status;
    const read = () => ({ name:g('skeName').value.trim(), description:g('skeDesc').value.trim(), when:g('skeWhen').value.trim(), category:g('skeCat').value.trim() || 'عام', status:g('skeStat').value,
      tags:g('skeTags').value.split(/[,،]/).map(x => x.trim().replace(/^#/, '')).filter(Boolean).slice(0, 12), body:g('skeBody').value.trim() });
    ov.querySelector('[data-save]').addEventListener('click', () => {
      const v = read();
      if (!v.name){ toast('أدخل اسم المهارة'); return; }
      if (v.body.length < 10){ toast('اكتب تعليمات المهارة'); return; }
      if (!v.when && !v.description && v.status === 'published'){ toast('أضف وصفًا أو «متى تُستخدم» لتُطابَق تلقائيًا'); return; }
      Object.assign(s, v, { updatedAt:Date.now() });
      if (existing) Object.assign(existing, s); else { s.source = s.source || 'manual'; skDB.add(s); }
      skDB.save(); ov.close(); paint(); toast('تم الحفظ');
    });
    ov.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a || !existing) return;
      if (a === 'test'){ Object.assign(existing, read()); openTest(existing); }
      else if (a === 'export') exportOne(existing);
      else if (a === 'dup'){ ov.close(); dup(existing); }
      else if (a === 'del'){ if (await qConfirm('حذف هذه المهارة نهائيًا؟', { ok:'حذف' })){ skDB.del(existing.id); ov.close(); paint(); toast('تم الحذف'); } }
    });
    if (!existing) setTimeout(() => g('skeName').focus(), 80);
  }
  function dup(s){ const c = { ...JSON.parse(JSON.stringify(s)), id:uid(), name:s.name + ' (نسخة)', uses:0, lastUsed:0, createdAt:Date.now(), updatedAt:Date.now(), source:'manual', status:'draft' }; skDB.add(c); paint(); toast('أُنشئت نسخة كمسودة'); }
  const safe = n => String(n).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
  function exportOne(s){ saveFile(new Blob([skEmit(s)], { type:'text/markdown;charset=utf-8' }), safe(s.name) + '.SKILL.md'); }
  function exportAll(){
    const arr = skDB.list().map(({ name, description, when, body, tags, category, status }) => ({ name, description, when, body, tags, category, status }));
    saveFile(new Blob([JSON.stringify({ format:'quark-skills', version:1, skills:arr }, null, 2)], { type:'application/json' }), 'quark-skills.json');
  }

  /* ---------- التجربة ---------- */
  function openTest(s){
    let ctl = null;
    const ov = overlay('تجربة: ' + s.name, `<div class="tk-form"><label><small>اكتب طلبًا تجريبيًا لترى كيف تؤثر المهارة في الرد</small><textarea id="skTin" placeholder="مثال: اكتب بريدًا أطلب فيه موعدًا"></textarea></label>
      <div class="rs-acts"><button class="lib-btn pri" id="skTgo">تشغيل</button></div><div class="sk-test" id="skTout" dir="auto">سيظهر الرد هنا.</div></div>`);
    ov._onClose = () => ctl?.abort();
    ov.querySelector('#skTgo').addEventListener('click', async () => {
      const b = ov.querySelector('#skTgo'), out = ov.querySelector('#skTout');
      if (ctl){ ctl.abort(); return; }
      const sample = ov.querySelector('#skTin').value.trim(); if (!sample){ toast('اكتب طلبًا تجريبيًا'); return; }
      ctl = new AbortController(); b.textContent = 'إيقاف'; out.textContent = '…'; let acc = '';
      try{ for await (const ch of skTestRun(s, sample, ctl.signal)){ acc += ch; out.textContent = splitThink(acc).ans || '…'; } if (!acc) out.textContent = 'لم يُرجع النموذج ردًا.'; }
      catch(e){ if (e.name !== 'AbortError') out.textContent = 'تعذّر: ' + e.message; }
      ctl = null; b.textContent = 'تشغيل';
    });
  }

  /* ---------- الاستيراد/الاستخراج ---------- */
  function addImported(list){
    let n = 0;
    list.forEach(s => { const have = new Set(skDB.list().map(x => fold(x.name))); let nm = s.name, i = 2; while (have.has(fold(nm))) nm = `${s.name} (${i++})`; s.name = nm; skDB.add(s); n++; });
    paint(); return n;
  }
  async function importUrl(){
    const url = await rsAsk1('استيراد مهارة من رابط', 'رابط ملف SKILL.md (GitHub أو أي رابط مباشر)', 'استيراد'); if (!url) return;
    toast('جارٍ الجلب…');
    try{ const s = await skImportUrl(url.trim()); addImported([s]); toast('تم الاستيراد'); openEditor(skDB.get(s.id)); }
    catch(e){ toast('تعذّر الاستيراد: ' + e.message); }
  }
  async function importPaste(){
    const txt = await rsAsk1('لصق SKILL.md', 'ألصق محتوى الملف كاملًا (يبدأ بـ ---)', 'استيراد'); if (!txt) return;
    try{ const s = skFromText(txt, { source:'import' }); addImported([s]); toast('تم الاستيراد'); }catch(e){ toast(e.message); }
  }
  function importFile(){
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.md,.txt,.json,text/markdown,text/plain,application/json';
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      try{
        const txt = await f.text(); let list = [];
        if (/\.json$/i.test(f.name) || txt.trim().startsWith('{') || txt.trim().startsWith('[')){
          const j = JSON.parse(txt), arr = Array.isArray(j) ? j : j.skills;
          if (!Array.isArray(arr)) throw new Error('ملف JSON غير معروف');
          list = arr.filter(x => x && x.name && x.body).slice(0, 200).map(x => skNew({ name:rsCut(String(x.name), 80), description:rsCut(String(x.description || ''), 400), when:rsCut(String(x.when || x.when_to_use || ''), 400), body:String(x.body).slice(0, 20000),
            tags:(Array.isArray(x.tags) ? x.tags : []).map(String).slice(0, 12), category:rsCut(String(x.category || 'عام'), 30), status:['published', 'draft', 'off'].includes(x.status) ? x.status : 'published', source:'import' }));
        } else list = [skFromText(txt, { source:'import' })];
        if (!list.length) throw new Error('لا مهارات صالحة في الملف');
        toast(`تم استيراد ${addImported(list)} مهارة`);
      }catch(e){ toast('تعذّر الاستيراد: ' + e.message); }
    });
    inp.click();
  }
  function extractFlow(){
    const list = chats.filter(c => !c.temp && c.messages.length >= 2).slice(0, 40);
    if (!list.length){ toast('لا توجد محادثات كافية'); return; }
    const ov = overlay('استخراج مهارة من محادثة', `<div class="tk-hist"><div class="tk-sub">اختر محادثة ناجحة، وسيقترح النموذج مهارة منها تُحفظ ${settings.skills.autoApprove ? 'منشورة' : 'كمسودة لتراجعها'}.</div>${list.map((c, i) => `<button type="button" class="tk-pre" data-i="${i}"><b>${esc(rsCut(c.title || 'محادثة', 60))}</b><span>${c.messages.length} رسالة · ${new Date(c.ts || Date.now()).toLocaleDateString('ar')}</span></button>`).join('')}</div>`);
    let busy2 = false;
    ov.addEventListener('click', async e => {
      const b = e.target.closest('[data-i]'); if (!b || busy2) return; busy2 = true;
      const c = list[+b.dataset.i]; b.querySelector('span').textContent = 'جارٍ التحليل…';
      try{
        const found = await skExtract(c);
        if (!found.length){ toast('لم أجد نمطًا يستحق الحفظ في هذه المحادثة'); busy2 = false; b.querySelector('span').textContent = 'جرّب محادثة أخرى'; return; }
        addImported(found); ov.close(); toast(`استُخرجت ${found.length} مهارة`); openEditor(skDB.get(found[0].id));
      }catch(err){ toast('تعذّر الاستخراج: ' + err.message); busy2 = false; b.querySelector('span').textContent = 'حاول مرة أخرى'; }
    });
  }

  /* ---------- الإعدادات ---------- */
  function renderSkillSettings(){
    const c = settings.skills;
    const ov = $('skillsSettingsRoot'); if (!ov) return;
    ov.innerHTML = `<div class="rs-set">
      <label style="flex-direction:row;align-items:center;justify-content:space-between"><small style="font-size:14px">المطابقة التلقائية للمهارات</small><input type="checkbox" class="sw" id="sksOn"></label>
      <div class="hint2">عند التفعيل تُحقن المهارات المنشورة الأنسب لطلبك في سياق النموذج تلقائيًا. تظهر أسفل الرد شارة بالمهارات المستخدمة. ويمكنك تثبيت مهارة يدويًا بكتابة / في خانة الرسالة.</div>
      <div class="row2"><label><small>أقصى عدد مهارات تُحقن</small><select class="fld" id="sksMax">${[1, 2, 3, 4, 5].map(n => `<option>${n}</option>`).join('')}</select></label>
      <label><small>حساسية المطابقة</small><select class="fld" id="sksSens">${Object.entries(SK_SENS).map(([k, v]) => `<option value="${k}">${v.l}</option>`).join('')}</select></label></div>
      <label style="flex-direction:row;align-items:center;justify-content:space-between"><small style="font-size:14px">اعتماد المهارات المستخرجة تلقائيًا</small><input type="checkbox" class="sw" id="sksAuto"></label>
      <div class="rs-acts"><button class="lib-btn" id="sksStart">استعادة المهارات المدمجة</button><button class="lib-btn" id="sksExp">تصدير الكل (JSON)</button></div>
      <div class="hint2">المهارات تُحفظ في هذا الجهاز. محتواها إرشادات تقرؤها النماذج التي تستخدمها، فلا تضع فيها أسرارًا.</div></div>`;
    const g = id => ov.querySelector('#' + id);
    g('sksOn').checked = c.enabled; g('sksMax').value = c.max; g('sksSens').value = c.sens; g('sksAuto').checked = c.autoApprove;
    const commit = () => { c.enabled = g('sksOn').checked; c.max = Number(g('sksMax').value) || 2; c.sens = g('sksSens').value; c.autoApprove = g('sksAuto').checked; persistSettings(); paint(); };
    ov.onchange = commit;
    g('sksExp').addEventListener('click', exportAll);
    g('sksStart').addEventListener('click', () => { const have = new Set(skDB.list().map(x => fold(x.name))); const add = SK_STARTERS.filter(s => !have.has(fold(s.name))).map(s => skNew({ ...s, source:'builtin' })); add.forEach(s => skDB.add(s)); paint(); toast(add.length ? `أُعيدت ${add.length} مهارة` : 'كل المهارات المدمجة موجودة'); });
  }

  /* ---------- قائمة الإضافة والبطاقة ---------- */
  function menu(anchor, items){
    document.querySelectorAll('.tk-menu').forEach(m => m.remove());
    const m = document.createElement('div'); m.className = 'tk-menu';
    m.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}"${it.d ? ' class="dng"' : ''}>${esc(it.l)}</button>`).join('');
    const r = anchor.getBoundingClientRect(); document.body.appendChild(m);
    m.style.top = Math.min(innerHeight - m.offsetHeight - 10, r.bottom + 4) + 'px'; m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.left)) + 'px';
    const off = e => { if (!m.contains(e.target)){ m.remove(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
    m.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; m.remove(); document.removeEventListener('pointerdown', off, true); items[+b.dataset.i].f(); });
  }

  /* ---------- الأحداث ---------- */
  window.__renderSkillSettings = renderSkillSettings;
  const openSkillSettings = () => {
    openSettings('custom'); $('skillsSettingsDetails').open = true;
    requestAnimationFrame(() => $('skillsSettingsDetails').scrollIntoView({ block:'start' }));
  };
  const addMenu = anchor => menu(anchor, [
    { l:'مهارة جديدة', f:() => openEditor(null) }, { l:'استخراج من محادثة', f:extractFlow }, { l:'استيراد من رابط', f:importUrl },
    { l:'لصق SKILL.md', f:importPaste }, { l:'استيراد من ملف', f:importFile }, { l:'إعدادات المهارات', f:openSkillSettings }]);

  /* واجهة يستعملها رأس المكتبة (بحث / ترشيح / تحديد / إضافة) */
  const STAT = [['all', 'الكل'], ['published', 'منشورة'], ['draft', 'مسودات'], ['off', 'موقوفة']];
  window.__sk = {
    setQuery(v){ if (v !== q){ q = v; paint(); } },
    setMulti(on){ if (selMode !== on || sel.size){ selMode = !!on; sel.clear(); paint(); } },
    selCount: () => sel.size,
    allSelected(){ const l = filtered(); return !!l.length && l.every(x => sel.has(x.id)); },
    selectAll(){ const l = filtered(), every = l.length && l.every(x => sel.has(x.id)); l.forEach(x => every ? sel.delete(x.id) : sel.add(x.id)); paint(); },
    approve(){ let n = 0; sel.forEach(id => { const s = skDB.get(id); if (s && s.status !== 'published'){ s.status = 'published'; n++; } }); skDB.save(); sel.clear(); selMode = false; paint(); toast(n ? 'تم الاعتماد' : 'لا مهارات تحتاج اعتمادًا'); },
    async remove(){ if (!sel.size || !await qConfirm(`حذف ${sel.size} مهارة نهائيًا؟`, { ok:'حذف' })) return false; skDB.del([...sel]); sel.clear(); selMode = false; paint(); toast('تم الحذف'); return true; },
    addMenu, refresh: () => paint(),
    count: () => skDB.list().length,
    /* مجموعات قائمة الترشيح لهذا التبويب */
    groups(){
      const all = skDB.list(), cnt = { all:all.length, published:0, draft:0, off:0 }; all.forEach(s => { cnt[s.status]++; });
      const tc = {}; all.forEach(s => (s.tags || []).forEach(t => { tc[t] = (tc[t] || 0) + 1; }));
      const tops = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const g = [
        { h:'الترتيب', opts:[['name', 'الاسم', 'pen'], ['uses', 'الأكثر استخدامًا', 'flame'], ['recent', 'الأحدث', 'clock']], val:() => sort, set:v => { sort = v; store.set('ai_sk_sort', v); paint(); }, def:'name' },
        { h:'الحالة', opts:STAT.map(([k, l]) => [k, `${l} · ${cnt[k]}`, k === 'all' ? 'layers' : k === 'published' ? 'check' : k === 'draft' ? 'file' : 'eye-off']), val:() => chip, set:v => { chip = v; paint(); }, def:'all' }];
      if (tops.length) g.push({ h:'الوسم', opts:[['', 'كل الوسوم', 'tag'], ...tops.map(([t, n]) => [t, `#${t} · ${n}`, 'tag'])], val:() => tag, set:v => { tag = v; paint(); }, def:'' });
      return g;
    }
  };
  $('skList').addEventListener('click', e => {
    const c = e.target.closest('[data-s]'); if (!c) return; const s = skDB.get(c.dataset.s); if (!s) return;
    if (selMode){ sel.has(s.id) ? sel.delete(s.id) : sel.add(s.id); paint(); return; }
    if (e.target.closest('[data-a="menu"]')){
      menu(e.target.closest('[data-a="menu"]'), [
        s.status === 'draft' ? { l:'اعتماد ونشر', f:() => { s.status = 'published'; skDB.save(); paint(); } } : { l:s.status === 'published' ? 'إيقاف' : 'تفعيل', f:() => { s.status = s.status === 'published' ? 'off' : 'published'; skDB.save(); paint(); } },
        { l:'تعديل', f:() => openEditor(s) }, { l:'تجربة', f:() => openTest(s) }, { l:'تصدير SKILL.md', f:() => exportOne(s) }, { l:'تكرار', f:() => dup(s) },
        { l:'حذف', d:true, f:async () => { if (await qConfirm('حذف هذه المهارة نهائيًا؟', { ok:'حذف' })){ skDB.del(s.id); paint(); toast('تم الحذف'); } } }]);
      return;
    }
    openEditor(s);
  });

  window.__skRefresh = paint;
  window.__openSkills = () => {
    window.__libSetTab('skills'); window.__openLib();
  };
})();
