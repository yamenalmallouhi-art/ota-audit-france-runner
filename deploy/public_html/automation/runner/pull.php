<?php
declare(strict_types=1);
try {
    [$config,$db]=require dirname(__DIR__).'/bootstrap.php'; auth($config);
    $pdo=$db->pdo(); $pdo->beginTransaction();
    $pdo->exec("UPDATE jobs SET status='queued',locked_at=NULL WHERE status='running' AND locked_at < datetime('now','-30 minutes') AND kind IN ('free_audit','paid_audit')");
    $job=$pdo->query("SELECT * FROM jobs WHERE status='queued' AND available_at <= datetime('now') AND kind IN ('free_audit','paid_audit') ORDER BY id LIMIT 1")->fetch(PDO::FETCH_ASSOC);
    if (!$job) { $pdo->commit(); http_response_code(204); exit; }
    $q=$pdo->prepare("UPDATE jobs SET status='running',attempts=attempts+1,locked_at=?,updated_at=? WHERE id=? AND status='queued'"); $q->execute([gmdate('Y-m-d H:i:s'),gmdate('Y-m-d H:i:s'),$job['id']]);
    if ($q->rowCount()!==1) { $pdo->rollBack(); http_response_code(409); exit; }
    $c=$pdo->prepare('SELECT id,type,hotel_name,city,website FROM cases WHERE id=?'); $c->execute([$job['case_id']]); $case=$c->fetch(PDO::FETCH_ASSOC); $pdo->commit();
    (new OtaAudit\Logger($db,$config))->log('info','browser.claimed',$case['id'],['job_id'=>$job['id'],'attempt'=>(int)$job['attempts']+1]);
    header('Content-Type: application/json'); echo json_encode(['job_id'=>(int)$job['id'],'attempt'=>(int)$job['attempts']+1,'case'=>$case],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) { error_log('OTA runner pull: '.$e->getMessage()); http_response_code(500); }

function auth(OtaAudit\Config $c): void { $h=$_SERVER['HTTP_AUTHORIZATION']??''; if (!hash_equals('Bearer '.$c->require('RUNNER_TOKEN'),$h)) { http_response_code(404); exit; } }
