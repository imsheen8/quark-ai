/* QUARK AI — رمز الأمان (PIN) وSHA-256 */
'use strict';

/* ================= شاشة البداية + رمز الأمان ================= */
/*SHA_START*/
const SHA_K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
function sha256(msg){
  const m = new TextEncoder().encode(msg), l = m.length, bits = l * 8;
  const n = ((l + 9 + 63) >> 6) << 6, buf = new Uint8Array(n);
  buf.set(m); buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(n - 8, Math.floor(bits / 4294967296)); dv.setUint32(n - 4, bits >>> 0);
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w = new Uint32Array(64), rotr = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64){
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++){
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + (rotr(a,7) ^ rotr(a,18) ^ (a >>> 3)) + w[i - 7] + (rotr(b,17) ^ rotr(b,19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++){
      const t1 = (h + (rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, x => x.toString(16).padStart(8, '0')).join('');
}
/*SHA_END*/

const PIN_LEN = 4;
const hasLock = () => !!store.get('ai_lock', null);
function setPin(pin){
  const salt = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  store.set('ai_lock', { salt, hash:sha256(salt + ':' + pin) });
  store.set('ai_lock_fails', 0); store.set('ai_lock_until', 0);
}
function checkPin(pin){
  const L = store.get('ai_lock', null); if (!L) return { ok:true };
  const now = Date.now(), until = store.get('ai_lock_until', 0);
  if (until > now) return { ok:false, msg:`محاولات كثيرة — انتظر ${Math.ceil((until - now) / 1000)} ثانية` };
  if (sha256(L.salt + ':' + pin) === L.hash){ store.set('ai_lock_fails', 0); return { ok:true }; }
  const f = store.get('ai_lock_fails', 0) + 1;
  if (f >= 5){ store.set('ai_lock_fails', 0); store.set('ai_lock_until', now + 30000); return { ok:false, msg:'محاولات كثيرة — انتظر 30 ثانية' }; }
  store.set('ai_lock_fails', f);
  return { ok:false, msg:`الرمز غير صحيح (${5 - f} محاولات متبقية)` };
}

const pinOv = $('pinOv');
let pinBuf = '', pinRes = null, pinCancellable = false, pinLinkFn = null;
$('pinDots').innerHTML = '<i></i>'.repeat(PIN_LEN);
$('pinPad').innerHTML = [1,2,3,4,5,6,7,8,9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('') +
  '<button type="button" class="fn" data-k="cancel" id="pinCancelBtn">إلغاء</button><button type="button" data-k="0">0</button>' +
  '<button type="button" class="fn" data-k="back" aria-label="حذف"><svg class="i" viewBox="0 0 24 24"><path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><path d="m18 9-6 6"/><path d="m12 9 6 6"/></svg></button>';
function pinPaint(){ [...$('pinDots').children].forEach((d, i) => d.classList.toggle('on', i < pinBuf.length)); }
function pinOpen({ title, sub = '', err = '', cancellable = false, link = '', onLink = null }){
  return new Promise(res => {
    pinRes = res; pinBuf = ''; pinCancellable = cancellable; pinLinkFn = onLink;
    $('pinAva').innerHTML = avatarHTML(getProfile());
    $('pinTitle').textContent = title;
    const p = $('pinSub'); p.textContent = err || sub; p.classList.toggle('err', !!err);
    $('pinCancelBtn').style.visibility = cancellable ? 'visible' : 'hidden';
    const lk = $('pinLink'); lk.hidden = !link; lk.textContent = link;
    const dots = $('pinDots'); dots.classList.remove('shake');
    if (err){ void dots.offsetWidth; dots.classList.add('shake'); }
    pinPaint(); pinOv.hidden = false;
  });
}
function pinClose(){ pinOv.hidden = true; pinRes = null; pinBuf = ''; }
function pinPress(k){
  if (!pinRes) return;
  if (k === 'back'){ pinBuf = pinBuf.slice(0, -1); pinPaint(); return; }
  if (k === 'cancel'){ if (pinCancellable){ const r = pinRes; pinRes = null; r(null); } return; }
  if (pinBuf.length >= PIN_LEN) return;
  pinBuf += k; pinPaint();
  if (pinBuf.length === PIN_LEN){ const r = pinRes, v = pinBuf; pinRes = null; setTimeout(() => r(v), 130); }
}
$('pinPad').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) pinPress(b.dataset.k); });
$('pinLink').addEventListener('click', () => pinLinkFn?.());
document.addEventListener('keydown', e => {
  if (pinOv.hidden) return;
  if (/^\d$/.test(e.key)) pinPress(e.key);
  else if (e.key === 'Backspace') pinPress('back');
  else if (e.key === 'Escape') pinPress('cancel');
  else return;
  e.preventDefault(); e.stopPropagation();
}, true);

async function verifyCurrent(opts){
  let err = '';
  while (true){
    const pin = await pinOpen({ ...opts, err });
    if (pin === null) return false;
    const r = checkPin(pin);
    if (r.ok) return true;
    err = r.msg;
  }
}
async function pinCreate(){
  let err = '';
  while (true){
    const a = await pinOpen({ title:'رمز أمان جديد', sub:'أدخل 4 أرقام', cancellable:true, err });
    if (a === null) return null;
    const b = await pinOpen({ title:'تأكيد الرمز', sub:'أعد إدخال الرمز نفسه', cancellable:true });
    if (b === null) return null;
    if (a === b) return a;
    err = 'الرمزان غير متطابقين، حاول مجددًا';
  }
}
async function forgotPin(){
  if (!await qConfirm('سيتم مسح كل بيانات التطبيق (المحادثات والمفاتيح والرمز) ولا يمكن التراجع. متابعة؟', { ok:'مسح كل شيء' })) return;
  try{ await QuarkKV.wipe(); }catch{}
  location.reload();
}
async function lockNow(){
  const pf = getProfile(), nm = pf.nick || pf.name;
  await verifyCurrent({ title:'أدخل رمز الأمان', sub:nm ? `أهلًا ${nm}` : 'التطبيق مقفل', link:'نسيت الرمز؟', onLink:forgotPin });
  pinClose();
}
const DELAYS = [0, 30000, 60000, 300000, 900000, 3600000, -1];
const lockDelay = () => { const v = store.get('ai_lock_delay', 30000); return DELAYS.includes(v) ? v : 30000; };
let hiddenAt = 0, relocking = false;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden){ hiddenAt = Date.now(); return; }
  const lim = lockDelay();
  if (!hasLock() || relocking || !hiddenAt || lim < 0 || Date.now() - hiddenAt < lim) return;
  if (!pinOv.hidden || !$('gate').hidden) return;
  relocking = true; await lockNow(); relocking = false;
});

