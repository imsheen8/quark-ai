/* QUARK AI — نقطة اتصال مُدارة (وسيط QUARK Proxy).
   ضع عنوان الوسيط في MANAGED_URL (مثل https://example.com/v1) فيُضاف تلقائيًا كنقطة اتصال للنموذج الافتراضي،
   والمفتاح هو معرّف عشوائي لهذا الجهاز (لا مفتاح حقيقي في التطبيق). اتركه فارغًا لتعطيل الميزة. */
const MANAGED_URL = 'https://quark.wisp.uno/v1';
const MANAGED_MODEL = 'quark';
const MANAGED_SECRET = '';   /* نفس APP_SECRET في الوسيط إن استخدمته */

const managedDeviceId = () => {
  let id = null;
  try { id = store.get('ai_device_id', null); } catch {}
  if (!id || typeof id !== 'string' || id.length < 16) {
    const a = new Uint8Array(18); (crypto || window.crypto).getRandomValues(a);
    id = 'q' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    try { store.set('ai_device_id', id); } catch {}
  }
  return id;
};

function ensureManaged(){
  if (!MANAGED_URL) return;
  const key = (MANAGED_SECRET ? MANAGED_SECRET + ':' : '') + managedDeviceId();
  let e = settings.endpoints.find((x) => x.managed);
  const first = !e;
  if (!e) {
    e = { id:'managed', preset:'custom', url:MANAGED_URL, key, proto:'openai', kind:'api', enabled:true, managed:true, models:[{ id:MANAGED_MODEL, on:true }] };
    settings.endpoints.unshift(e);
  } else { e.url = MANAGED_URL; e.key = key; e.enabled = true; if (!e.models?.length) e.models = [{ id:MANAGED_MODEL, on:true }]; }
  if (first && !settings.sel) settings.sel = { ep:e.id, model:MANAGED_MODEL };
  persistSettings();
}
ensureManaged();

/* المتبقي اليوم من الوسيط (أو null) */
async function managedLeft(){
  if (!MANAGED_URL) return null;
  try {
    const r = await fetch(MANAGED_URL.replace(/\/+$/, '') + '/usage', { headers:{ authorization:'Bearer ' + ((MANAGED_SECRET ? MANAGED_SECRET + ':' : '') + managedDeviceId()) } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
