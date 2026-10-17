/* QUARK AI — النماذج التلقائية: نموذج لكل مهمة (محادثة جديدة، مهام خلفية، رؤية، بحث عميق، صور) مع بدائل احتياطية */
'use strict';

(() => {
  /* ---------- البيانات: settings.defs ---------- */
  const norm = v => v && v.ep && v.model ? { ep:String(v.ep), model:String(v.model) } : null;
  const lst = a => (Array.isArray(a) ? a : []).map(norm).filter(Boolean).slice(0, MAX_FB);
  const MAX_FB = 4;
  const raw = settings.defs && typeof settings.defs === 'object' ? settings.defs : {};
  const D = settings.defs = {
    chat:norm(raw.chat),
    util:{ sel:norm(raw.util?.sel), fb:lst(raw.util?.fb) },
    vision:{ sel:norm(raw.vision?.sel), fb:lst(raw.vision?.fb) },
    image:norm(raw.image),
  };
  const save = () => persistSettings();

  /* ---------- حلّ الاختيار إلى نموذج صالح للاستخدام الآن ---------- */
  const usable = s => {
    s = norm(s); const ep = s && epOf(s.ep);
    return ep && ep.enabled && (ep.kind === 'local' || ep.key) ? { ep, model:s.model } : null;
  };
  const same = (a, b) => a.ep.id === b.ep.id && a.model === b.model;
  const chain = (list, tail) => {
    const out = [];
    [...list, tail].forEach(x => {
      const u = x && x.ep && x.ep.id ? (x.ep.enabled && (x.ep.kind === 'local' || x.ep.key) ? x : null) : usable(x);
      if (u && !out.some(o => same(o, u))) out.push(u);
    });
    return out;
  };

  /* نموذج المحادثات الجديدة */
  window.applyDefaultChatModel = () => {
    const a = usable(D.chat); if (!a) return;
    settings.sel = { ep:a.ep.id, model:a.model };
    save();
    try{ updateModelLabels(); }catch{}
  };
  /* المهام الخلفية (العنوان التلقائي…): النموذج الخاص ثم بدائله ثم نموذج المحادثة */
  window.utilChain = am => chain([D.util.sel, ...D.util.fb], am);
  /* الرؤية: تُستخدم فقط حين تحمل آخر رسالة صورًا ونموذج المحادثة لا يبدو داعمًا للرؤية */
  window.chatChain = c => {
    const am = activeModel();
    const last = [...(c?.messages || [])].reverse().find(m => m.role === 'user');
    if (last && last.imgs && last.imgs.length && am && !capVision(am.model)){
      const v = chain([D.vision.sel, ...D.vision.fb], null);
      if (v.length) return v;
    }
    return am ? [am] : [];
  };
  /* توليد الصور: الأمر /صورة وصف… أو /img */
  window.imgPrefix = text => {
    const m = /^\/(?:صورة|صوره|img|image)(?:\s+([\s\S]*))?$/i.exec(text);
    return m ? { am:usable(D.image), text:(m[1] || '').trim() } : null;
  };
  /* استدعاء النموذج مع الانتقال للبديل إن فشل قبل وصول أي رد */
  window.callChain = async function*(list, history, signal, c, onPick){
    let last;
    for (let i = 0; i < list.length; i++){
      let got = false;
      try{
        if (onPick) onPick(list[i]);
        for await (const ch of callModel(history, signal, c, list[i])){ got = true; yield ch; }
        return;
      }catch(e){
        if (e.name === 'AbortError' || got) throw e;
        last = e;
      }
    }
    throw last || new Error('لا يوجد نموذج');
  };

  /* ---------- الواجهة ---------- */
  const root = $('defsRoot');
  const val = s => s ? s.ep + '|' + s.model : '';
  const parse = v => { const i = v.indexOf('|'); return i < 0 ? null : { ep:v.slice(0, i), model:v.slice(i + 1) }; };

  function options(kind, cur, empty){
    let h = `<option value="">${esc(empty)}</option>`, seen = false;
    const cv = val(cur);
    settings.endpoints.filter(e => e.enabled).forEach(ep => {
      const ms = ep.models.filter(m => m.on && (kind === 'image' ? isImgModel(ep, m.id) : !isImgModel(ep, m.id)));
      if (!ms.length) return;
      h += `<optgroup label="${esc(hostOf(ep.url))}">` + ms.map(m => {
        const v = ep.id + '|' + m.id; if (v === cv) seen = true;
        return `<option value="${esc(v)}"${v === cv ? ' selected' : ''}>${esc(shortModel(m.id))}${kind === 'vision' && capVision(m.id) ? ' ◉' : ''}</option>`;
      }).join('') + '</optgroup>';
    });
    if (cur && !seen) h += `<option value="${esc(cv)}" selected>${esc(shortModel(cur.model))} (غير متاح)</option>`;
    return h;
  }
  const select = (id, kind, cur, empty) =>
    `<div class="sel-wrap"><select class="fld" data-d="${id}" aria-label="${esc(empty)}">${options(kind, cur, empty)}</select>${ic('chevron-down', 'caret')}</div>`;

  function fbBlock(key, kind){
    const arr = D[key].fb;
    return `<div class="df-fb"><div class="df-fbh">البدائل الاحتياطية</div>` +
      arr.map((s, i) => `<div class="df-fbr">${select(key + '-fb-' + i, kind, s, '—')}<button type="button" class="df-x" data-rm="${key}:${i}" aria-label="حذف البديل">${ic('x')}</button></div>`).join('') +
      (arr.length < MAX_FB ? `<button type="button" class="df-add" data-add="${key}">${ic('plus')}<span>إضافة بديل</span></button>` : '') + '</div>';
  }
  const sec = (title, sub, body) => `<div class="pf-sec df-sec"><h3>${title}</h3><p class="sub">${sub}</p>${body}</div>`;

  function render(){
    if (!root) return;
    if (!settings.endpoints.some(e => e.enabled && e.models.some(m => m.on))){
      root.innerHTML = `<div class="df-empty">أضف نقطة اتصال وفعّل بعض النماذج من تبويب «المفاتيح والنماذج» أولًا، ثم عُد هنا لتحديد النموذج المناسب لكل مهمة.</div>`;
      return;
    }
    root.innerHTML =
      sec('نموذج المحادثات الجديدة', 'النموذج الذي يُختار تلقائيًا عند بدء محادثة جديدة. اتركه فارغًا لتبقى آخر نموذج اخترته.',
        select('chat', 'text', D.chat, 'آخر نموذج مستخدم')) +
      sec('نموذج المهام الخلفية', 'يتولّى العنوان التلقائي واستخراج المهارات بنموذج صغير وسريع بدل نموذج المحادثة. إن فشل جُرّبت البدائل ثم نموذج المحادثة.',
        select('util', 'text', D.util.sel, 'نفس نموذج المحادثة') + fbBlock('util', 'text')) +
      sec('نموذج الرؤية', 'يُستخدم لتحليل الصور حين لا يدعم نموذج المحادثة الرؤية (◉ = يدعمها بحسب الاسم).',
        select('vision', 'vision', D.vision.sel, 'تلقائي (نموذج المحادثة)') + fbBlock('vision', 'vision')) +
      sec('نموذج البحث العميق', 'النموذج الذي ينفّذ التخطيط والتقرير في «البحث العميق» والمهام البحثية.',
        select('research', 'text', settings.research.sel, 'نفس نموذج المحادثة')) +
      sec('نموذج توليد الصور', 'اكتب في المحادثة <b dir="ltr">/صورة</b> أو <b dir="ltr">/img</b> ثم وصف الصورة لتوليدها بهذا النموذج، دون تغيير نموذج المحادثة.',
        select('image', 'image', D.image, 'غير محدّد'));
  }

  function setVal(id, v){
    const s = v ? parse(v) : null;
    if (id === 'chat') D.chat = s;
    else if (id === 'util') D.util.sel = s;
    else if (id === 'vision') D.vision.sel = s;
    else if (id === 'image') D.image = s;
    else if (id === 'research') settings.research.sel = s;
    else {
      const m = /^(util|vision)-fb-(\d+)$/.exec(id); if (!m) return;
      const arr = D[m[1]].fb, i = +m[2];
      if (s) arr[i] = s; else arr.splice(i, 1);
    }
  }
  if (root){
    root.addEventListener('change', e => {
      const t = e.target.closest('select[data-d]'); if (!t) return;
      setVal(t.dataset.d, t.value); save(); render(); toast('تم الحفظ');
    });
    root.addEventListener('click', e => {
      const a = e.target.closest('[data-add]'), r = e.target.closest('[data-rm]');
      if (a){
        const key = a.dataset.add, am = activeModel(); if (D[key].fb.length >= MAX_FB) return;
        const first = settings.endpoints.find(x => x.enabled && x.models.some(m => m.on && !isImgModel(x, m.id)));
        const m = first && first.models.find(x => x.on && !isImgModel(first, x.id));
        D[key].fb.push(am && !isImgModel(am.ep, am.model) ? { ep:am.ep.id, model:am.model } : m ? { ep:first.id, model:m.id } : null);
        D[key].fb = D[key].fb.filter(Boolean); save(); render();
      } else if (r){
        const [key, i] = r.dataset.rm.split(':'); D[key].fb.splice(+i, 1); save(); render();
      }
    });
  }
  window.renderDefs = render;
  window.__defSub = () => {
    const n = [D.chat, D.util.sel, D.vision.sel, settings.research.sel, D.image].filter(Boolean).length;
    return n ? `${n} من 5 مضبوطة` : 'نموذج لكل مهمة';
  };
  setTimeout(() => window.applyDefaultChatModel(), 0);
})();
