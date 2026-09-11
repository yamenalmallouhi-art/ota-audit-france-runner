<?php
declare(strict_types=1);
[$config,$db]=require dirname(__DIR__).'/bootstrap.php';
$count=(new OtaAudit\Worker($config,$db))->run($config->int('WORKER_MAX_JOBS',3));
fwrite(STDOUT,"jobs_processed={$count}\n");
