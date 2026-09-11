import { chromium } from 'playwright';
import { auditHotel } from './audit.js';

const base=required('OTA_BASE_URL').replace(/\/$/,''); const token=required('OTA_RUNNER_TOKEN'); const browser=await chromium.launch({headless:true});
let failed=false;
try { for(let i=0;i<3;i++) { let job;
  try {
    const r=await fetch(base+'/automation/runner/pull.php',{headers:{Authorization:'Bearer '+token}}); if(r.status===204){console.log('Aucun autre audit en attente.');break} if(!r.ok)throw new Error('pull HTTP '+r.status); job=await r.json();
    const audit=await auditHotel(browser,job.case,{timeout:30000});
    const pushed=await fetch(base+'/automation/runner/push.php',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({job_id:job.job_id,audit})}); if(!pushed.ok)throw new Error('push HTTP '+pushed.status+' '+await pushed.text()); console.log(`Audit ${job.case.id}: ${audit.score}/100, ${audit.score_basis.available}/${audit.score_basis.total} contrôles disponibles.`);
  } catch(e) { failed=true; console.error(e); if(job?.job_id) await fetch(base+'/automation/runner/push.php',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({job_id:job.job_id,error:String(e.message).slice(0,1000)})}).catch(()=>{}); }
} } finally { await browser.close(); }
if(failed) process.exitCode=1;
function required(k){const v=process.env[k];if(!v)throw new Error('Secret GitHub manquant: '+k);return v}
