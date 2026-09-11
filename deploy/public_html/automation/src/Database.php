<?php
declare(strict_types=1);
namespace OtaAudit;
use PDO;

final class Database
{
    private PDO $pdo;
    public function __construct(Config $config)
    {
        $dir = $config->get('DATA_DIR', dirname(__DIR__, 2) . '/storage');
        if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) throw new \RuntimeException('Création DATA_DIR impossible');
        foreach (['reports','logs'] as $child) if (!is_dir("{$dir}/{$child}")) mkdir("{$dir}/{$child}", 0700, true);
        $this->pdo = new PDO('sqlite:' . $dir . '/ota-audit.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->pdo->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    }
    public function pdo(): PDO { return $this->pdo; }
    public function migrate(): void
    {
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY,type TEXT NOT NULL,email TEXT NOT NULL,first_name TEXT,hotel_name TEXT NOT NULL,city TEXT NOT NULL,website TEXT NOT NULL,role TEXT,stripe_event_id TEXT UNIQUE,stripe_session_id TEXT,status TEXT NOT NULL DEFAULT 'queued',audit_json TEXT,report_path TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT,case_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,available_at TEXT NOT NULL,locked_at TEXT,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(case_id,kind));
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT,case_id TEXT,level TEXT NOT NULL,event TEXT NOT NULL,context_json TEXT,created_at TEXT NOT NULL);");
    }
}
