const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:412,height:860}});
await ctx.addInitScript(()=>{try{localStorage.setItem('ai_intro','false');localStorage.setItem('ai_onboarded','true')}catch{}});
const p=await ctx.newPage();let ok=0,bad=0;const t=(n,c)=>{console.log((c?'✓ ':'✗ ')+n);c?ok++:bad++};
await p.goto('http://localhost:8123/index.html');await p.waitForFunction(()=>typeof openSettings==='function',null,{timeout:25000});
await p.addStyleTag({content:'#qiHost,#qiCover{display:none!important}'});
for(const tab of ['keys','integrations','research','agent']){
 await p.evaluate(x=>openSettings(x),tab);await p.waitForTimeout(600);
 const txt=await p.evaluate(()=>document.getElementById('modal')?.innerText||document.body.innerText);
 t(tab+': no serve.py/QUARK_GW/HMAC',!/serve\.py|QUARK_GW|HMAC|X-Quark/.test(txt));
 if(tab==='keys') t('gateway panel hidden',await p.evaluate(()=>{const e=document.getElementById('gwPanel');return !e||e.offsetParent===null}));
 if(tab==='agent') t('no tool code names',!/web_search|run_js|memory_save/.test(txt));
}
console.log(ok+'/'+(ok+bad));await b.close();process.exit(bad?1:0)})();
