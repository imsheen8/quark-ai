/* QUARK AI — صفحة الذاكرة: الذكريات (بحث، ترتيب، تصنيف، تحديد، تعديل)، الإضافة والاستيراد، الإعدادات */
'use strict';
(() => {
  const view = $('mmView'); if (!view) return;
  let q = '', cat = 'all', sort = 'newest', tab = 'list', selMode = false, editing = '', tidying = false;
  const sel = new Set();
  const ago = ts => { const d = Date.now() - ts, m = Math.round(d / 60000), h = Math.round(d / 3600000), dd = Math.round(d / 86400000); return m < 2 ? 'الآن' : m < 60 ? `منذ ${m} د` : h < 48 ? `منذ ${h} س` : dd < 60 ? `منذ ${dd} يوم` : `منذ ${Math.round(dd / 30)} شهر`; };
  const SRC = { auto:'تلقائية', import:'مستوردة', chat:'من محادثة', agent:'من الوكيل', manual:'' };
  const catOpts = () => Object.entries(MM_CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  const overlay = (title, bodyHtml, footHtml = '') => {
    const ov = document.createElement('div'); ov.className = 'rs-ov';
    ov.innerHTML = `<div class="rs-ovh"><button class="lib-ib" data-x aria-label="إغلاق">${ic('x')}</button><h3 dir="auto">${esc(title)}</h3></div><div class="rs-ovb">${bodyHtml}</div>${footHtml ? `<div class="rs-foot">${footHtml}</div>` : ''}`;
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.querySelector('[data-x]').addEventListener('click', close);
    document.body.appendChild(ov); ov.close = close; return ov;
  };
  function menu(anchor, items){
    document.querySelectorAll('.tk-menu').forEach(m => m.remove());
    const m = document.createElement('div'); m.className = 'tk-menu';
    m.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}"${it.d ? ' class="dng"' : ''}>${esc(it.l)}</button>`).join('');
    const r = anchor.getBoundingClientRect(); document.body.appendChild(m);
    m.style.top = Math.max(8, Math.min(innerHeight - m.offsetHeight - 10, r.bottom + 4)) + 'px'; m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.left)) + 'px';
    const off = e => { if (!m.contains(e.target)){ m.remove(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
    m.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; m.remove(); document.removeEventListener('pointerdown', off, true); items[+b.dataset.i].f(); });
  }

  /* ---------- القائمة ---------- */
  function filtered(){
    const n = mmFold(q.trim());
    const l = mmDB.list().filter(m => (cat === 'all' || m.cat === cat) && (!n || mmFold(m.text + ' ' + (MM_CATS[m.cat] || '')).includes(n)));
    const cmp = { newest:(a, b) => b.createdAt - a.createdAt, oldest:(a, b) => a.createdAt - b.createdAt, alpha:(a, b) => a.text.localeCompare(b.text, 'ar'), uses:(a, b) => (b.uses || 0) - (a.uses || 0) || b.createdAt - a.createdAt }[sort];
    return l.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || cmp(a, b));
  }
  function card(m){
    if (editing === m.id){
      return `<div class="mm-card edit" data-m="${m.id}"><textarea class="fld mm-ed" id="mmEd" rows="3" maxlength="400" dir="auto">${esc(m.text)}</textarea>
        <div class="mm-edrow"><select class="fld" id="mmEdCat">${catOpts()}</select><span style="flex:1"></span>
        <button type="button" class="lib-btn" data-a="cancel">إلغاء</button><button type="button" class="lib-btn pri" data-a="save">حفظ</button></div></div>`;
    }
    const src = SRC[m.source];
    return `<div class="mm-card${m.pinned ? ' pin' : ''}${sel.has(m.id) ? ' sel' : ''}" data-m="${m.id}">
      ${selMode ? `<span class="mm-ck${sel.has(m.id) ? ' on' : ''}">${sel.has(m.id) ? ic('check') : ''}</span>` : ''}
      <div class="mm-main"><div class="mm-txt" dir="auto">${esc(m.text)}</div>
        <div class="rs-meta"><span class="mm-cat c-${m.cat}">${MM_CATS[m.cat] || 'معلومة'}</span>${m.pinned ? `<span class="mm-pinned" title="مثبّتة">${ic('lib-star')} مثبّتة</span>` : ''}${src ? `<span>${src}</span>` : ''}<span>${ago(m.updatedAt)}</span>${m.uses ? `<span>استُخدمت ${m.uses}</span>` : ''}</div></div>
      ${selMode ? '' : `<button type="button" class="tk-more" data-a="menu" aria-label="المزيد">${ic('more')}</button>`}</div>`;
  }
  function paint(){
    const all = mmDB.list(), cfg = settings.memory;
    $('mmN').textContent = `${all.length} ذكرى`;
    $('mmOn').checked = cfg.enabled; $('mmSetAuto').checked = cfg.auto; $('mmSetMax').value = String(cfg.max);
    view.classList.toggle('off', !cfg.enabled);
    const cnt = { all:all.length }; all.forEach(m => { cnt[m.cat] = (cnt[m.cat] || 0) + 1; });
    if (cat !== 'all' && !cnt[cat]) cat = 'all';
    $('mmChips').innerHTML = [['all', 'الكل'], ...Object.entries(MM_CATS).filter(([k]) => cnt[k])].map(([k, l]) => `<button type="button" data-c="${k}" class="${cat === k ? 'on' : ''}">${l} ${cnt[k]}</button>`).join('');
    const l = filtered();
    $('mmList').innerHTML = l.length ? l.map(card).join('') :
      `<div class="rs-empty">${all.length ? 'لا نتائج مطابقة.' : `لا توجد ذكريات بعد 🙂<br><a href="#" class="mm-link" data-go="add">أضف ذكرى أو استوردها من القسم أدناه</a>`}</div>`;
    $('mmSel').classList.toggle('on', selMode);
    $('mmBulk').hidden = !selMode; $('mmBulkN').textContent = `${sel.size} محدد`;
    $('mmBulkPin').disabled = $('mmBulkDel').disabled = !sel.size;
    $('mmAll').checked = !!l.length && l.every(m => sel.has(m.id));
    const u = all.reduce((n, m) => n + (m.uses || 0), 0), pins = all.filter(m => m.pinned).length, auto = all.filter(m => m.source === 'auto').length;
    $('mmStats').innerHTML = `<b>${all.length}</b> ذكرى · <b>${pins}</b> مثبّتة · <b>${auto}</b> تلقائية · استُخدمت <b>${u}</b> مرة`;
    $('mmWipe').disabled = !all.length;
    if (editing){ const m = mmDB.get(editing); if (m){ $('mmEdCat').value = m.cat; const t = $('mmEd'); if (t && !t.dataset.f){ t.dataset.f = '1'; t.focus(); t.setSelectionRange(t.value.length, t.value.length); } } }
  }
  window.__mmRefresh = paint;
  const setTab = t => {
    tab = t;
    if (t === 'add'){
      $('mmAddDetails').open = true;
      $('mmNew').focus();
    }
    if (t !== 'list'){ selMode = false; sel.clear(); editing = ''; }
    paint();
  };

  /* ---------- ترتيب بالذكاء ---------- */
  async function tidy(){
    if (tidying) return;
    if (mmDB.list().length < 2){ toast('لا يكفي عدد الذكريات للترتيب'); return; }
    tidying = true; const btn = $('mmTidy'); btn.disabled = true; btn.lastChild.textContent = ' جارٍ الترتيب…';
    let plan = null, ai = false;
    try{
      if (mmModel()){ try{ plan = await mmTidyAI(); ai = true; }catch(e){ if (e.name === 'AbortError') throw e; } }
      if (!plan){ plan = mmLocalPlan(); if (mmModel()) toast('تعذّر الترتيب بالنموذج، استُخدم الترتيب المحلي'); }
    }catch{ plan = null; }
    tidying = false; btn.disabled = false; btn.lastChild.textContent = ' ترتيب';
    if (!plan) return;
    if (!plan.merges.length && !plan.dels.length && !plan.recats.length){ toast('الذكريات مرتبة، لا يوجد ما يُدمج أو يُحذف'); return; }
    showPlan(plan, ai);
  }
  function showPlan(plan, ai){
    const t = id => mmDB.get(id)?.text || '';
    const body = `<div class="mm-plan">
      <div class="tk-sub">${ai ? 'اقترح النموذج هذه التغييرات.' : 'تغييرات محلية: دمج المتشابه فقط (لا نموذج متاح).'} راجعها قبل التطبيق.</div>
      ${plan.merges.map(g => `<div class="mm-pl"><div class="mm-pl-h">دمج ${g.ids.length} ذكريات</div>${g.ids.map(id => `<div class="mm-old" dir="auto">${esc(t(id))}</div>`).join('')}<div class="mm-new" dir="auto">${ic('arrow-down')} ${esc(g.text)} <span class="mm-cat c-${g.cat}">${MM_CATS[g.cat]}</span></div></div>`).join('')}
      ${plan.dels.length ? `<div class="mm-pl"><div class="mm-pl-h">حذف ${plan.dels.length}</div>${plan.dels.map(id => `<div class="mm-old" dir="auto">${esc(t(id))}</div>`).join('')}</div>` : ''}
      ${plan.recats.length ? `<div class="mm-pl"><div class="mm-pl-h">تغيير تصنيف ${plan.recats.length}</div>${plan.recats.map(r => `<div class="mm-old" dir="auto">${esc(t(r.id))} <span class="mm-cat c-${r.cat}">← ${MM_CATS[r.cat]}</span></div>`).join('')}</div>` : ''}</div>`;
    const ov = overlay('ترتيب الذاكرة', body, `<button type="button" class="lib-btn" data-x2>إلغاء</button><button type="button" class="lib-btn pri" data-ok>تطبيق</button>`);
    ov.querySelector('[data-x2]').addEventListener('click', ov.close);
    ov.querySelector('[data-ok]').addEventListener('click', () => {
      const r = mmApplyPlan(plan); ov.close(); sel.clear(); paint();
      toast([r.merged ? `دُمجت ${r.merged}` : '', r.deleted ? `حُذفت ${r.deleted}` : '', r.recat ? `صُحّح تصنيف ${r.recat}` : ''].filter(Boolean).join(' · ') || 'تم');
    });
  }

  /* ---------- مقترحات (من ملف أو محادثة) ---------- */
  function showCands(title, cands){
    if (!cands.length){ toast('لم أجد ما يستحق الحفظ'); return; }
    const rows = cands.map((c, i) => { const dup = mmFindDup(c.text); return { ...c, i, dup:!!dup }; });
    const body = `<div class="tk-sub" style="margin-bottom:8px">${rows.length} مقترح — اختر ما تريد حفظه.${rows.some(r => r.dup) ? ' المكرر غير محدد.' : ''}</div>
      <div class="rs-list">${rows.map(r => `<label class="mm-card cand"><input type="checkbox" class="sw sm" data-i="${r.i}"${r.dup ? '' : ' checked'}><div class="mm-main"><div class="mm-txt" dir="auto">${esc(r.text)}</div><div class="rs-meta"><span class="mm-cat c-${r.cat}">${MM_CATS[r.cat]}</span>${r.dup ? '<span>مكررة</span>' : ''}</div></div></label>`).join('')}</div>`;
    const ov = overlay(title, body, `<button type="button" class="lib-btn" data-x2>إلغاء</button><button type="button" class="lib-btn pri" data-ok>حفظ المحدد</button>`);
    const upd = () => { const n = ov.querySelectorAll('input[data-i]:checked').length; const b = ov.querySelector('[data-ok]'); b.textContent = `حفظ المحدد (${n})`; b.disabled = !n; };
    ov.addEventListener('change', upd); upd();
    ov.querySelector('[data-x2]').addEventListener('click', ov.close);
    ov.querySelector('[data-ok]').addEventListener('click', () => {
      let n = 0; ov.querySelectorAll('input[data-i]:checked').forEach(b => { const c = cands[+b.dataset.i], { text, cat: k, ...extra } = c; if (mmAdd(text, k, 'import', extra).m) n++; });
      ov.close(); paint(); toast(n ? `حُفظت ${n} ذكرى` : 'لم يُحفظ شيء');
    });
  }
  async function withBusy(btn, label, fn){
    const old = btn.lastChild.textContent; btn.disabled = true; btn.lastChild.textContent = ' ' + label;
    try{ return await fn(); }catch(e){ if (e.name !== 'AbortError') toast(e.message || 'تعذّر التنفيذ'); }
    finally{ btn.disabled = false; btn.lastChild.textContent = old; }
  }
  async function importFile(f){
    if (!f) return;
    if (f.size > 3 * 1024 * 1024){ toast('الملف كبير (الحد 3 ميغابايت)'); return; }
    let text = ''; try{ text = await f.text(); }catch{ toast('تعذّرت قراءة الملف'); return; }
    text = text.replace(/^\uFEFF/, '').trim(); if (!text){ toast('الملف فارغ'); return; }
    let cands = [];
    if (/\.json$/i.test(f.name)){
      let j = null; try{ j = JSON.parse(text); }catch{}
      cands = j ? mmCands(j) : [];
      if (!cands.length){ toast('لم أجد ذكريات في ملف JSON هذا'); return; }
    } else {
      cands = await withBusy($('mmImp'), 'جارٍ القراءة…', async () => mmModel() ? await mmExtractFrom(text) : mmBulletCands(text)) || [];
      if (!mmModel() && cands.length) toast('لا يوجد نموذج: التُقطت أسطر النقاط فقط');
    }
    showCands('مقترحات من «' + f.name + '»', cands);
  }
  async function fromChat(){
    const c = current(), msgs = c ? c.messages.filter(m => m.role === 'user' && !m.error && m.content) : [];
    if (!msgs.length){ toast('لا توجد رسائل في المحادثة الحالية'); return; }
    const cands = await withBusy($('mmChatX'), 'جارٍ الاستخراج…', () => mmExtractFrom(msgs.slice(-30).map(m => String(m.content).slice(0, 1500)).join('\n---\n'), { kind:'chat' }));
    if (cands) showCands('مقترحات من المحادثة الحالية', cands);
  }
  function exportAll(){
    const items = mmDB.list().map(m => ({ text:m.text, cat:m.cat, pinned:!!m.pinned, uses:m.uses || 0, createdAt:m.createdAt }));
    if (!items.length){ toast('لا توجد ذكريات للتصدير'); return; }
    const d = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([JSON.stringify({ app:'quark-ai', kind:'memory', version:1, exportedAt:new Date().toISOString(), items }, null, 2)], { type:'application/json' }), `quark-memory-${d}.json`);
  }

  /* ---------- الأحداث ---------- */
  $('mmSearch').addEventListener('input', e => { q = e.target.value; paint(); });
  $('mmSort').addEventListener('change', e => { sort = e.target.value; paint(); });
  $('mmChips').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b){ cat = b.dataset.c; paint(); } });
  $('mmTidy').addEventListener('click', tidy);
  $('mmSel').addEventListener('click', () => { selMode = !selMode; sel.clear(); editing = ''; paint(); });
  $('mmBulkX').addEventListener('click', () => { selMode = false; sel.clear(); paint(); });
  $('mmAll').addEventListener('change', e => { const l = filtered(); if (e.target.checked) l.forEach(m => sel.add(m.id)); else l.forEach(m => sel.delete(m.id)); paint(); });
  $('mmBulkPin').addEventListener('click', () => {
    const l = [...sel].map(id => mmDB.get(id)).filter(Boolean), pin = l.some(m => !m.pinned);
    l.forEach(m => { m.pinned = pin; }); mmDB.save(); selMode = false; sel.clear(); paint(); toast(pin ? 'تم التثبيت' : 'أُلغي التثبيت');
  });
  $('mmBulkDel').addEventListener('click', async () => {
    if (sel.size && await qConfirm(`حذف ${sel.size} ذكرى نهائيًا؟`, { ok:'حذف' })){ mmDB.del([...sel]); sel.clear(); selMode = false; paint(); toast('تم الحذف'); }
  });
  $('mmList').addEventListener('click', async e => {
    if (e.target.closest('[data-go]')){ e.preventDefault(); setTab(e.target.closest('[data-go]').dataset.go); return; }
    const c = e.target.closest('[data-m]'); if (!c) return; const m = mmDB.get(c.dataset.m); if (!m) return;
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (editing === m.id){
      if (a === 'cancel'){ editing = ''; paint(); }
      else if (a === 'save'){
        const text = mmClean($('mmEd').value);
        if (text.length < 2){ toast('النص قصير جدًا'); return; }
        if (mmSensitive(text)){ toast('يبدو أن النص يحوي مفتاحًا أو كلمة سر أو رقم بطاقة'); return; }
        const dup = mmFindDup(text, m.id); if (dup && !await qConfirm('توجد ذكرى مشابهة جدًا. احفظ التعديل رغم ذلك؟', { ok:'حفظ', danger:false })) return;
        m.text = text; m.cat = $('mmEdCat').value; m.updatedAt = Date.now(); mmDB.save(); editing = ''; paint(); toast('تم الحفظ');
      }
      return;
    }
    if (selMode){ sel.has(m.id) ? sel.delete(m.id) : sel.add(m.id); paint(); return; }
    if (a === 'menu'){
      menu(e.target.closest('[data-a="menu"]'), [
        { l:'تعديل', f:() => { editing = m.id; paint(); } },
        { l:m.pinned ? 'إلغاء التثبيت' : 'تثبيت', f:() => { m.pinned = !m.pinned; mmDB.save(); paint(); } },
        { l:'تغيير التصنيف', f:() => menu(e.target.closest('[data-a="menu"]') || c, Object.entries(MM_CATS).map(([k, v]) => ({ l:(m.cat === k ? '✓ ' : '') + v, f:() => { m.cat = k; m.updatedAt = Date.now(); mmDB.save(); paint(); } }))) },
        { l:'نسخ', f:() => { try{ navigator.clipboard.writeText(m.text); toast('تم النسخ'); }catch{} } },
        { l:'حذف', d:true, f:async () => { if (await qConfirm('حذف هذه الذكرى نهائيًا؟', { ok:'حذف' })){ mmDB.del(m.id); paint(); toast('تم الحذف'); } } }]);
      return;
    }
    editing = m.id; paint();
  });
  view.addEventListener('keydown', e => {
    if (e.target.id === 'mmEd' && e.key === 'Escape'){ editing = ''; paint(); }
    if (e.target.id === 'mmEd' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.target.closest('.mm-card').querySelector('[data-a="save"]').click();
    if (e.target.id === 'mmNew' && e.key === 'Enter'){ e.preventDefault(); $('mmAddBtn').click(); }
  });

  /* الإضافة */
  $('mmNewCat').innerHTML = catOpts();
  $('mmAddBtn').addEventListener('click', () => {
    const r = mmAdd($('mmNew').value, $('mmNewCat').value, 'manual');
    if (r.m){ $('mmNew').value = ''; toast('أُضيفت إلى الذاكرة'); paint(); }
    else toast(r.dup ? 'هذه المعلومة محفوظة مسبقًا' : r.err);
  });
  $('mmImp').addEventListener('click', () => $('mmFile').click());
  $('mmFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; importFile(f); });
  $('mmExp').addEventListener('click', exportAll);
  $('mmChatX').addEventListener('click', fromChat);

  /* الإعدادات */
  $('mmSetMax').innerHTML = [3, 5, 8, 10, 12, 15, 20].map(n => `<option value="${n}">${n}</option>`).join('');
  const setOn = on => { settings.memory.enabled = on; persistSettings(); paint(); };
  $('mmOn').addEventListener('change', e => setOn(e.target.checked));
  $('mmSetAuto').addEventListener('change', e => { settings.memory.auto = e.target.checked; persistSettings(); });
  $('mmSetMax').addEventListener('change', e => { settings.memory.max = Number(e.target.value) || 8; persistSettings(); });
  $('mmWipe').addEventListener('click', async () => { if (await qConfirm('حذف كل الذكريات نهائيًا؟ لا يمكن التراجع.', { ok:'حذف الكل' })){ mmDB.del(mmDB.list().map(m => m.id)); sel.clear(); selMode = false; paint(); toast('حُذفت كل الذكريات'); } });

  /* نقطة دخول متوافقة مع الروابط القديمة. */
  window.__openMemory = () => {
    openSettings('custom');
    $('memoryDetails').open = true;
    selMode = false; sel.clear(); editing = ''; paint();
    requestAnimationFrame(() => $('memoryDetails').scrollIntoView({ block:'start' }));
  };
})();
