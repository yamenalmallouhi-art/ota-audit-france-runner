<?php
declare(strict_types=1);
try {
    [$config,$db]=require __DIR__.'/bootstrap.php';
    if (!hash_equals($config->require('CRON_TOKEN'),(string)($_GET['token']??''))) { http_response_code(404); exit; }
    $counts=$db->pdo()->query("SELECT status,COUNT(*) n FROM jobs GROUP BY status")->fetchAll(PDO::FETCH_KEY_PAIR);
    header('Content-Type: application/json'); echo json_encode(['ok'=>true,'queue'=>$counts,'time'=>gmdate('c')]);
} catch (Throwable $e) { http_response_code(503); echo json_encode(['ok'=>false]); }
