/* QUARK AI — تسجيل الدخول بحساب Google (لنقطة QUARK المُدارة فقط).
   التطبيق يحصل من Google على رمز هوية، ويبدله عند الوسيط بجلسة خاصة (تُحفظ هنا وتُرسل كمفتاح).
   العدّاد اليومي مرتبط بالحساب لا بالجهاز. يعمل داخل تطبيق أندرويد فقط (الجسر QuarkNative.googleSignIn). */
const GOOGLE_CLIENT_ID = '549746092483-2j03teo8tjkrp4i3ucshg2edjbe2bhqo.apps.googleusercontent.com';

const QuarkAuth = (() => {
  const KEY = 'ai_auth';
  const base = () => String(MANAGED_URL || '').replace(/\/+$/, '');
  const load = () => { try { return store.get(KEY, null); } catch { return null; } };
  const valid = (a) => !!(a && a.token && a.exp > Date.now() + 60000);
  const native = () => !!(window.QuarkNative && typeof window.QuarkNative.googleSignIn === 'function');
  const needed = () => !!MANAGED_URL && native() && !valid(load());
  const session = () => { const a = load(); return valid(a) ? a : null; };

  const MSG = { 12501: 'أُلغي تسجيل الدخول.', 12502: 'جارٍ تسجيل الدخول…', 7: 'تعذّر الاتصال. تحقق من الإنترنت.', 10: 'إعداد Google غير مطابق لهذا التطبيق (رمز 10).', 12500: 'تعذّر تسجيل الدخول (رمز 12500). حدّث خدمات Google Play ثم أعد المحاولة.' };

  function nativeSignIn() {
    return new Promise((res, rej) => {
      window.__gsResult = (s) => {
        try {
          const o = typeof s === 'string' ? JSON.parse(s) : s;
          if (o && o.ok && o.idToken) res(o); else rej(new Error(MSG[o && o.code] || ('تعذّر تسجيل الدخول' + (o && o.code ? ' (رمز ' + o.code + ')' : '')) + '')); 
        } catch (e) { rej(e); }
      };
      try { window.QuarkNative.googleSignIn(GOOGLE_CLIENT_ID); } catch (e) { rej(e); }
    });
  }

  async function signIn() {
    const g = await nativeSignIn();
    let r;
    try {
      r = await fetch(base() + '/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: g.idToken }) });
    } catch { throw new Error('تعذّر الاتصال بالخدمة. تحقق من الإنترنت.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) throw new Error((j.error && j.error.message) || 'تعذّر تسجيل الدخول.');
    store.set(KEY, { token: j.token, exp: j.exp, email: j.email || '', name: j.name || '', picture: j.picture || '', left: j.left, limit: j.limit });
    try { ensureManaged(); } catch {}
    try { const pf = getProfile(); if (!pf.name && j.name) { pf.name = j.name; setProfile(pf); renderAvatars(); } } catch {}
    return load();
  }

  function signOut() {
    try { store.remove(KEY); } catch {}
    try { ensureManaged(); } catch {}
  }

  /* شاشة الدخول: تبقى حتى ينجح الدخول */
  let gateOn = null;
  function gate() {
    if (gateOn) return gateOn;
    gateOn = new Promise((done) => {
      const d = document.createElement('div');
      d.id = 'gsGate'; d.setAttribute('dir', 'rtl');
      d.innerHTML = '<div class="gs-box"><div class="gs-logo">QUARK <b>AI</b></div>'
        + '<h1 class="gs-t">أهلًا بك</h1><p class="gs-p">سجّل الدخول بحساب Google لاستخدام QUARK. حسابك يحفظ رسائلك اليومية المتبقية ويحميها.</p>'
        + '<button class="gs-btn" id="gsGo" type="button"><svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17.5z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 010-9.4l-7.9-6.1a24 24 0 000 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg><span>المتابعة بحساب Google</span></button>'
        + '<p class="gs-e" id="gsErr" hidden></p></div>';
      const st = document.createElement('style');
      st.textContent = '#gsGate{position:fixed;inset:0;z-index:100000;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}'
        + '#gsGate .gs-box{width:100%;max-width:360px;text-align:center}'
        + '#gsGate .gs-logo{font-size:30px;letter-spacing:.14em;font-weight:300;color:var(--text);margin-bottom:34px}#gsGate .gs-logo b{color:var(--accent);font-weight:600}'
        + '#gsGate .gs-t{font-size:22px;margin:0 0 10px;color:var(--text)}#gsGate .gs-p{font-size:14px;line-height:1.9;color:var(--text-2);margin:0 0 28px}'
        + '#gsGate .gs-btn{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;height:52px;border-radius:14px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:16px;cursor:pointer}'
        + '#gsGate .gs-btn:active{background:var(--surface-2)}#gsGate .gs-btn[disabled]{opacity:.6}'
        + '#gsGate .gs-e{margin:16px 0 0;font-size:13.5px;line-height:1.8;color:#d9534f}';
      d.appendChild(st); document.body.appendChild(d);
      document.getElementById('qiCover')?.remove();
      const btn = d.querySelector('#gsGo'), err = d.querySelector('#gsErr');
      btn.addEventListener('click', async () => {
        btn.disabled = true; err.hidden = true;
        try { await signIn(); d.remove(); gateOn = null; store.set('ai_onboarded', true); done(true); }
        catch (e) { err.textContent = (e && e.message) || 'تعذّر تسجيل الدخول.'; err.hidden = false; btn.disabled = false; }
      });
    });
    return gateOn;
  }

  /* خطأ ظهر في المحادثة يطلب تسجيل الدخول (انتهت الجلسة أو غير موجودة) */
  function onError(msg) {
    if (!/سجّل الدخول بحساب Google/.test(String(msg || ''))) return;
    if (!native()) return;
    try { store.remove(KEY); ensureManaged(); } catch {}
    gate();
  }
  return { needed, session, signIn, signOut, gate, onError, info: load };
})();
window.QuarkAuth = QuarkAuth;
