<?php
declare(strict_types=1);
namespace OtaAudit;
final class EmailTemplates
{
    public static function free(array $c,array $a,Config $cfg): array
    {
        $items=''; foreach (array_slice($a['findings'],0,3) as $f) $items.='<li><strong>'.self::e($f['title']??'').'</strong> — '.self::e($f['evidence']??'').'<br>'.self::e($f['recommendation']??'').'</li>';
        $html='<h1>Votre OTA Score : '.(int)$a['score'].'/100</h1><p>Bonjour '.self::e($c['first_name']?:'').',</p><p>Voici le pré-audit public de <strong>'.self::e($c['hotel_name']).'</strong>.</p><ol>'.$items.'</ol><p>Ces constats reposent uniquement sur des informations publiques ; les éléments inaccessibles ne sont pas considérés comme des anomalies.</p><p><a href="'.self::e($cfg->require('STRIPE_PAYMENT_URL')).'">Commander l’audit complet — 149 €</a></p><p>OTA Audit France</p>';
        return ['Votre OTA Score — '.$c['hotel_name'],$html];
    }
    public static function paid(array $c,array $a): array
    {
        return ['Votre audit OTA complet — '.$c['hotel_name'],'<h1>Votre audit OTA complet</h1><p>Bonjour '.self::e($c['first_name']?:'').',</p><p>Merci pour votre commande. Le rapport de <strong>'.self::e($c['hotel_name']).'</strong> est joint à cet email.</p><p>OTA Score : <strong>'.(int)$a['score'].'/100</strong>.</p><p>Le rapport distingue les faits vérifiés des éléments non accessibles et contient le plan 48 h / 7 jours / 30 jours.</p><p>OTA Audit France</p>'];
    }
    private static function e(string $s): string { return htmlspecialchars($s,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8'); }
}
