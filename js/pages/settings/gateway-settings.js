/* QUARK AI — إعدادات البوابة (الحالة، الوضع، العنوان، الرمز، وضع التفكير) */
'use strict';

(() => {
  const mode = $('gwMode'), think = $('gwThink'), url = $('gwUrl'), token = $('gwToken'), badge = $('gwBadge'), help = $('gwHelp'), check = $('gwCheck');
  if (!mode) return;
  const g = settings.gw;
  mode.value = g.mode; think.value = g.thinking; url.value = g.url; token.value = g.token;

  function paint(){
    const off = settings.gw.mode === 'off', base = gwBase();
    let t = '…', cls = '', msg = '';
    if (off){ t = 'متوقفة'; cls = ' mute'; msg = 'الاتصال مباشر من المتصفح. بعض المزوّدين قد يرفضه بسبب CORS.'; }
    else if (gwState.ok){ t = 'متصلة' + (gwIsEmbedded() ? ' · مدمجة' : '') + (gwState.version ? ' · v' + gwState.version : ''); msg = (gwIsEmbedded() ? 'البوابة تعمل داخل التطبيق نفسه (بدون خادم خارجي). ' : '') + 'تمر الطلبات عبر البوابة: صيغ أصلية (Anthropic وGemini وOllama)، إصلاح تلقائي للمعاملات، وأخطاء مفهومة.'; }
    else if (gwState.reason === 'forbidden'){ t = 'تحتاج رمزًا'; cls = ' mute'; msg = 'الخادم يرفض هذا الجهاز. عيّن <b dir="ltr">QUARK_GW_TOKEN</b> عند تشغيل الخادم وأدخله في حقل الرمز أعلاه.'; }
    else if (!base && gwNative() && gwEmb.port < 0){ t = 'تعذّر تشغيلها'; cls = ' mute'; msg = 'فشل تشغيل البوابة المدمجة في هذا الجهاز، فيستمر الاتصال المباشر. يمكنك إدخال عنوان خادم خارجي أعلاه.'; }
    else if (!base){ t = 'غير متاحة هنا'; cls = ' mute'; msg = 'التطبيق لا يعمل من خادم QUARK. شغّل <b dir="ltr">python3 serve.py</b> على جهاز آخر وأدخل عنوانه أعلاه (مثل <span dir="ltr">http://192.168.1.5:8000</span>) لتستفيد من البوابة.'; }
    else if (gwState.ok === null){ t = 'جارٍ الفحص…'; cls = ' mute'; }
    else { t = 'غير متصلة'; cls = ' mute'; msg = 'تعذّر الوصول إلى البوابة على <span dir="ltr">' + esc(base) + '</span>. تأكد أن الخادم يعمل — وإلا يستمر الاتصال المباشر.'; }
    badge.className = 'tag' + cls; badge.textContent = t; help.innerHTML = msg;
  }
  window.__gwPaint = paint;
  const apply = async () => { persistSettings(); paint(); await gwReady(true); };
  mode.addEventListener('change', () => { settings.gw.mode = mode.value; apply(); });
  think.addEventListener('change', () => { settings.gw.thinking = think.value; persistSettings(); toast(think.value === 'auto' ? 'التفكير: بحسب النموذج' : think.value === 'on' ? 'سيُطلب التفكير من النماذج التي تدعمه' : 'سيُطلب إيقاف التفكير حيث أمكن'); });
  url.addEventListener('change', () => { settings.gw.url = url.value.trim(); QuarkKV.setBoot({ url:settings.gw.url }); apply(); });
  token.addEventListener('change', () => { settings.gw.token = token.value.trim(); QuarkKV.setBoot({ token:settings.gw.token }); apply(); });
  check.addEventListener('click', async () => {
    check.disabled = true; badge.textContent = 'جارٍ الفحص…';
    const ok = await gwReady(true); paint();
    toast(ok ? 'البوابة تعمل' : gwState.reason === 'forbidden' ? 'البوابة تطلب رمزًا' : 'تعذّر الوصول للبوابة');
    check.disabled = false;
  });
  paint(); gwReady().then(paint);
})();
