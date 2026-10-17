/* QUARK AI — صفحة «سجل الأخطاء» (الإعدادات ← سجل الأخطاء)
   تعرض كل ما التقطه __errlog (js/features/error-log.js): أخطاء الواجهة والشبكة والنماذج والمحرك المحلي والتنزيل وانهيارات أندرويد،
   مع تصفية وبحث وتجميع المتكرر، ونسخ «تقرير كامل» (معلومات الجهاز + الأخطاء) لإرساله للدعم. */
'use strict';

(() => {
  const L = () => window.__errlog;
  const LOC = 'ar-u-nu-latn';
  const E = s => esc(String(s == null ? '' : s));
  const ico = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const ui = { src:'all', lvl:'all', q:'', adv:false, open:new Set(), range:'all', ...(() => { try{ return store.get('ai_er_ui', {}); }catch{ return {}; } })() };
  ui.open = new Set();
  const saveUi = () => { try{ store.set('ai_er_ui', { src:ui.src, lvl:ui.lvl, range:ui.range, adv:ui.adv }); }catch{} };
  const root = () => document.getElementById('erRoot');
  const visible = () => { const p = document.querySelector('.tab-panel[data-panel="errors"]'); return !!(p && !p.hidden && root() && root().offsetParent !== null); };
  let t0 = 0;

  const ago = ts => {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 45) return 'الآن';
    if (s < 3600) return 'قبل ' + Math.round(s / 60) + ' د';
    if (s < 86400) return 'قبل ' + Math.round(s / 3600) + ' س';
    return new Date(ts).toLocaleDateString(LOC, { day:'numeric', month:'short' }) + ' ' + new Date(ts).toLocaleTimeString(LOC, { hour:'2-digit', minute:'2-digit' });
  };
  const abs = ts => new Date(ts).toLocaleString(LOC, { dateStyle:'medium', timeStyle:'medium' });
  const RANGES = [['all', 'الكل', 0], ['1', 'آخر ساعة', 36e5], ['24', 'آخر 24 ساعة', 864e5], ['168', '7 أيام', 6048e5]];
  const sinceOf = () => { const r = RANGES.find(x => x[0] === ui.range); return r && r[2] ? Date.now() - r[2] : 0; };
  const filt = () => ({ src:ui.src, lvl:ui.lvl, q:ui.q, since:sinceOf() });

  function sw(k, t, d, on){ return `<button type="button" class="opt-row" role="switch" aria-checked="${on}" data-er="sw" data-k="${k}"><span>${t}<small>${d}</small></span><i class="tg"></i></button>`; }

  function card(e){
    const S = L().SRC[e.src] || { t:e.src, i:'info' }, open = ui.open.has(e.id);
    let det = '';
    if (open){
      det = `<div class="er-det">
        <div class="er-meta" dir="ltr"><span>${E(abs(e.last))}</span>${e.n > 1 ? `<span>first ${E(abs(e.ts))}</span>` : ''}${e.code ? `<span>code ${E(e.code)}</span>` : ''}${e.page ? `<span>${E(e.page)}</span>` : ''}</div>
        ${e.ctx ? `<pre class="er-pre" dir="ltr">${E(JSON.stringify(e.ctx, null, 1))}</pre>` : ''}
        ${e.stack ? `<pre class="er-pre" dir="ltr">${E(e.stack)}</pre>` : '<div class="er-none">لا توجد تفاصيل مكدّس (stack) لهذا الخطأ.</div>'}
      </div>`;
    }
    return `<div class="er-card ${e.lvl}${open ? ' open' : ''}" data-id="${e.id}">
      <button type="button" class="er-head" data-er="toggle" data-id="${e.id}" aria-expanded="${open}">
        <span class="er-src">${ico(S.i)}${E(S.t)}</span>
        ${e.lvl === 'warn' ? '<span class="er-lvl">تحذير</span>' : ''}${e.n > 1 ? `<span class="er-n">×${e.n}</span>` : ''}
        <span class="er-time">${E(ago(e.last))}</span>
      </button>
      <div class="er-msg" dir="auto">${E(e.msg)}</div>
      ${det}
      <div class="er-row"><button type="button" class="er-ib" data-er="copy1" data-id="${e.id}" title="نسخ هذا الخطأ">${ico('copy')}<span>نسخ</span></button>
        <button type="button" class="er-ib" data-er="toggle" data-id="${e.id}">${open ? 'إخفاء التفاصيل' : 'التفاصيل'}</button>
        <button type="button" class="er-ib del" data-er="del" data-id="${e.id}" title="حذف">${ico('trash')}</button></div>
    </div>`;
  }

  function render(){
    const r = root(); if (!r || !L()) return;
    const el = L(), all = el.all(), cut = sinceOf();
    const inR = all.filter(e => e.last >= cut);
    const nErr = inR.filter(e => e.lvl === 'error').length, nWarn = inR.filter(e => e.lvl === 'warn').length;
    const rows = el.list(filt());
    const srcCount = {}; inR.forEach(e => { srcCount[e.src] = (srcCount[e.src] || 0) + 1; });
    const srcs = Object.keys(el.SRC).filter(k => srcCount[k]);
    const keep = r.querySelector('#erQ') === document.activeElement, sel = keep ? r.querySelector('#erQ').selectionStart : 0, st = (document.querySelector('.set-body') || {}).scrollTop;
    const p = el.prefs();
    r.innerHTML = `<div class="er">
      <div class="st-kpis er-kpis">
        <div class="st-kpi"><span class="l">أخطاء</span><b>${nErr}</b><span class="s">${nErr ? 'تحتاج مراجعة' : 'لا أخطاء 🎉'}</span></div>
        <div class="st-kpi"><span class="l">تحذيرات</span><b>${nWarn}</b><span class="s">${p.warn ? 'الالتقاط مفعّل' : 'الالتقاط معطّل (من المتقدّم)'}</span></div>
      </div>
      <div class="er-acts">
        <button type="button" class="lib-btn pri" data-er="copyfull">${ico('copy')}<span>نسخ تقرير كامل</span></button>
        <button type="button" class="lib-btn" data-er="share">${ico('share')}<span>مشاركة كملف</span></button>
        <button type="button" class="lib-btn" data-er="copyview"${rows.length ? '' : ' disabled'}>${ico('copy')}<span>نسخ المعروض</span></button>
        <button type="button" class="lib-btn danger" data-er="clear"${all.length ? '' : ' disabled'}>${ico('trash')}<span>مسح الكل</span></button>
      </div>
      <p class="er-hint">«التقرير الكامل» يضم معلومات جهازك وإعدادات المحرك المحلي وأحدث الأخطاء — الصقه في المحادثة معي لأشخّص المشكلة. المفاتيح والرموز تُخفى تلقائيًا، والسجل محفوظ على جهازك فقط.</p>
      <div class="er-filters">
        <div class="er-search">${ico('search')}<input id="erQ" class="fld" type="search" placeholder="ابحث في الأخطاء…" value="${E(ui.q)}" autocomplete="off"></div>
        <div class="er-chips" role="tablist">
          <button type="button" class="er-chip${ui.src === 'all' ? ' on' : ''}" data-er="src" data-v="all">الكل<i>${inR.length}</i></button>
          ${srcs.map(k => `<button type="button" class="er-chip${ui.src === k ? ' on' : ''}" data-er="src" data-v="${k}">${E(el.SRC[k].t)}<i>${srcCount[k]}</i></button>`).join('')}
        </div>
        <div class="er-chips">
          ${[['all', 'كل المستويات'], ['error', 'أخطاء فقط'], ['warn', 'تحذيرات فقط']].map(([v, t]) => `<button type="button" class="er-chip${ui.lvl === v ? ' on' : ''}" data-er="lvl" data-v="${v}">${t}</button>`).join('')}
          <span class="er-sp"></span>
          ${RANGES.map(([v, t]) => `<button type="button" class="er-chip${ui.range === v ? ' on' : ''}" data-er="range" data-v="${v}">${t}</button>`).join('')}
        </div>
      </div>
      <div class="er-list">${rows.length ? rows.map(card).join('') : `<div class="st-empty">${all.length ? 'لا نتائج تطابق التصفية الحالية.' : 'لا توجد أخطاء مسجّلة. إن حدث أي خطأ في التطبيق سيظهر هنا تلقائيًا.'}</div>`}</div>
      <details class="er-adv"${ui.adv ? ' open' : ''}><summary>خيارات متقدمة</summary>
        ${sw('con', 'التقاط console.error', 'يسجّل ما تكتبه مكتبات التطبيق من أخطاء في وحدة التحكم', p.con)}
        ${sw('net', 'التقاط أخطاء الشبكة (fetch)', 'يسجّل فشل الاتصال ورموز HTTP من 400 فما فوق (بلا محتوى الطلبات)', p.net)}
        ${sw('warn', 'التقاط التحذيرات أيضًا', 'console.warn وطلبات HTTP 404 — قد يزيد الضجيج', p.warn)}
        <label class="lib-f">الحد الأقصى للسجل<select class="fld" data-er="max">${[100, 300, 600, 1000].map(v => `<option value="${v}"${p.max === v ? ' selected' : ''}>${v} خطأ</option>`).join('')}</select></label>
        <div class="er-acts">
          <button type="button" class="lib-btn" data-er="json">${ico('download')}<span>تصدير JSON</span></button>
          <button type="button" class="lib-btn" data-er="native">${ico('refresh')}<span>استيراد انهيارات أندرويد</span></button>
          <button type="button" class="lib-btn" data-er="test">${ico('alert')}<span>توليد خطأ تجريبي</span></button>
        </div>
        <p class="er-hint">الحالة الحالية: ${all.length} مدخلًا محفوظًا من أصل ${p.max}. انهيارات النظام (مثل انهيار المحرك الأصلي أو GPU أو إغلاق التطبيق لنقص الذاكرة) تُقرأ من أندرويد عند فتح التطبيق مرة بعد حدوثها.</p>
      </details>
    </div>`;
    if (keep){ const q = r.querySelector('#erQ'); q.focus(); try{ q.setSelectionRange(sel, sel); }catch{} }
    const sb = document.querySelector('.set-body'); if (sb && st != null) sb.scrollTop = st;
  }

  const rerender = () => { clearTimeout(t0); t0 = setTimeout(() => { if (visible()) render(); updateDot(); }, 120); };

  function updateDot(){
    try{
      const n = L().unseen(), d = document.getElementById('erTabDot');
      if (d){ d.hidden = !(n > 0) || visible(); d.textContent = n > 9 ? '9+' : String(n); }
    }catch{}
  }

  async function copy(text, okMsg){ const ok = await copyText(text); toast(ok ? okMsg : 'تعذّر النسخ'); }
  const fname = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `quark-errors-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

  async function onAction(b){
    const a = b.dataset.er, el = L();
    if (a === 'toggle'){ const id = +b.dataset.id; ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); render(); }
    else if (a === 'copy1'){ const e = el.all().find(x => x.id === +b.dataset.id); if (e) copy(el.entryText(e, 1) + '\n\n' + 'الجهاز: ' + JSON.stringify(el.deviceSummary().native || { ua:navigator.userAgent }), 'تم نسخ الخطأ'); }
    else if (a === 'del'){ el.remove(+b.dataset.id); }
    else if (a === 'copyfull') copy(el.report({ limit:60 }), 'تم نسخ التقرير الكامل — الصقه في المحادثة');
    else if (a === 'copyview') copy(el.report({ entries:el.list(filt()).slice(0, 100) }), 'تم نسخ الأخطاء المعروضة');
    else if (a === 'share'){ await saveFile(new Blob([el.report({ limit:100 })], { type:'text/plain;charset=utf-8' }), fname() + '.txt'); }
    else if (a === 'json') await saveFile(new Blob([JSON.stringify({ exported:Date.now(), device:el.deviceSummary(), errors:el.all() }, null, 1)], { type:'application/json' }), fname() + '.json');
    else if (a === 'clear'){ if (await qConfirm('مسح كل الأخطاء المسجّلة؟', { ok:'مسح', danger:true })){ el.clear(); toast('تم المسح'); } }
    else if (a === 'src'){ ui.src = b.dataset.v; saveUi(); render(); }
    else if (a === 'lvl'){ ui.lvl = b.dataset.v; saveUi(); render(); }
    else if (a === 'range'){ ui.range = b.dataset.v; saveUi(); render(); }
    else if (a === 'sw'){ const k = b.dataset.k; el.setPrefs({ [k]: !el.prefs()[k] }); ui.adv = true; saveUi(); render(); }
    else if (a === 'native'){ const n = el.importNative(); toast(n ? 'تم استيراد ' + n + ' من سجل النظام' : 'لا انهيارات جديدة في أندرويد'); }
    else if (a === 'test'){
      el.add({ src:'app', msg:'خطأ تجريبي من «توليد خطأ تجريبي» — يمكنك حذفه', ctx:{ test:true }, stack:'Error: تجربة\n    at errors.js (test)' });
      setTimeout(() => { throw new Error('خطأ تجريبي غير ممسوك (setTimeout)'); }, 0);
      Promise.reject(new Error('وعد مرفوض تجريبي'));
      fetch('./__errlog_test_404__').catch(() => {});
      toast('أُنشئت أخطاء تجريبية');
    }
  }

  function bind(){
    const r = root(); if (!r || r.dataset.bound) return; r.dataset.bound = '1';
    r.addEventListener('click', e => { const b = e.target.closest('[data-er]'); if (b && !b.matches('select,input')) onAction(b); });
    r.addEventListener('input', e => { if (e.target.id === 'erQ'){ ui.q = e.target.value; clearTimeout(t0); t0 = setTimeout(render, 180); } });
    r.addEventListener('change', e => { const s = e.target.closest('select[data-er="max"]'); if (s){ L().setPrefs({ max:+s.value }); ui.adv = true; render(); } });
    r.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('.er-adv')){ ui.adv = e.target.open; saveUi(); } }, true);
  }

  window.__erOpen = () => { if (!L()) return; bind(); L().markSeen(); render(); updateDot(); };
  window.__erSub = () => { try{ const n = L().count({ lvl:'error' }), w = L().count({ lvl:'warn' }); return n || w ? `${n} خطأ${w ? ' · ' + w + ' تحذير' : ''}` : 'لا أخطاء'; }catch{ return ''; } };
  if (L()){ L().on(rerender); setTimeout(updateDot, 800); }
})();
