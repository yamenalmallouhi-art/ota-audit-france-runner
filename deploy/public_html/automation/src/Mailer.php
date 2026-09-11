<?php
declare(strict_types=1);
namespace OtaAudit;

final class Mailer
{
    public function __construct(private Config $c) {}
    public function send(string $to,string $subject,string $html,?string $attachment=null): void
    {
        $boundary='b'.bin2hex(random_bytes(12)); $from=$this->c->get('MAIL_FROM_NAME','OTA Audit France').' <'.$this->c->require('MAIL_FROM').'>';
        $headers=['Date: '.date(DATE_RFC2822),'From: '.$from,'Reply-To: '.$this->c->get('MAIL_REPLY_TO',$this->c->require('MAIL_FROM')),'To: '.$to,'Subject: =?UTF-8?B?'.base64_encode($subject).'?=','MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="'.$boundary.'"'];
        $body="--{$boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode($html));
        if ($attachment) $body.="--{$boundary}\r\nContent-Type: application/pdf; name=rapport-ota.pdf\r\nContent-Disposition: attachment; filename=rapport-ota.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode((string)file_get_contents($attachment)));
        $body.="--{$boundary}--\r\n";
        $this->smtp($to,implode("\r\n",$headers)."\r\n\r\n".$body);
    }
    private function smtp(string $to,string $message): void
    {
        $host=$this->c->require('SMTP_HOST'); $port=$this->c->int('SMTP_PORT',587); $enc=$this->c->get('SMTP_ENCRYPTION','tls');
        $prefix=$enc==='ssl'?'ssl://':''; $fp=stream_socket_client($prefix.$host.':'.$port,$errno,$errstr,20);
        if (!$fp) throw new \RuntimeException("Connexion SMTP impossible: {$errstr}"); stream_set_timeout($fp,25); $this->expect($fp,[220]);
        $this->cmd($fp,'EHLO ota.imiloc.com',[250]);
        if ($enc==='tls') { $this->cmd($fp,'STARTTLS',[220]); if (!stream_socket_enable_crypto($fp,true,STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new \RuntimeException('TLS SMTP impossible'); $this->cmd($fp,'EHLO ota.imiloc.com',[250]); }
        $this->cmd($fp,'AUTH LOGIN',[334]); $this->cmd($fp,base64_encode($this->c->require('SMTP_USERNAME')),[334]); $this->cmd($fp,base64_encode($this->c->require('SMTP_PASSWORD')),[235]);
        $this->cmd($fp,'MAIL FROM:<'.$this->c->require('MAIL_FROM').'>',[250]); $this->cmd($fp,'RCPT TO:<'.$to.'>',[250,251]); $this->cmd($fp,'DATA',[354]);
        fwrite($fp,preg_replace('/(?m)^\./','..',$message)."\r\n.\r\n"); $this->expect($fp,[250]); $this->cmd($fp,'QUIT',[221]); fclose($fp);
    }
    private function cmd($fp,string $cmd,array $codes): void { fwrite($fp,$cmd."\r\n"); $this->expect($fp,$codes); }
    private function expect($fp,array $codes): void
    {
        $response=''; do { $line=fgets($fp,515); if ($line===false) throw new \RuntimeException('Réponse SMTP absente'); $response.=$line; } while (isset($line[3])&&$line[3]==='-');
        if (!in_array((int)substr($response,0,3),$codes,true)) throw new \RuntimeException('Erreur SMTP: '.substr(trim($response),0,300));
    }
}
