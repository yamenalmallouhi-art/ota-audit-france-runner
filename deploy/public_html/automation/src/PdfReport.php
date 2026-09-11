<?php
declare(strict_types=1);
namespace OtaAudit;

final class PdfReport
{
    public function __construct(private Config $config) {}
    public function create(array $case,array $a): string
    {
        $lines=['OTA AUDIT FRANCE','Audit public - '.($case['hotel_name']??''),'Ville : '.($case['city']??''),'Score OTA : '.$a['score'].' / 100','',($a['summary']??'')];
        foreach ($a['findings'] as $i=>$f) { $lines[]=''; $lines[]=($i+1).'. '.strtoupper((string)($f['severity']??'')).' - '.($f['title']??''); $lines[]='Preuve : '.($f['evidence']??''); $lines[]='Action : '.($f['recommendation']??''); }
        if ($case['type']==='paid') {
            $lines[]=''; $lines[]='PLAN D ACTION';
            foreach (['h48'=>'Sous 48 h','d7'=>'Sous 7 jours','d30'=>'Sous 30 jours'] as $k=>$label) { $lines[]=$label; foreach ($a['action_plan'][$k]??[] as $x) $lines[]='- '.$x; }
        }
        $lines[]=''; $lines[]='Limites'; foreach ($a['limitations'] as $x) $lines[]='- '.$x;
        $lines[]=''; $lines[]='Sources publiques'; foreach (array_unique($a['sources']) as $x) $lines[]='- '.$x;
        $pdf=$this->render($lines);
        $path=$this->config->get('DATA_DIR',dirname(__DIR__,2).'/storage').'/reports/'.$case['id'].'.pdf';
        file_put_contents($path,$pdf,LOCK_EX); chmod($path,0600); return $path;
    }
    private function render(array $lines): string
    {
        $wrapped=[]; foreach ($lines as $line) foreach (explode("\n",wordwrap($this->latin((string)$line),92,"\n",true)) as $x) $wrapped[]=$x;
        $pages=array_chunk($wrapped,47); $objects=[]; $pageIds=[]; $fontId=3;
        $objects[1]='<< /Type /Catalog /Pages 2 0 R >>'; $objects[$fontId]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'; $next=4;
        foreach ($pages as $page) { $pageId=$next++; $contentId=$next++; $pageIds[]=$pageId; $y=800; $stream="BT /F1 11 Tf 50 {$y} Td "; foreach ($page as $line) { $stream.='('.$this->escape($line).") Tj 0 -16 Td "; } $stream.='ET'; $objects[$pageId]="<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 {$fontId} 0 R >> >> /Contents {$contentId} 0 R >>"; $objects[$contentId]='<< /Length '.strlen($stream)." >>\nstream\n{$stream}\nendstream"; }
        $objects[2]='<< /Type /Pages /Kids ['.implode(' ',array_map(fn($id)=>"{$id} 0 R",$pageIds)).'] /Count '.count($pageIds).' >>'; ksort($objects);
        $out="%PDF-1.4\n"; $offset=[0]; foreach ($objects as $id=>$body) { $offset[$id]=strlen($out); $out.="{$id} 0 obj\n{$body}\nendobj\n"; }
        $xref=strlen($out); $max=max(array_keys($objects)); $out.="xref\n0 ".($max+1)."\n0000000000 65535 f \n"; for($i=1;$i<=$max;$i++) $out.=sprintf('%010d 00000 n ', $offset[$i]??0)."\n";
        return $out."trailer << /Size ".($max+1)." /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF";
    }
    private function latin(string $s): string { return iconv('UTF-8','Windows-1252//TRANSLIT//IGNORE',$s)?:$s; }
    private function escape(string $s): string { return str_replace(['\\','(',')'],['\\\\','\\(','\\)'],$s); }
}
