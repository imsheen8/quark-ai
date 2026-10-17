/* QUARK AI — المحمّل: يجلب مقاطع HTML ثم يشغّل ملفات JS بالترتيب */
(async () => {
  const showError = (e) => {
    const d = document.createElement('div');
    d.dir = 'rtl';
    d.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:#161616;color:#eee;font:16px/1.9 system-ui,Tahoma,sans-serif;text-align:center;z-index:99999';
    d.innerHTML = '<div style="max-width:560px"><h2 style="margin:0 0 10px">تعذّر تحميل أجزاء التطبيق</h2>' +
      '<p>التطبيق مقسّم لعدة ملفات، لذلك يجب تشغيله عبر خادم محلي بدل فتح <code>index.html</code> بالنقر المزدوج.</p>' +
      '<p dir="ltr" style="background:#222;border-radius:10px;padding:10px;font-family:monospace">python -m http.server 8000<br>http://localhost:8000</p>' +
      '<p style="opacity:.6;font-size:13px" dir="ltr">' + String(e && e.message || e) + '</p></div>';
    document.body.appendChild(d);
    console.error('QUARK loader:', e);
  };

  try {
    // 0) التخزين: نحمّل كل البيانات من بايثون قبل تشغيل أي ملف (أو نعود لتخزين المتصفح إن لم يوجد خادم).
    //    وهو يستعيد/ينقل أيضًا نسخة ملفات الأندرويد القديمة (quark/state.json) عند الحاجة.
    await new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'js/core/kv.js'; s.onload = ok; s.onerror = () => fail(new Error('تعذّر تحميل js/core/kv.js'));
      document.head.appendChild(s);
    });
    await window.QuarkKV.init();

    // 1) HTML: استبدال كل عنصر data-include بمحتوى ملفه (يحفظ الترتيب الأصلي للعناصر)
    const slots = [...document.querySelectorAll('[data-include]')];
    const parts = await Promise.all(slots.map(async (el) => {
      const r = await fetch(el.dataset.include, { cache: 'no-cache' });
      if (!r.ok) throw new Error(el.dataset.include + ' → ' + r.status);
      return r.text();
    }));
    slots.forEach((el, i) => { el.outerHTML = parts[i]; });

    // 2) JS: تُحمَّل بالتوازي وتُنفَّذ بالترتيب (async=false)
    const list = (window.QUARK_MANIFEST || {}).scripts || [];
    await Promise.all(list.map((src) => new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = ok; s.onerror = () => fail(new Error('تعذّر تحميل ' + src));
      document.body.appendChild(s);
    })));
  } catch (e) { showError(e); }
})();
