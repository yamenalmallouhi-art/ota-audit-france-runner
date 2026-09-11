const CHANNELS = [
  {name:'official', match:()=>true},
  {name:'booking', match:u=>/booking\.com/i.test(u)},
  {name:'expedia', match:u=>/expedia\./i.test(u)},
  {name:'google', match:u=>/google\./i.test(u)},
  {name:'tripadvisor', match:u=>/tripadvisor\./i.test(u)}
];

export async function auditHotel(browser, hotel, options={}) {
  const timeout=options.timeout ?? 30000; const pages=[]; const limitations=[];
  const official=await visit(browser, hotel.website, 'official', timeout); pages.push(official);
  const discovered=await discover(browser, hotel, timeout).catch(e=>({urls:[],error:e.message}));
  if (discovered.error) limitations.push('Découverte des OTA partiellement indisponible : '+discovered.error);
  for (const type of ['booking','expedia','google','tripadvisor']) {
    const url=discovered.urls.find(u=>CHANNELS.find(c=>c.name===type).match(u));
    if (!url) { pages.push(unavailable(type,'Aucune page publique trouvée')); continue; }
    pages.push(await visit(browser,url,type,timeout));
  }
  const checks=buildChecks(pages,hotel); const available=checks.filter(c=>c.status!=='unknown'); const passed=available.filter(c=>c.status==='pass').length;
  const score=available.length?Math.round(100*passed/available.length):0;
  const failures=checks.filter(c=>c.status==='fail'); const unknown=checks.filter(c=>c.status==='unknown');
  const findings=failures.map(f=>({severity:'important',title:f.label,evidence:f.evidence,recommendation:f.recommendation,sources:f.sources}));
  for (const u of unknown) if (findings.length<3) findings.push({severity:'opportunity',title:u.label+' — non vérifié',evidence:u.evidence,recommendation:'Vérifier manuellement ce point si cette plateforme est importante pour l’établissement.',sources:u.sources});
  while(findings.length<3) findings.push({severity:'ok',title:'Contrôle public disponible',evidence:'Aucune anomalie vérifiée supplémentaire sur les sources accessibles.',recommendation:'Maintenir les informations publiques à jour.',sources:[hotel.website]});
  const sources=[...new Set(pages.filter(p=>p.ok).map(p=>p.url))];
  return {hotel_name:hotel.hotel_name,city:hotel.city,audited_at:new Date().toISOString(),score,score_basis:{available:available.length,total:checks.length,passed,formula:'passed / available; unknown excluded'},summary:`${available.length} contrôles observables sur ${checks.length}. ${failures.length} anomalie(s) vérifiée(s). Les contrôles inaccessibles sont exclus du score.`,findings:hotel.type==='free'?findings.slice(0,3):findings,checks,action_plan:{h48:failures.slice(0,3).map(x=>x.recommendation),d7:['Harmoniser une fiche de référence unique entre les canaux publics.'],d30:['Répéter cet audit et mesurer la conversion de réservation directe.']},limitations:[...limitations,...pages.filter(p=>!p.ok).map(p=>`${p.channel} : ${p.error}`)],sources};
}

async function discover(browser,h,timeout){
  const p=await browser.newPage(); try {
    const q=encodeURIComponent(`"${h.hotel_name}" "${h.city}" (Booking OR Expedia OR Tripadvisor)`);
    const engines=['https://html.duckduckgo.com/html/?q='+q,'https://www.bing.com/search?q='+q]; let urls=[]; let last='';
    for(const engine of engines) try { await retry(()=>p.goto(engine,{waitUntil:'domcontentloaded',timeout}),2); urls.push(...await p.locator('a').evaluateAll(as=>as.map(a=>a.href).filter(Boolean))); if(urls.some(u=>/booking\.com|expedia\.|tripadvisor\./i.test(u))) break; } catch(e) { last=e.message; }
    if(!urls.length) throw new Error(last||'Moteurs de recherche inaccessibles'); return {urls:[...new Set(urls.map(unwrap))]};
  } finally { await p.close(); }
}
function unwrap(u){ try { const x=new URL(u); return x.searchParams.get('uddg')?decodeURIComponent(x.searchParams.get('uddg')):u; } catch { return u; } }
async function visit(browser,url,channel,timeout){
  const p=await browser.newPage(); try {
    await retry(()=>p.goto(url,{waitUntil:'domcontentloaded',timeout}),3);
    await p.waitForTimeout(1200); const data=await p.evaluate(()=>{
      const text=(document.body?.innerText||'').replace(/\s+/g,' ').trim();
      const jsonld=[...document.querySelectorAll('script[type="application/ld+json"]')].map(x=>x.textContent||'').join(' ');
      return {title:document.title,text:text.slice(0,250000),jsonld:jsonld.slice(0,100000),links:[...document.links].map(a=>({text:(a.innerText||'').trim(),href:a.href})).slice(0,3000)};
    });
    if (data.text.length<100 || /captcha|access denied|verify you are human|robot/i.test(data.text.slice(0,2000))) return unavailable(channel,'Page bloquée ou contenu insuffisant',url);
    return {ok:true,channel,url:p.url(),...data};
  } catch(e){ return unavailable(channel,String(e.message).slice(0,180),url); } finally { await p.close(); }
}
async function retry(fn,n){ let err; for(let i=0;i<n;i++) try{return await fn()}catch(e){err=e; await new Promise(r=>setTimeout(r,500*2**i));} throw err; }
function unavailable(channel,error,url=''){return {ok:false,channel,url,error,text:'',jsonld:'',links:[]}}

function buildChecks(pages,h){
  const off=pages.find(p=>p.channel==='official'); const ots=pages.filter(p=>p.channel!=='official'); const all=pages.filter(p=>p.ok);
  const specs=[
    ['identity','Nom de l’hôtel',p=>contains(p,h.hotel_name),'Le nom déclaré est absent de cette page.','Afficher le nom officiel de façon cohérente.'],
    ['identity','Ville / localisation',p=>contains(p,h.city),'La ville déclarée est absente.','Harmoniser la ville et l’adresse.'],
    ['contact','Coordonnées de contact',p=>/\+?\d[\d .()-]{7,}|@[\w.-]+\.[a-z]{2,}/i.test(p.text),'Aucun téléphone ou email visible.','Rendre les coordonnées visibles.'],
    ['rooms','Chambres et catégories',p=>/chambre|room|suite|studio|double|twin/i.test(p.text),'Aucune catégorie de chambre détectée.','Décrire clairement les catégories de chambres.'],
    ['amenities','Équipements',p=>/wifi|wi-fi|climatisation|air conditioning|piscine|spa|fitness/i.test(p.text),'Aucun équipement clé détecté.','Publier une liste d’équipements à jour.'],
    ['policies','Horaires arrivée/départ',p=>/check.?in|check.?out|arrivée|départ/i.test(p.text),'Horaires non détectés.','Afficher les horaires d’arrivée et de départ.'],
    ['policies','Annulation / prépaiement',p=>/annulation|cancel|rembours|pré.?paiement|prepayment/i.test(p.text),'Politique non détectée.','Rendre les conditions d’annulation lisibles.'],
    ['food','Restaurant / petit-déjeuner',p=>/restaurant|petit.?déjeuner|breakfast|bar\b/i.test(p.text),'Information restauration non détectée.','Clarifier l’offre de restauration.'],
    ['parking','Parking',p=>/parking|stationnement|garage/i.test(p.text),'Information parking non détectée.','Préciser disponibilité et tarif du parking.'],
    ['reviews','Avis / note',p=>/avis|reviews?|\b[0-9][,.][0-9]\s*\/\s*(5|10)|étoiles/i.test(p.text),'Avis ou note non détectés.','Afficher des preuves de réputation accessibles.'],
    ['direct','Bouton de réservation directe',p=>p.links.some(l=>/réserver|book now|reservation|disponibilit/i.test(l.text+l.href)),'Aucun lien de réservation détecté.','Ajouter un appel à l’action de réservation directe visible.'],
    ['direct','Moteur de réservation distinct',p=>p.links.some(l=>/booking|reservation|availab|moteur/i.test(l.href)&&!l.href.includes(locationHost(h.website))),'Aucun moteur distinct détecté.','Vérifier que le moteur est accessible et traçable.'],
    ['price','Prix public visible',p=>/\b\d{2,4}\s?(€|EUR)|€\s?\d{2,4}/i.test(p.text),'Aucun prix public détecté.','Afficher ou rendre accessible un tarif public daté.'],
    ['content','Contenu substantiel',p=>p.text.length>1200,'Contenu public très limité.','Enrichir le contenu utile et spécifique.'],
    ['content','Photos',p=>/photo|gallery|galerie|image/i.test(p.text+p.jsonld),'Galerie non détectée.','Rendre les photos et la galerie faciles à trouver.']
  ];
  const checks=[]; for (const [cat,label,test,fail,rec] of specs) checks.push(checkOne(cat,label,off,test,fail,rec));
  for(const ota of ots) checks.push(checkOne('channel',`Présence publique ${ota.channel}`,ota,p=>p.ok,`${ota.channel} inaccessible ou introuvable.`,'Vérifier l’URL publique sans fournir de mot de passe.'));
  checks.push(compare(all,'Cohérence du nom',p=>normalize(hotelName(p)),'Harmoniser le nom de l’établissement.'));
  checks.push(compare(all,'Cohérence des horaires',p=>first(p.text,/((check.?in|arrivée).{0,80})/i),'Harmoniser les horaires entre les canaux.'));
  checks.push(compare(all,'Cohérence restaurant',p=>first(p.text,/((restaurant|petit.?déjeuner|breakfast).{0,100})/i),'Harmoniser les informations de restauration.'));
  checks.push(compare(all,'Cohérence parking',p=>first(p.text,/((parking|stationnement).{0,100})/i),'Harmoniser les informations de parking.'));
  checks.push(priceCompare(all)); return checks;
}
function checkOne(category,label,page,test,fail,recommendation){ if(!page?.ok)return unknown(category,label,page?.error||'Source inaccessible',page?.url); const ok=!!test(page); return {category,label,status:ok?'pass':'fail',evidence:ok?'Élément détecté sur la source publique.':fail,recommendation,sources:[page.url]}; }
function compare(pages,label,extract,recommendation){const vals=pages.map(p=>({url:p.url,v:normalize(extract(p)||'')})).filter(x=>x.v); if(vals.length<2)return unknown('consistency',label,'Moins de deux sources comparables.',...vals.map(x=>x.url)); const unique=[...new Set(vals.map(x=>x.v))]; return {category:'consistency',label,status:unique.length===1?'pass':'fail',evidence:unique.length===1?'Valeurs cohérentes sur les sources accessibles.':'Valeurs publiques différentes détectées.',recommendation,sources:vals.map(x=>x.url)};}
function priceCompare(pages){const vals=pages.map(p=>({url:p.url,v:(p.text.match(/\b\d{2,4}\s?(?:€|EUR)|€\s?\d{2,4}/i)||[])[0]})).filter(x=>x.v); if(vals.length<2)return unknown('price','Prix publics comparables','Moins de deux tarifs publics accessibles pour les mêmes conditions.',...vals.map(x=>x.url)); return {category:'price',label:'Prix publics comparables',status:'unknown',evidence:'Des prix existent, mais dates, chambre et conditions ne peuvent pas être garanties identiques automatiquement.',recommendation:'Comparer à dates, occupation, chambre et conditions strictement identiques.',sources:vals.map(x=>x.url)};}
function unknown(category,label,evidence,...sources){return {category,label,status:'unknown',evidence,recommendation:'Aucune pénalité appliquée au score.',sources:sources.filter(Boolean)}}
function contains(p,s){return normalize(p.text).includes(normalize(s))} function normalize(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\W+/g,' ').trim()}
function first(s,r){return (String(s).match(r)||[])[1]||''} function hotelName(p){return p.title.split(/[|–—-]/)[0]||''} function locationHost(u){try{return new URL(u).hostname}catch{return''}}
