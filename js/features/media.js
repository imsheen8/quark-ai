/* QUARK AI — الكاميرا + معاينة الصورة + لصق وسحب الصور */
'use strict';

/* ----- الكاميرا ----- */
const cam = { stream:null, facing:'user' };
function openCamera(){
  if (pending.filter(p => p.kind === 'image').length >= IMG_MAX){ toast(`الحد الأقصى ${IMG_MAX} صور في الرسالة`); return; }
  if (matchMedia('(pointer:coarse)').matches || !navigator.mediaDevices?.getUserMedia){ $('camInput').click(); return; }
  cam.facing = 'user'; camStart();
}
function camStop(){ cam.stream?.getTracks().forEach(t => t.stop()); cam.stream = null; }
async function camStart(){
  camStop();
  try{
    cam.stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:cam.facing, width:{ ideal:1920 }, height:{ ideal:1080 } }, audio:false });
  }catch{ toast('تعذّر الوصول إلى الكاميرا — اسمح للمتصفح باستخدامها'); camClose(); return; }
  const v = $('camVideo'); v.srcObject = cam.stream; v.classList.toggle('mirror', cam.facing === 'user');
  $('camOv').classList.add('show'); v.play().catch(() => {});
}
function camClose(){ camStop(); $('camVideo').srcObject = null; $('camOv').classList.remove('show'); }
async function camShot(){
  const v = $('camVideo'); if (!v.videoWidth) return;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  const g = c.getContext('2d'); if (cam.facing === 'user'){ g.translate(c.width, 0); g.scale(-1, 1); }
  g.drawImage(v, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .92));
  camClose();
  if (blob) addImages([new File([blob], 'photo-' + Date.now() + '.jpg', { type:'image/jpeg' })]);
}
$('camShot').addEventListener('click', camShot);
$('camX').addEventListener('click', camClose);
$('camFlip').addEventListener('click', () => { cam.facing = cam.facing === 'user' ? 'environment' : 'user'; camStart(); });

/* ----- معاينة الصورة مكبّرة ----- */
function openImg(src){ $('imgView').src = src; $('imgOv').classList.add('show'); }
function closeImg(){ $('imgOv').classList.remove('show'); $('imgView').removeAttribute('src'); }
$('imgOv').addEventListener('click', e => { if (e.target !== $('imgView')) closeImg(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape'){ closeImg(); camClose(); } });
el.messages.addEventListener('click', e => { const im = e.target.closest('.msg-img'); if (im && im.getAttribute('src')) openImg(im.src); });

/* ----- لصق وسحب الصور ----- */
el.input.addEventListener('paste', e => {
  const fs = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (fs.length){ e.preventDefault(); addImages(fs); }
});
(() => {
  const zone = document.querySelector('.composer-box'), hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { if (hasFiles(e)){ e.preventDefault(); zone.classList.add('drop-on'); } }));
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) zone.classList.remove('drop-on'); });
  document.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); zone.classList.remove('drop-on'); addFiles([...e.dataTransfer.files]); });
})();
