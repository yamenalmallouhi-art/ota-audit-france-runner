<?php
declare(strict_types=1);
namespace OtaAudit;
final class AuditValidator
{
    public static function validate(array $a,bool $paid): array
    {
        $a['score']=max(0,min(100,(int)($a['score']??0)));
        foreach (['hotel_name','city','summary'] as $k) $a[$k]=Input::text($a[$k]??'',1000);
        foreach (['findings','checks','limitations','sources'] as $k) if (!isset($a[$k])||!is_array($a[$k])) $a[$k]=[];
        if (!$paid) $a['findings']=array_slice($a['findings'],0,3);
        if (count($a['findings'])<3) throw new \RuntimeException('Audit incomplet: moins de 3 constats');
        $a['action_plan']=is_array($a['action_plan']??null)?$a['action_plan']:['h48'=>[],'d7'=>[],'d30'=>[]];
        $a['audited_at']=$a['audited_at']??gmdate('c');
        return $a;
    }
}
