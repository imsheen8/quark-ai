const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:412,height:860}});
let fail=false, calls=0;
await ctx.addInitScript(()=>{ try{localStorage.setItem('ai_intro','false')}catch{}
  window.__gsMode='ok';
  window.QuarkNative={ googleSignIn(id){ window.__gsId=id; setTimeout(()=>window.__gsResult(JSON.stringify(window.__gsMode==='ok'?{ok:true,idToken:'h.p.s',email:'a@b.c',name:'علي'}:{ok:false,code:12501,msg:'x'})),30); } };
});
await ctx.route('https://quark.wisp.uno/qk/auth', async r=>{ calls++; const body=JSON.parse(r.request().postData()||'{}');
  if(body.idToken!=='h.p.s') return r.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{message:'تعذّر التحقق من حساب Google. حاول مرة أخرى.'}})});
  r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({token:'qs.abc.def',exp:Date.now()+30*864e5,email:'a@b.c',name:'علي',picture:'',left:25,limit:25})}); });
const p=await ctx.newPage();let ok=0,bad=0;const t=(n,c)=>{console.log((c?'✓ ':'✗ ')+n);c?ok++:bad++};
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8123/index.html');
await p.waitForSelector('#gsGate',{timeout:25000});
t('تظهر شاشة الدخول قبل أي شيء',await p.isVisible('#gsGate #gsGo'));
await p.screenshot({path:'/tmp/gs1.png'});
// إلغاء من المستخدم
await p.evaluate(()=>{window.__gsMode='cancel'}); await p.click('#gsGo'); await p.waitForSelector('#gsErr:not([hidden])');
t('الإلغاء يُظهر رسالة ويبقي الشاشة',/أُلغي/.test(await p.textContent('#gsErr'))&&await p.isVisible('#gsGate'));
// نجاح
await p.evaluate(()=>{window.__gsMode='ok'}); await p.click('#gsGo'); await p.waitForSelector('#gsGate',{state:'detached',timeout:10000});
t('أُرسل معرّف العميل الصحيح',await p.evaluate(()=>window.__gsId)==='549746092483-2j03teo8tjkrp4i3ucshg2edjbe2bhqo.apps.googleusercontent.com');
t('طُلبت الجلسة من الوسيط مرة واحدة',calls===1);
await p.waitForFunction(()=>typeof settings!=='undefined'&&settings.endpoints.some(e=>e.managed),null,{timeout:10000});
t('مفتاح نقطة QUARK = الجلسة',await p.evaluate(()=>settings.endpoints.find(e=>e.managed).key==='qs.abc.def'));
t('حُفظ التسجيل (onboarded)',await p.evaluate(()=>JSON.parse(localStorage.getItem('ai_onboarded')||'null')===true||store.get('ai_onboarded',false)===true));
t('اسم الملف الشخصي من Google',await p.evaluate(()=>getProfile().name==='علي'));
t('QuarkAuth.needed() = false بعد الدخول',await p.evaluate(()=>QuarkAuth.needed()===false));
// انتهاء الجلسة أثناء الاستخدام → تعود الشاشة
await p.evaluate(()=>QuarkAuth.onError('quark: سجّل الدخول بحساب Google للمتابعة.'));
await p.waitForSelector('#gsGate',{timeout:5000}); t('خطأ «سجّل الدخول» يعيد الشاشة ويمسح الجلسة',await p.evaluate(()=>!QuarkAuth.session()));
t('لا أخطاء JS',errs.length===0); if(errs.length)console.log(errs);
console.log(ok+'/'+(ok+bad));await b.close();process.exit(bad?1:0)})();
