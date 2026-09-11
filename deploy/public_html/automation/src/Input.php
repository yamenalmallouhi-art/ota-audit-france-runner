<?php
declare(strict_types=1);
namespace OtaAudit;

final class Input
{
    public static function lead(array $p): array
    {
        if (!empty($p['company'] ?? $p['website_confirm'] ?? '')) throw new \InvalidArgumentException('Spam détecté');
        $email=filter_var(trim((string)($p['email']??'')),FILTER_VALIDATE_EMAIL);
        $site=self::url((string)($p['site']??$p['website']??''));
        $d=['type'=>'free','email'=>$email?:'','first_name'=>self::text($p['prenom']??$p['first_name']??'',80),'hotel_name'=>self::text($p['hotel']??$p['hotel_name']??'',160),'city'=>self::text($p['ville']??$p['city']??'',120),'website'=>$site,'role'=>self::text($p['role']??'',80)];
        if (!$d['email']||!$d['hotel_name']||!$d['city']||!$d['website']) throw new \InvalidArgumentException('Champs obligatoires invalides');
        return $d;
    }
    public static function text(mixed $v,int $max): string { return mb_substr(trim(strip_tags((string)$v)),0,$max); }
    public static function url(string $v): string
    {
        $v=trim($v); if ($v!=='' && !preg_match('~^https?://~i',$v)) $v='https://'.$v;
        if (!filter_var($v,FILTER_VALIDATE_URL)) return '';
        $parts=parse_url($v); $host=strtolower($parts['host']??'');
        if ($host===''||$host==='localhost'||filter_var($host,FILTER_VALIDATE_IP)) return '';
        return $v;
    }
}
