/* QUARK AI — انميشن الدخول وصفحة تسجيل الدخول
   نوعان:
   1) runFull(opts): أول فتح (نفس انميشن الشعار ← تسجيل الدخول/إنشاء حساب). تُرجع بيانات المستخدم عند الضغط على «ابدأ».
   2) playLogo(): الشعار فقط عند فتح التطبيق (يُتحكَّم بها من الإعدادات ← عام ← انميشن الدخول).
   الواجهة تُعرض داخل Shadow DOM حتى لا يتعارض تنسيقها مع تنسيق التطبيق (الملفات: pages/gate/intro.html و css/pages/gate/intro.css). */
'use strict';

window.QuarkIntro = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let parts = null, host = null, root = null, token = 0;
  const cleanups = [];
  const $ = id => root.getElementById(id);
  const escH = t => String(t).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  const arNum = n => n.toLocaleString('ar-EG');
  const mailOk = v => /^\S+@\S+\.\S+$/.test(v);

  class Cancel extends Error {}
  const sleep = (ms, t) => new Promise((res, rej) => setTimeout(() => t === token ? res() : rej(new Cancel()), reduce ? ms / 3 : ms));

  /* ---------- التحميل والعرض ---------- */
  const load = () => parts || (parts = Promise.all(['css/pages/gate/intro.css', 'pages/gate/intro.html'].map(u =>
    fetch(u, { cache:'no-cache' }).then(r => { if (!r.ok) throw new Error(u + ' → ' + r.status); return r.text(); }))));

  /* الغطاء الداكن في index.html يمنع ظهور واجهة التطبيق قبل بدء الانميشن */
  const uncover = () => { document.getElementById('qiCover')?.remove(); };

  async function mount(fast){
    const [css, html] = await load();
    host = document.createElement('div');
    host.id = 'qiHost'; host.dir = 'rtl';
    host.style.cssText = 'position:fixed;inset:0;z-index:400;opacity:1;transition:opacity .45s ease';
    root = host.attachShadow({ mode:'open' });
    root.innerHTML = '<style>' + css + '</style><div class="qi' + (fast ? ' fast' : '') + '" id="qi">' + html + '</div>';
    document.body.appendChild(host);
    uncover();
  }

  function close(){
    return new Promise(res => {
      token++;
      cleanups.splice(0).forEach(f => { try{ f(); }catch{} });
      if (!host){ res(); return; }
      const h = host; host = null; root = null;
      h.style.opacity = '0'; h.style.pointerEvents = 'none';
      setTimeout(() => { h.remove(); res(); }, reduce ? 30 : 480);
    });
  }

  const show = id => root.querySelectorAll('.scene').forEach(s => s.classList.toggle('on', s.id === id));

  function buildWord(){
    const word = $('word');
    'QUARK AI'.split('').forEach((c, i) => {
      const s = document.createElement('span');
      if (c === ' ') s.className = 'sp'; else s.textContent = c;
      if (i > 5) s.classList.add('ac');
      word.appendChild(s);
    });
    return word;
  }

  /* ---------- 2) الشعار فقط ---------- */
  async function playLogo(){
    try{ await mount(true); }catch(e){ console.warn('QuarkIntro:', e); uncover(); return; }
    const t = ++token, S = ms => sleep(ms, t), word = buildWord();
    $('sSplash').addEventListener('click', () => { token++; });   /* لمسة = تخطي */
    try{
      show('sSplash');
      await S(250);
      $('glow').classList.add('on'); $('logo').classList.add('draw');
      await S(950);
      for (const s of word.querySelectorAll('span')){ s.classList.add('in'); await S(45); }
      await S(200);
      $('tag').classList.add('in');
      await S(800);
    }catch(e){ if (!(e instanceof Cancel)) console.warn(e); }
    if (!root) return;
    $('sSplash').classList.add('out');
    await new Promise(r => setTimeout(r, reduce ? 30 : 320));
    await close();
  }

  /* ---------- 1) المقدمة الكاملة + تسجيل الدخول ---------- */
  function runFull(opts){
    return new Promise(async (resolve, reject) => {
      try{ await mount(true); }catch(e){ uncover(); reject(e); return; }
      const login = createLogin(opts, resolve);
      const word = buildWord();
      const t = ++token, S = ms => sleep(ms, t);

      const toLogin = () => { token++; show('sLogin'); login.start(); setTimeout(() => $('sLogin')?.classList.add('on'), 60); };
      const skip = $('skipSplash'); if (skip) skip.onclick = toLogin;
      $('sSplash').addEventListener('click', toLogin);   /* لمسة = تخطي */

      try{
        /* نفس انميشن الشعار الذي يظهر عند كل فتح (قابل للإيقاف من الإعدادات ← عام ← انميشن الدخول) ثم صفحة الدخول مباشرة */
        const on = typeof introOn === 'function' ? introOn() : true;
        if (on){
          show('sSplash');
          await S(250);
          $('glow').classList.add('on'); $('logo').classList.add('draw');
          await S(950);
          for (const s of word.querySelectorAll('span')){ s.classList.add('in'); await S(45); }
          await S(200);
          $('tag').classList.add('in');
          await S(800);
          $('sSplash').classList.add('out');
          await S(320);
        }
        toLogin();
      }catch(e){ if (!(e instanceof Cancel)) console.error(e); }
    });
  }

  /* ---------- صفحة تسجيل الدخول (نافذة سفلية) ---------- */
  function createLogin(opts, resolve){
    const FLOW = ['account', 'profile', 'model', 'done'];
    const OPTIONAL = new Set(['model']);
    const TITLES = { account:'الحساب', profile:'الملف الشخصي', model:'الاتصال بالنموذج', done:'جاهز' };
    const presets = opts.presets || {}, models = opts.models || {};
    const state = { photo:(opts.profile && opts.profile.photo) || '', skipped:{}, signedIn:false, busy:false };
    let cur = opts.hasAccount ? 'signin' : 'account';
    const app = $('app');
    const secs = [...root.querySelectorAll('.step')];
    const byId = id => secs.find(s => s.dataset.id === id);

    /* ---------- الرسم ---------- */
    const segs = $('segs');
    segs.innerHTML = FLOW.map(() => '<i></i>').join('');
    function paint(){
      const idx = FLOW.indexOf(cur);
      $('prog').style.visibility = idx < 0 ? 'hidden' : 'visible';
      [...segs.children].forEach((b, i) => { b.className = (cur === 'done' || i < idx) ? 'done' : (i === idx ? 'cur' : ''); });
      $('meta').textContent = idx < 0 ? '' : `الخطوة ${arNum(idx + 1)} من ${arNum(FLOW.length)} · ${TITLES[cur]}`;
      $('nextLbl').textContent = cur === 'signin' ? 'تسجيل الدخول' : (cur === 'done' ? 'ابدأ' : 'التالي');
      $('back').hidden = cur === 'signin' || cur === 'done';
      $('skip').hidden = !OPTIONAL.has(cur);
    }
    function showStep(id, back){
      cur = id;
      secs.forEach(s => s.classList.remove('on', 'back-dir'));
      const s = byId(id); s.classList.add('on'); if (back) s.classList.add('back-dir');
      s.querySelectorAll('.gate-err').forEach(e => e.hidden = true);
      if (id === 'done') paintDone();
      paint();
      app.scrollTo({ top:0 });
    }
    const nextStep = () => showStep(FLOW[FLOW.indexOf(cur) + 1]);
    const prevStep = () => cur === 'account' ? showStep('signin', true) : showStep(FLOW[FLOW.indexOf(cur) - 1], true);

    function err(msg){
      const e = byId(cur).querySelector('.gate-err'); if (!e) return false;
      e.textContent = msg; e.hidden = false; e.classList.remove('shake'); void e.offsetWidth; e.classList.add('shake');
      e.scrollIntoView({ block:'nearest', behavior:'smooth' });
      return false;
    }

    /* ---------- خطوة النموذج: المزوّدون من إعدادات التطبيق ---------- */
    const mdPreset = $('mdPreset'), mdUrl = $('mdUrl'), mdKey = $('mdKey');
    mdPreset.innerHTML = Object.entries(presets).map(([k, p]) => `<option value="${escH(k)}">${escH(p.label)}</option>`).join('');
    function applyPreset(){
      const k = mdPreset.value, p = presets[k]; if (!p) return;
      mdUrl.hidden = !['custom', 'ollama', 'lmstudio'].includes(k); mdUrl.value = p.url || '';
      $('mdHelp').innerHTML = p.help || 'يُحفظ المفتاح على جهازك فقط.';
      mdKey.placeholder = p.kind === 'local' ? 'مفتاح API (اختياري)' : 'مفتاح API';
      $('mdModels').innerHTML = (models[k] || []).map(m => `<option value="${escH(m)}">`).join('');
    }
    if (presets.openrouter) mdPreset.value = 'openrouter';
    mdPreset.onchange = applyPreset; applyPreset();
    $('mdNote').hidden = !opts.hasEndpoints;
    const modelPick = () => {
      const k = mdPreset.value, p = presets[k] || {};
      return { preset:k, url:(mdUrl.hidden ? (p.url || '') : mdUrl.value).trim().replace(/\/+$/, ''), key:mdKey.value.trim(), model:$('mdModel').value.trim() };
    };

    /* ---------- التحقق ---------- */
    const validators = {
      signin(){
        const m = $('siMail').value.trim(), p = $('siPass').value;
        if (!mailOk(m)) return err('أدخل بريدًا إلكترونيًا صحيحًا');
        if (!p) return err('أدخل كلمة المرور');
        const bad = opts.signIn ? opts.signIn(m, p) : '';
        return bad ? err(bad) : true;
      },
      account(){
        const m = $('acMail').value.trim(), p = $('acPass').value, p2 = $('acPass2').value;
        if (!mailOk(m)) return err('أدخل بريدًا إلكترونيًا صحيحًا');
        if (p.length < 8) return err('كلمة المرور يجب ألا تقل عن 8 أحرف');
        if (p !== p2) return err('كلمتا المرور غير متطابقتين');
        return true;
      },
      profile(){ return $('pfName').value.trim() ? true : err('اكتب اسمك للمتابعة'); },
      model(){
        const v = modelPick(), p = presets[v.preset] || {};
        if (v.key || v.model){
          if (!v.model) return err('اكتب اسم النموذج الذي تريد استخدامه');
          if (p.kind !== 'local' && !v.key) return err('أدخل مفتاح API');
          if (!/^https?:\/\/\S+/i.test(v.url)) return err('أدخل عنوان API صحيحًا يبدأ بـ http');
        }
        return true;
      },
    };

    function finish(){
      if (state.busy) return; state.busy = true;
      const skippedModel = state.skipped.model || !(mdKey.value.trim() || $('mdModel').value.trim());
      resolve(state.signedIn
        ? { mode:'signin', email:$('siMail').value.trim() }
        : { mode:'signup', email:$('acMail').value.trim(), password:$('acPass').value, name:$('pfName').value.trim(), photo:state.photo,
            model: skippedModel ? null : modelPick() });
    }

    $('next').onclick = () => {
      if (validators[cur] && !validators[cur]()) return;
      if (cur === 'signin'){ state.signedIn = true; return showStep('done'); }
      if (cur === 'done') return finish();
      state.skipped[cur] = false; nextStep();
    };
    $('skip').onclick = () => {
      state.skipped[cur] = true;
      if (cur === 'model'){ mdKey.value = ''; $('mdModel').value = ''; }
      nextStep();
    };
    $('back').onclick = prevStep;
    $('toSignin').onclick = () => showStep('signin');
    $('toSignup').onclick = () => showStep('account', true);
    root.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches && e.target.matches('input:not([type=file])')){ e.preventDefault(); $('next').click(); }
    });

    /* إظهار/إخفاء كلمة المرور */
    root.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => {
      const i = b.parentElement.querySelector('input'), on = i.type === 'password';
      i.type = on ? 'text' : 'password';
      b.querySelector('use').setAttribute('href', on ? '#i-eye-off' : '#i-eye');
    });

    /* الصورة */
    function paintAva(){
      const nm = $('pfName').value.trim();
      $('pfAva').innerHTML = state.photo ? `<img src="${state.photo}" alt="">` : (nm ? escH(nm[0].toUpperCase()) : '<svg class="i"><use href="#i-user"/></svg>');
      $('pfPhotoRm').hidden = !state.photo;
    }
    $('pfName').value = (opts.profile && opts.profile.name) || '';
    $('pfName').oninput = paintAva;
    $('pfPhotoBtn').onclick = () => $('pfFile').click();
    $('pfPhotoRm').onclick = () => { state.photo = ''; paintAva(); };
    $('pfFile').onchange = e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const img = new Image(), url = URL.createObjectURL(f);
      img.onload = () => {
        const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
        const m = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
        URL.revokeObjectURL(url); state.photo = c.toDataURL('image/jpeg', .85); paintAva();
      };
      img.onerror = () => { URL.revokeObjectURL(url); err('تعذّر قراءة الصورة'); };
      img.src = url;
    };
    paintAva();

    /* الملخّص */
    function paintDone(){
      const name = $('pfName').value.trim();
      $('doneTitle').textContent = state.signedIn ? 'تم تسجيل الدخول' : ('أهلًا ' + (name || 'بك'));
      const row = (k, v, cls) => `<li><span>${k}</span><b class="${cls || ''}">${v}</b></li>`;
      const mail = state.signedIn ? $('siMail').value.trim() : $('acMail').value.trim();
      let h = row('البريد', `<span dir="ltr" style="color:inherit">${escH(mail)}</span>`);
      if (!state.signedIn){
        h += row('الاسم', escH(name) || '—');
        const v = modelPick();
        h += (v.key || v.model) ? row('النموذج', escH((presets[v.preset] || {}).label || v.preset), 'ok') : row('النموذج', 'تم التخطي', 'no');
      }
      $('sum').innerHTML = h;
    }

    return { start: () => showStep(cur) };
  }

  return { runFull, playLogo, close, uncover };
})();
