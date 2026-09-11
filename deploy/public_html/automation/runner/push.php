<?php
declare(strict_types=1);
try {
    [$config,$db]=require dirname(__DIR__).'/bootstrap.php'; auth($config);
    $input=json_decode((string)file_get_contents('php://input'),true,512,JSON_THROW_ON_ERROR); $jobId=(int)($input['job_id']??0);
    $q=$db->pdo()->prepare("SELECT * FROM jobs WHERE id=? AND status='running' AND kind IN ('free_audit','paid_audit')"); $q->execute([$jobId]); $job=$q->fetch(PDO::FETCH_ASSOC); if (!$job) throw new RuntimeException('Tâche invalide');
    $cases=new OtaAudit\Cases($db); $case=$cases->find($job['case_id']); if (!$case) throw new RuntimeException('Dossier absent');
    if (!empty($input['error'])) { (new OtaAudit\Queue($db))->fail($jobId,(string)$input['error'],(int)$job['attempts'],$config->int('MAX_ATTEMPTS',6)); (new OtaAudit\Logger($db,$config))->log('error','browser.failed',$case['id'],['error'=>$input['error']]); echo 'retry'; exit; }
    $audit=OtaAudit\AuditValidator::validate($input['audit']??[],$case['type']==='paid'); $report=$case['type']==='paid'?(new OtaAudit\PdfReport($config))->create($case,$audit):null;
    $cases->saveAudit($case['id'],$audit,$report); (new OtaAudit\Queue($db))->complete($jobId); (new OtaAudit\Queue($db))->enqueue($case['id'],'deliver');
    (new OtaAudit\Logger($db,$config))->log('info','browser.completed',$case['id'],['score'=>$audit['score'],'available_checks'=>$audit['score_basis']['available']??null]); echo 'accepted';
} catch (Throwable $e) { error_log('OTA runner push: '.$e->getMessage()); http_response_code(400); echo 'rejected'; }

function auth(OtaAudit\Config $c): void { $h=$_SERVER['HTTP_AUTHORIZATION']??''; if (!hash_equals('Bearer '.$c->require('RUNNER_TOKEN'),$h)) { http_response_code(404); exit; } }
