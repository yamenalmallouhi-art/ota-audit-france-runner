<?php
declare(strict_types=1);
namespace OtaAudit;

final class Worker
{
    private Queue $queue; private Cases $cases; private Logger $log;
    public function __construct(private Config $cfg,private Database $db,private ?Mailer $mailer=null)
    { $this->queue=new Queue($db); $this->cases=new Cases($db); $this->log=new Logger($db,$cfg); }
    public function run(int $limit): int
    {
        $done=0; while ($done<$limit && ($job=$this->queue->claim(['deliver']))) {
            try { $this->process($job); $this->queue->complete((int)$job['id']); $done++; }
            catch (\Throwable $e) { $this->log->log('error','job.failed',$job['case_id'],['job_id'=>$job['id'],'attempt'=>$job['attempts'],'error'=>$e->getMessage()]); $this->queue->fail((int)$job['id'],$e->getMessage(),(int)$job['attempts'],$this->cfg->int('MAX_ATTEMPTS',6)); }
        } return $done;
    }
    private function process(array $job): void
    {
        $case=$this->cases->find($job['case_id']); if (!$case) throw new \RuntimeException('Dossier introuvable');
        $audit=$case['audit_json']?json_decode($case['audit_json'],true):null; $report=$case['report_path']?:null;
        if (!$audit) throw new \RuntimeException('Résultat navigateur absent');
        if ($case['status']!=='sent') { [$subject,$html]=$case['type']==='paid'?EmailTemplates::paid($case,$audit):EmailTemplates::free($case,$audit,$this->cfg); ($this->mailer??new Mailer($this->cfg))->send($case['email'],$subject,$html,$report); $this->cases->sent($case['id']); $this->log->log('info','email.sent',$case['id'],['type'=>$case['type']]); }
    }
}
