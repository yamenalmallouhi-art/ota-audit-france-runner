<?php
declare(strict_types=1);

$root=dirname(__DIR__); foreach (glob($root.'/deploy/public_html/automation/src/*.php') as $f) require_once $f;
use OtaAudit\{Config,Database,Cases,Queue,AuditValidator,PdfReport,Input};
$tmp=sys_get_temp_dir().'/ota-audit-test-'.bin2hex(random_bytes(5)); mkdir($tmp,0700,true);
$cfg=new Config(['DATA_DIR'=>$tmp,'STRIPE_PAYMENT_URL'=>'https://example.test/pay','MAIL_FROM'=>'x@example.test']); $db=new Database($cfg); $db->migrate();
$lead=Input::lead(['email'=>'owner@example.test','site'=>'hotel.example','hotel'=>'Hôtel Démo','ville'=>'Paris','prenom'=>'Ada']); assert($lead['website']==='https://hotel.example');
$cases=new Cases($db); $id=$cases->create($lead); $queue=new Queue($db); $queue->enqueue($id,'free_audit'); $queue->enqueue($id,'free_audit');
assert((int)$db->pdo()->query('SELECT COUNT(*) FROM jobs')->fetchColumn()===1); $job=$queue->claim(['free_audit']); assert($job&&$job['case_id']===$id); $queue->complete((int)$job['id']);
$case=$cases->find($id); $audit=AuditValidator::validate(['hotel_name'=>'Hôtel Démo','city'=>'Paris','score'=>67,'summary'=>'Test','findings'=>array_fill(0,3,['severity'=>'opportunity','title'=>'Test','evidence'=>'Test','recommendation'=>'Test','sources'=>[]]),'checks'=>[],'action_plan'=>['h48'=>[],'d7'=>[],'d30'=>[]],'limitations'=>[],'sources'=>[]],false); assert($audit['score']===67&&count($audit['findings'])===3);
$case['type']='paid'; $pdf=(new PdfReport($cfg))->create($case,$audit); assert(str_starts_with((string)file_get_contents($pdf),'%PDF-1.4'));
$failed=false; try { Input::lead(['email'=>'bad','site'=>'http://localhost','hotel'=>'X','ville'=>'Y']); } catch (InvalidArgumentException) { $failed=true; } assert($failed);
echo "OK: validation, SQLite, idempotence, file d'attente et PDF\n";
