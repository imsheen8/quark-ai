/* QUARK AI — صفحة النماذج المتقدمة: العرض */
'use strict';

/* ================= صفحة النماذج المتقدمة ================= */
const modelFav = new Set(store.get('ai_model_fav', []));
const modelUse = store.get('ai_model_use', {});
const mdTest = {};                       /* key -> { busy | ok, ms | err } (في الذاكرة فقط) */
const mdUi = { tab:'all', ep:'all', cap:'all', st:'all', fam:'all', view:'grid', sort:'name', ...store.get('ai_md_ui', {}) };
Object.assign(mdUi, { q:'', multi:false, limit:120 });
const mdSel = new Set();
const mkey = (ep, id) => ep.id + '|' + id;
const saveMdUi = () => store.set('ai_md_ui', { tab:mdUi.tab, ep:mdUi.ep, cap:mdUi.cap, st:mdUi.st, fam:mdUi.fam, view:mdUi.view, sort:mdUi.sort });
const saveFav = () => store.set('ai_model_fav', [...modelFav]);
function bumpUse(am){
  if (!am) return;
  const k = modelKey(am), u = modelUse[k] || { n:0, ts:0 };
  u.n++; u.ts = Date.now(); modelUse[k] = u; store.set('ai_model_use', modelUse);
}
/* القدرات تقديرية بحسب اسم النموذج */
const capReason = id => /reason|think|(^|[\/\-_:.])o[1-9](-|$|:)|(^|[\/\-_:.])r1(-|$|:)|qwq|gpt-5|gemini-(2\.5|3)|claude-(opus|sonnet|haiku)-?[45]/i.test(id);
const capVision = id => /vision|gpt-4o|gpt-4\.1|gpt-5|(^|[\/\-_:.])o[134](-|$|:)|claude|gemini|llava|pixtral|-vl|vl-|gemma-?3|llama-?4|llama-?3\.2-(11|90)b|grok-?[24]/i.test(id);
const hasParams = key => Object.keys(cleanParams(settings.params.models[key])).length > 0;
const mdItems = () => settings.endpoints.flatMap(ep => ep.models.map(m => ({ ep, m, key:mkey(ep, m.id) })));
const isActiveItem = (it, am) => !!am && am.ep.id === it.ep.id && am.model === it.m.id;

function mdFiltered(){
  const q = mdUi.q.trim().toLowerCase();
  let a = mdItems();
  if (mdUi.ep !== 'all') a = a.filter(x => x.ep.id === mdUi.ep);
  if (mdUi.tab === 'fav') a = a.filter(x => modelFav.has(x.key));
  else if (mdUi.tab === 'on') a = a.filter(x => x.m.on && x.ep.enabled);
  else if (mdUi.tab === 'used') a = a.filter(x => modelUse[x.key]?.n);
  if (mdUi.cap === 'reason') a = a.filter(x => capReason(x.m.id));
  else if (mdUi.cap === 'vision') a = a.filter(x => capVision(x.m.id));
  else if (mdUi.cap === 'image') a = a.filter(x => isImgModel(x.ep, x.m.id));
  else if (mdUi.cap === 'params') a = a.filter(x => hasParams(x.key));
  if (mdUi.st !== 'all'){
    const P = window.__mdPro;
    a = a.filter(x => mdUi.st === 'off' ? (!x.m.on || !x.ep.enabled) : mdUi.st === 'none' ? P.statusOf(x.key) === 'none' : P.statusOf(x.key) === mdUi.st);
  }
  if (mdUi.fam !== 'all') a = a.filter(x => window.__mdPro.famOf(x.m.id) === mdUi.fam);
  if (q) a = a.filter(x => { const mt = window.__mdPro.meta(x.key); return (x.m.id + ' ' + hostOf(x.ep.url) + ' ' + (mt.alias || '') + ' ' + (mt.note || '')).toLowerCase().includes(q); });
  const byName = (x, y) => x.m.id.localeCompare(y.m.id);
  if (mdUi.sort === 'used') a.sort((x, y) => (modelUse[y.key]?.n || 0) - (modelUse[x.key]?.n || 0) || byName(x, y));
  else if (mdUi.sort === 'recent') a.sort((x, y) => (modelUse[y.key]?.ts || 0) - (modelUse[x.key]?.ts || 0) || byName(x, y));
  else if (mdUi.sort === 'speed'){ const L = k => { const v = window.__mdPro.latOf(k); return v == null ? 1e9 : v; }; a.sort((x, y) => L(x.key) - L(y.key) || byName(x, y)); }
  else if (mdUi.sort === 'ctx') a.sort((x, y) => window.__mdPro.ctxOf(y.m.id) - window.__mdPro.ctxOf(x.m.id) || byName(x, y));
  else if (mdUi.sort === 'ep') a.sort((x, y) => hostOf(x.ep.url).localeCompare(hostOf(y.ep.url)) || byName(x, y));
  else a.sort((x, y) => (modelFav.has(y.key) - modelFav.has(x.key)) || byName(x, y));
  return a;
}
function mdCard(it){
  const { ep, m, key } = it, am = activeModel(), cb = cmpState.on ? cmpModel() : null;
  const isA = isActiveItem(it, am), isB = isActiveItem(it, cb), fav = modelFav.has(key);
  const P = window.__mdPro, ex = P.cardExtra(it), lt = P.statusOf(key) !== 'none' && !mdTest[key] ? (() => { const l = P.meta(key).hist.slice(-1)[0]; return l.ok ? { ok:true, ms:l.ms, old:true } : { ok:false, err:l.err, old:true }; })() : null;
  const u = modelUse[key], t = mdTest[key] || lt, off = !ep.enabled || !m.on;
  const star = fav ? `<span class="lib-star"><svg class="i" style="fill:currentColor;width:16px;height:16px" aria-hidden="true"><use href="#i-lib-star"/></svg></span>` : '';
  const head = (isA ? '<span class="lib-badge ok">الحالي</span>' : '') + (isB ? '<span class="lib-badge acc">الثاني</span>' : '') +
    (ep.kind === 'local' ? '<span class="lib-badge">محلي</span>' : '') + (!ep.enabled ? '<span class="lib-badge bad">نقطة معطّلة</span>' : !m.on ? '<span class="lib-badge">معطّل</span>' : '');
  const tags = (isImgModel(ep, m.id) ? '<span class="lib-badge acc">توليد صور</span>' : '') + (capReason(m.id) ? '<span class="lib-badge" title="تقدير بحسب الاسم">تفكير</span>' : '') +
    (capVision(m.id) ? '<span class="lib-badge" title="تقدير بحسب الاسم">رؤية</span>' : '') +
    (hasParams(key) ? '<span class="lib-badge acc">معاملات مخصصة</span>' : '') + (ex.ctx ? `<span class="lib-badge" title="نافذة السياق (تقدير بحسب الاسم)">≈${P.fmtCtx(ex.ctx)}</span>` : '') +
    (t ? (t.busy ? '<span class="lib-badge tst"><i class="md-spin"></i>يختبر…</span>'
      : t.ok ? `<span class="lib-badge ok tst" title="${t.old ? 'نتيجة آخر اختبار محفوظ' : 'الاتصال سليم'}">✓ ${(t.ms / 1000).toFixed(1)} s</span>`
      : `<span class="lib-badge bad" title="${esc(t.err || '')}">فشل الاختبار</span>`) : '');
  const items =
    `<button data-a="use">${ic('check')}استخدام كنموذج حالي</button>` +
    `<button data-a="second">${ic('columns')}نموذج ثانٍ للمقارنة</button>` +
    `<button data-a="fav">${ic('lib-star')}${fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}</button>` +
    `<button data-a="test">${ic('clock')}اختبار الاتصال</button>` +
    `<button data-a="info">${ic('info')}التفاصيل والملاحظات</button>` +
    `<button data-a="play">${ic('send')}ساحة التجربة</button>` +
    `<button data-a="params">${ic('settings')}المعاملات</button>` +
    `<button data-a="toggle">${ic('lib-power')}${m.on ? 'تعطيل' : 'تفعيل'}</button>` +
    `<button data-a="copy">${ic('copy')}نسخ المعرّف</button>` +
    `<button class="d" data-a="del">${ic('trash')}حذف</button>`;
  return `<div class="lib-card${mdSel.has(key) ? ' sel' : ''}${isA ? ' is-active' : ''}${off ? ' off' : ''}${ex.color ? ' lbl' : ''}" data-k="${esc(key)}"${ex.color ? ` style="--lc:${ex.color}"` : ''}>
    <div class="lib-row"><span class="lib-chk">${ic('check')}</span>${head}${star}
      <div class="lib-menu" ${fav ? '' : 'style="margin-inline-start:auto"'}><button class="lib-ib" data-a="menu" aria-label="المزيد" style="width:34px;height:34px">${ic('more')}</button><div class="lib-pop">${items}</div></div></div>
    <h3 class="md-name">${esc(ex.alias || m.id)}</h3><p class="md-host">${ex.alias ? esc(m.id) + ' · ' : ''}${esc(hostOf(ep.url))}</p>
    ${ex.note ? `<p class="md-note">${esc(ex.note)}</p>` : ''}
    <div class="md-tags">${tags}</div>
    <div class="lib-foot"><span class="meta">${u?.n ? u.n + ' استخدام' : 'لم يُستخدم بعد'}</span>` +
    `<button class="lib-btn${isA ? '' : ' pri'}" data-a="use" style="height:34px"${isA || !ep.enabled ? ' disabled' : ''}>${isA ? 'قيد الاستخدام' : 'استخدام'}</button></div></div>`;
}
/* ملخص النماذج (النموذج الحالي، الأعداد، المقارنة، صحة الاتصال…) — يُعرض الآن في الإعدادات ← الإحصائيات */
function mdOverviewHtml(){
  const all = mdItems(), am = activeModel(), cb = cmpModel();
  const slot = (cls, label, a, act) => `<button type="button" class="md-slot ${cls}${a ? '' : ' empty'}" data-a="${act}"><span class="l">${label}</span>` +
    (a ? `<b>${esc(a.model)}</b><small>${esc(hostOf(a.ep.url))}</small>` : '<b>لم يُحدَّد بعد — اضغط للاختيار</b>') + '</button>';
  const on = all.filter(x => x.m.on && x.ep.enabled).length;
  return `<div class="md-sum" id="stOv">` + slot('a', 'النموذج الحالي', am, 'slotA') + (cmpState.on ? slot('b', 'النموذج الثاني (المقارنة)', cb, 'slotB') : '') +
    `<div class="stats"><div class="stat"><b>${all.length}</b><small>نموذجًا</small></div><div class="stat"><b>${on}</b><small>مفعّلة</small></div><div class="stat"><b>${settings.endpoints.length}</b><small>نقاط اتصال</small></div></div>` +
    `<button type="button" class="opt-row" role="switch" aria-checked="${cmpState.on}" data-a="cmp"><span>مقارنة نموذجين<small>يُرسل سؤالك إلى نموذجين معًا لتقارن الردّين</small></span><i class="tg"></i></button>` +
    window.__mdPro.overview(all) + `</div>`;
}
function mdRender(){
  try{ window.__stRefresh?.(); }catch{}
  if (!mainEl.classList.contains('md-open')) return;
  const all = mdItems();
  if (mdUi.ep !== 'all' && !epOf(mdUi.ep)) mdUi.ep = 'all';
  [...mdSel].forEach(k => { if (!all.some(x => x.key === k)) mdSel.delete(k); });

  const on = all.filter(x => x.m.on && x.ep.enabled).length;
  const tabs = [['all', 'الكل', all.length], ['fav', 'المفضلة', all.filter(x => modelFav.has(x.key)).length],
    ['on', 'المفعّلة', on], ['used', 'المستخدمة', all.filter(x => modelUse[x.key]?.n).length],
    ['dl', 'تنزيل على الجهاز', window.__od ? window.__od.store.list().filter(r => r.state === 'ready').length : null]];
  if (!tabs.some(t => t[0] === mdUi.tab)) mdUi.tab = 'all';
  $('mdTabs').innerHTML = tabs.map(([k, l, n]) => `<button class="lib-tab ${mdUi.tab === k ? 'on' : ''}" data-mt="${k}">${l}${n == null ? '' : `<small>${n}</small>`}</button>`).join('');

  $('mdTabs').querySelector('.on')?.scrollIntoView({ inline:'center', block:'nearest' });
  const odOn = mdUi.tab === 'dl' && !!window.__od_ui;
  $('mdView').classList.toggle('od-on', odOn); $('mdDl').hidden = !odOn; $('mdGrid').hidden = odOn;
  if (odOn){ window.__od_ui.show(); window.__od_ui.banner(); return; }
  window.__od_ui?.hide();
  $('mdChips').innerHTML = settings.endpoints.length > 1
    ? `<button class="md-chip ${mdUi.ep === 'all' ? 'on' : ''}" data-ce="all">كل النقاط</button>` +
      settings.endpoints.map(e => `<button class="md-chip ${mdUi.ep === e.id ? 'on' : ''}" data-ce="${e.id}"><span class="h">${esc(hostOf(e.url))}</span><small>${e.models.length}</small></button>`).join('')
    : '';
  const fams = [...new Set(all.map(x => window.__mdPro.famOf(x.m.id)))].sort();
  if (mdUi.fam !== 'all' && !fams.includes(mdUi.fam)) mdUi.fam = 'all';
  $('mdFam').innerHTML = '<option value="all">كل العائلات</option>' + fams.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  $('mdCap').value = mdUi.cap; $('mdSort').value = mdUi.sort; $('mdSt').value = mdUi.st; $('mdFam').value = mdUi.fam;
  document.querySelectorAll('#mdVm [data-vm]').forEach(b => b.classList.toggle('on', b.dataset.vm === mdUi.view));
  $('mdGrid').classList.toggle('md-list', mdUi.view === 'list');
  const fAct = mdUi.q || mdUi.cap !== 'all' || mdUi.ep !== 'all' || mdUi.st !== 'all' || mdUi.fam !== 'all';
  $('mdReset').hidden = !fAct;

  const v = mdFiltered(), shown = v.slice(0, mdUi.limit);
  $('mdView').classList.toggle('lib-sm', mdUi.multi);
  $('mdMulti').classList.toggle('on', mdUi.multi);
  $('mdBar').classList.toggle('show', mdUi.multi);
  $('mdBBench').disabled = mdSel.size < 2;
  $('mdAll').textContent = v.length && v.every(x => mdSel.has(x.key)) ? 'إلغاء التحديد' : 'تحديد الكل';
  ['mdBOn', 'mdBOff', 'mdBFav', 'mdBTest', 'mdBDel'].forEach(id => { $(id).disabled = !mdSel.size; });
  $('mdCnt').textContent = mdSel.size ? mdSel.size + ' محدد' : '';
  const cards = () => {
    if (mdUi.view !== 'group' || settings.endpoints.length < 2) return shown.map(mdCard).join('');
    let last = '', h = '';
    [...shown].sort((x, y) => hostOf(x.ep.url).localeCompare(hostOf(y.ep.url))).forEach(it => {
      if (it.ep.id !== last){ last = it.ep.id; const n = v.filter(z => z.ep.id === it.ep.id).length; h += `<div class="md-gh"><b dir="ltr">${esc(hostOf(it.ep.url))}</b><small>${n}</small></div>`; }
      h += mdCard(it);
    });
    return h;
  };
  $('mdGrid').innerHTML = shown.length
    ? cards() + (v.length > shown.length ? `<button class="lib-btn md-more" data-a="more">عرض المزيد (${v.length - shown.length})</button>` : '')
    : `<div class="lib-empty">${!settings.endpoints.length ? 'لم تُضف أي نقطة اتصال بعد.<br>اضغط + لإضافة نقطة اتصال ونماذجها.'
      : fAct ? 'لا نتائج مطابقة للتصفية.'
      : mdUi.tab === 'fav' ? 'لا توجد نماذج مفضلة بعد.' : mdUi.tab === 'used' ? 'لم تستخدم أي نموذج بعد.' : 'لا توجد نماذج هنا.<br>اضغط ⟳ لجلب النماذج من نقاط الاتصال.'}</div>`;
  mdBanner();
}
function mdBanner(){ try{ window.__od_ui?.banner(); }catch{} }
function mdRepaint(key){
  const it = mdItems().find(x => x.key === key), node = [...$('mdGrid').querySelectorAll('.lib-card')].find(n => n.dataset.k === key);
  if (!it || !node) return mdRender();
  node.outerHTML = mdCard(it);
}
function openModels(){
  mainEl.classList.remove('lib-open', 'set-open', 'pf-open', 'ch-open', 'vo-open'); mainEl.classList.add('md-open');
  mdUi.multi = false; mdSel.clear(); mdRender(); closeDrawer(); $('mdView').querySelector('.md-body').scrollTop = 0;
}
window.__openModels = openModels;
window.__mdRefresh = mdRender;

