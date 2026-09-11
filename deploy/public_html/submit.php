<?php
declare(strict_types=1);

try {
    [$config,$db]=require __DIR__.'/automation/bootstrap.php';
    if ($_SERVER['REQUEST_METHOD']!=='POST') { http_response_code(405); exit('Méthode refusée'); }
    $data=OtaAudit\Input::lead($_POST);
    if (empty($_POST['consent']) && empty($_POST['rgpd'])) throw new InvalidArgumentException('Consentement requis');
    $cases=new OtaAudit\Cases($db); $id=$cases->create($data);
    (new OtaAudit\Queue($db))->enqueue($id,'free_audit');
    (new OtaAudit\Logger($db,$config))->log('info','lead.accepted',$id,['hotel'=>$data['hotel_name']]);
    header('Location: /merci.html',true,303); exit;
} catch (InvalidArgumentException $e) {
    http_response_code(422); echo 'Demande invalide : '.htmlspecialchars($e->getMessage(),ENT_QUOTES,'UTF-8');
} catch (Throwable $e) {
    error_log('OTA lead error: '.$e->getMessage()); http_response_code(503); echo 'Service temporairement indisponible. Réessayez dans quelques minutes.';
}
