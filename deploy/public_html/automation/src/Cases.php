<?php
declare(strict_types=1);
namespace OtaAudit;
use PDO;

final class Cases
{
    public function __construct(private Database $db) {}
    public function create(array $d): string
    {
        $id=$d['id'] ?? bin2hex(random_bytes(16)); $now=gmdate('c');
        $q=$this->db->pdo()->prepare('INSERT INTO cases(id,type,email,first_name,hotel_name,city,website,role,stripe_event_id,stripe_session_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
        $q->execute([$id,$d['type'],$d['email'],$d['first_name']??'',$d['hotel_name'],$d['city'],$d['website'],$d['role']??'', $d['stripe_event_id']??null,$d['stripe_session_id']??null,'queued',$now,$now]);
        return $id;
    }
    public function find(string $id): ?array
    {
        $q=$this->db->pdo()->prepare('SELECT * FROM cases WHERE id=?'); $q->execute([$id]);
        return $q->fetch(PDO::FETCH_ASSOC) ?: null;
    }
    public function findByStripeEvent(string $event): ?array
    {
        $q=$this->db->pdo()->prepare('SELECT * FROM cases WHERE stripe_event_id=?'); $q->execute([$event]);
        return $q->fetch(PDO::FETCH_ASSOC) ?: null;
    }
    public function latestFreeByEmail(string $email): ?array
    {
        $q=$this->db->pdo()->prepare("SELECT * FROM cases WHERE email=? AND type='free' ORDER BY created_at DESC LIMIT 1");
        $q->execute([$email]); return $q->fetch(PDO::FETCH_ASSOC) ?: null;
    }
    public function saveAudit(string $id,array $audit,?string $path): void
    {
        $q=$this->db->pdo()->prepare("UPDATE cases SET audit_json=?,report_path=?,status='audited',updated_at=? WHERE id=?");
        $q->execute([json_encode($audit,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),$path,gmdate('c'),$id]);
    }
    public function sent(string $id): void
    {
        $q=$this->db->pdo()->prepare("UPDATE cases SET status='sent',updated_at=? WHERE id=?"); $q->execute([gmdate('c'),$id]);
    }
}
