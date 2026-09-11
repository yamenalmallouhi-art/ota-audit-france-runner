<?php
declare(strict_types=1);
namespace OtaAudit;

final class Logger
{
    public function __construct(private Database $db, private Config $config) {}
    public function log(string $level, string $event, ?string $caseId = null, array $context = []): void
    {
        $safe = $this->redact($context);
        $q = $this->db->pdo()->prepare('INSERT INTO events(case_id,level,event,context_json,created_at) VALUES(?,?,?,?,?)');
        $q->execute([$caseId,$level,$event,json_encode($safe, JSON_UNESCAPED_UNICODE),gmdate('c')]);
        $file = $this->config->get('DATA_DIR', dirname(__DIR__, 2) . '/storage') . '/logs/app-' . gmdate('Y-m-d') . '.jsonl';
        file_put_contents($file, json_encode(['at'=>gmdate('c'),'level'=>$level,'event'=>$event,'case_id'=>$caseId,'context'=>$safe], JSON_UNESCAPED_UNICODE)."\n", FILE_APPEND|LOCK_EX);
    }
    private function redact(array $data): array
    {
        foreach ($data as $k=>$v) {
            if (preg_match('/secret|password|token|api.?key|authorization/i', (string)$k)) $data[$k]='[REDACTED]';
            elseif (is_array($v)) $data[$k]=$this->redact($v);
        }
        return $data;
    }
}
