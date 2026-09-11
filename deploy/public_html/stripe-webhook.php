<?php
declare(strict_types=1);

try {
    [$config,$db]=require __DIR__.'/automation/bootstrap.php';
    if ($_SERVER['REQUEST_METHOD']!=='POST') { http_response_code(405); exit; }
    $raw=(string)file_get_contents('php://input'); $sig=$_SERVER['HTTP_STRIPE_SIGNATURE']??'';
    verifyStripe($raw,$sig,$config->require('STRIPE_WEBHOOK_SECRET'));
    $event=json_decode($raw,true,512,JSON_THROW_ON_ERROR); $eventId=(string)($event['id']??'');
    if (($event['type']??'')!=='checkout.session.completed') { http_response_code(200); echo 'ignored'; exit; }
    $s=$event['data']['object']??[];
    if (($s['payment_status']??'')!=='paid') throw new RuntimeException('Paiement non confirmé');
    if ((int)($s['amount_total']??0)!==$config->int('STRIPE_EXPECTED_AMOUNT',14900) || strtolower((string)($s['currency']??''))!==strtolower($config->get('STRIPE_EXPECTED_CURRENCY','eur'))) throw new RuntimeException('Montant ou devise inattendu');
    $cases=new OtaAudit\Cases($db); if ($cases->findByStripeEvent($eventId)) { echo 'duplicate'; exit; }
    $email=filter_var($s['customer_details']['email']??$s['customer_email']??'',FILTER_VALIDATE_EMAIL)?:'';
    $source=$cases->latestFreeByEmail($email); $custom=[]; foreach ($s['custom_fields']??[] as $f) $custom[$f['key']??'']=$f['text']['value']??$f['numeric']['value']??'';
    $data=['type'=>'paid','email'=>$email,'first_name'=>$source['first_name']??($s['customer_details']['name']??''),'hotel_name'=>$source['hotel_name']??($custom['hotel_name']??''),'city'=>$source['city']??($custom['city']??''),'website'=>$source['website']??OtaAudit\Input::url($custom['website']??''),'role'=>$source['role']??'','stripe_event_id'=>$eventId,'stripe_session_id'=>(string)($s['id']??'')];
    if (!$data['email']||!$data['hotel_name']||!$data['city']||!$data['website']) throw new RuntimeException('Paiement valide mais hôtel non rattachable : vérifier les champs du Payment Link');
    $id=$cases->create($data); (new OtaAudit\Queue($db))->enqueue($id,'paid_audit');
    (new OtaAudit\Logger($db,$config))->log('info','payment.accepted',$id,['stripe_event_id'=>$eventId,'amount'=>$s['amount_total']]);
    http_response_code(200); echo 'accepted';
} catch (Throwable $e) {
    error_log('OTA Stripe webhook error: '.$e->getMessage()); http_response_code(400); echo 'rejected';
}

function verifyStripe(string $payload,string $header,string $secret): void
{
    $parts=[]; foreach (explode(',',$header) as $pair) { [$k,$v]=array_pad(explode('=',$pair,2),2,''); $parts[$k][]=$v; }
    $ts=(int)($parts['t'][0]??0); if (!$ts||abs(time()-$ts)>300) throw new RuntimeException('Signature Stripe expirée');
    $expected=hash_hmac('sha256',$ts.'.'.$payload,$secret); $ok=false; foreach ($parts['v1']??[] as $v) if (hash_equals($expected,$v)) $ok=true;
    if (!$ok) throw new RuntimeException('Signature Stripe invalide');
}
