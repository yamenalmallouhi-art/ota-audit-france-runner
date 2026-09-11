<?php
declare(strict_types=1);
namespace OtaAudit;
use PDO;

final class Queue
{
    public function __construct(private Database $db) {}
    public function enqueue(string $caseId, string $kind): void
    {
        $now=gmdate('Y-m-d H:i:s');
        $q=$this->db->pdo()->prepare("INSERT OR IGNORE INTO jobs(case_id,kind,status,available_at,created_at,updated_at) VALUES(?,?,'queued',?,?,?)");
        $q->execute([$caseId,$kind,$now,$now,$now]);
    }
    public function claim(array $kinds=['deliver']): ?array
    {
        $pdo=$this->db->pdo(); $pdo->beginTransaction();
        try {
            $pdo->exec("UPDATE jobs SET status='queued',locked_at=NULL WHERE status='running' AND locked_at < datetime('now','-15 minutes')");
            $marks=implode(',',array_fill(0,count($kinds),'?'));
            $q=$pdo->prepare("SELECT * FROM jobs WHERE status='queued' AND available_at <= datetime('now') AND kind IN ({$marks}) ORDER BY id LIMIT 1");
            $q->execute($kinds); $row=$q->fetch(PDO::FETCH_ASSOC);
            if (!$row) { $pdo->commit(); return null; }
            $q=$pdo->prepare("UPDATE jobs SET status='running',attempts=attempts+1,locked_at=?,updated_at=? WHERE id=? AND status='queued'");
            $q->execute([gmdate('Y-m-d H:i:s'),gmdate('Y-m-d H:i:s'),$row['id']]);
            if ($q->rowCount()!==1) { $pdo->rollBack(); return null; }
            $pdo->commit(); $row['attempts']=(int)$row['attempts']+1; return $row;
        } catch (\Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    }
    public function complete(int $id): void { $this->set($id,'done',null,null); }
    public function fail(int $id,string $error,int $attempts,int $max): void
    {
        if ($attempts >= $max) { $this->set($id,'dead',$error,null); return; }
        $delay=min(3600,30*(2**max(0,$attempts-1)));
        $this->set($id,'queued',$error,gmdate('Y-m-d H:i:s',time()+$delay));
    }
    private function set(int $id,string $status,?string $error,?string $available): void
    {
        $q=$this->db->pdo()->prepare('UPDATE jobs SET status=?,last_error=?,available_at=COALESCE(?,available_at),locked_at=NULL,updated_at=? WHERE id=?');
        $q->execute([$status,substr((string)$error,0,2000),$available,gmdate('Y-m-d H:i:s'),$id]);
    }
}
