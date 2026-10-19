/* QUARK AI — الإعدادات ← الوكيل، وعرض خطوات الوكيل تحت الرد */
'use strict';

(function(){
  const E = v => esc(String(v == null ? '' : v));
  const root = () => $('agRoot');
  const RISK = { safe:['محلية', ''], ext:['تقرأ من الخارج', ''], write:['تغيّر بياناتك', 'warn'], exec:['تنفّذ كودًا', 'bad'] };
  const sw = (id, on, dis) => `<input type="checkbox" class="sw" id="${id}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}>`;

  function whyOff(t){
    if (t.integ && !intDB.items.some(i => i.enabled)) return 'يحتاج تكاملًا مفعّلًا (الإعدادات ← التكاملات)';
    if (t.mem && !(settings.memory && settings.memory.enabled)) return 'الذاكرة متوقفة (صفحة الذاكرة)';
    return '';
  }

  function render(){
    const r = root(); if (!r) return;
    const names = agNames();
    let h = `<div class="panel"><h3 class="it-h"><svg class="i"><use href="#i-sparkles"/></svg>وضع الوكيل</h3>
      <p class="it-p">في هذا الوضع لا يكتفي النموذج بالإجابة: يخطّط ويستخدم الأدوات خطوة بعد خطوة (بحث الويب، قراءة صفحات، حساب، الذاكرة، تكاملاتك…) ويقرأ نتيجة كل أداة ليقرر ما بعدها، ثم يكتب جوابًا نهائيًا. تظهر الخطوات في المحادثة كخط زمني يمكن الضغط على كل خطوة فيه لمعرفة ما فعلته. يُفعَّل أيضًا من زرّي «وكيل | محادثة» في خانة الكتابة. يستطيع أيضًا إدارة مهامّك ومهاراتك وذاكرتك وإنشاء ملفات، وتنفيذ عدة استدعاءات مستقلة معًا لتسريع العمل.</p>
      <div class="it-row"><div><b>تفعيل وضع الوكيل</b><small>يُطبَّق على المحادثات الجديدة حتى تُطفئه. لا يجتمع مع البحث العميق.</small></div>${sw('agOn', agDB.on)}</div></div>`;
    h += `<div class="panel"><h3 class="it-h">الحدود والموافقات</h3>
      <div class="it-row"><div><b>أقصى عدد من استدعاءات الأدوات</b><small>يتوقف الوكيل ويجيب بما لديه عند بلوغه.</small></div>
        <select id="agMax" class="ag-sel">${[3, 5, 8, 12, 15, 20, 30, 40].map(n => `<option value="${n}" ${n === agDB.maxSteps ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="it-row"><div><b>مستوى الموافقة</b><small>الذكي: يسألك قبل تنفيذ الكود، وقبل أي حفظ في الذاكرة بعد قراءة محتوى خارجي، وقبل أي تغيير في تكاملاتك. الصارم: يسألك قبل كل أداة خارجية أو معدِّلة.</small></div>
        <select id="agAp" class="ag-sel"><option value="smart" ${agDB.approval === 'smart' ? 'selected' : ''}>ذكي (موصى به)</option><option value="strict" ${agDB.approval === 'strict' ? 'selected' : ''}>صارم</option></select></div></div>`;
    h += `<div class="panel"><h3 class="it-h">الأدوات</h3><p class="it-p">اختر ما يُسمح للوكيل باستخدامه. الأدوات التي تنقصها متطلبات تظهر معطّلة مع السبب.</p>` +
      Object.keys(AG_TOOLS).map(k => {
        const t = AG_TOOLS[k], why = whyOff(t), rk = RISK[t.risk];
        return `<div class="it-card${agDB.tools[k] && !why ? '' : ' off'}"><div class="it-top"><div><b>${E(t.label)}</b><small>${E(t.desc.split('. ')[0])}</small></div>${sw('agT-' + k, agDB.tools[k], !!why)}</div>
          <div class="it-tags"><span class="it-tag ${rk[1]}">${E(rk[0])}</span>${why ? `<span class="it-tag bad">${E(why)}</span>` : ''}${k === 'run_js' ? '<span class="it-tag">بيئة معزولة · بلا شبكة · مهلة 6 ث</span>' : ''}</div></div>`;
      }).join('') + `</div>`;
    h += `<div class="it-note">الوكيل يعمل أثناء فتح التطبيق. محتوى الويب والتكاملات يُعامَل كبيانات غير موثوقة لا كتعليمات، وتُحفظ إعدادات الوكيل على هذا الجهاز فقط. ${names.length ? `المتاح الآن: ${names.length} أدوات.` : 'لا توجد أدوات متاحة الآن.'}</div>`;
    r.innerHTML = h;
  }
  window.renderAgent = render;
  window.__agChanged = () => { if (root() && !root().closest('[hidden]')) render(); };
  window.__agSub = () => agDB.on ? `مفعّل · حتى ${agDB.maxSteps} خطوات` : 'نفّذ مهامّ بالأدوات';

  document.addEventListener('change', e => {
    const t = e.target; if (!t.closest || !t.closest('#agRoot')) return;
    if (t.id === 'agOn'){ agDB.on = t.checked; agSave(); window.__agSync?.(); if (agDB.on && $('amRs')?.classList.contains('on')) $('amRs').click();  }
    else if (t.id === 'agMax'){ agDB.maxSteps = +t.value; agSave(); }
    else if (t.id === 'agAp'){ agDB.approval = t.value === 'strict' ? 'strict' : 'smart'; agSave(); }
    else if (t.id && t.id.startsWith('agT-')){
      const k = t.id.slice(4); if (!AG_TOOLS[k]) return;
      if (k === 'run_js' && t.checked){
        qConfirm('تشغيل JavaScript يسمح للوكيل بكتابة كود ينفَّذ على جهازك داخل بيئة معزولة بلا شبكة ولا وصول لبياناتك، وتوافق أنت على كل تشغيل. هل تريد تفعيله؟', { ok:'تفعيل', cancel:'إلغاء', danger:false, title:'تفعيل تشغيل الكود' })
          .then(ok => { agDB.tools[k] = !!ok; agSave(); render(); });
        return;
      }
      agDB.tools[k] = t.checked; agSave(); render();
    }
    if (t.id === 'agOn' || t.id === 'agMax' || t.id === 'agAp') render();
  });

  /* ================= سجل الخطوات تحت الرد ================= */
  const ST = { ok:['تم', 'ok'], err:['فشل', 'bad'], denied:['رُفض', 'bad'], blocked:['محجوب', 'bad'], dup:['مكرر', ''] };
  /* بعد اكتمال الرد: نفس شكل العرض أثناء التوليد (الخط الزمني للخطوات) دون صندوق قابل للطي،
     وفي موضعه نفسه قبل الجواب النهائي. */
  window.__agDecorate = (w, m) => {
    const a = m.agent; if (!a || w.querySelector('.ag-live')) return;
    const steps = Array.isArray(a.steps) ? a.steps : [];
    if (!steps.length) return;   /* الخطوات فقط كخط زمني، بلا مربع الخطة (✔ / شطب) */
    const d = document.createElement('div'); d.className = 'ag-live ag-done';
    d.innerHTML = window.agTimeline(steps);
    const bub = w.querySelector('.bubble'); if (bub) w.insertBefore(d, bub); else w.appendChild(d);
  };
})();
