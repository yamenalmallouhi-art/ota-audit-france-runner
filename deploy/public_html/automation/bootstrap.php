<?php
declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    $prefix = 'OtaAudit\\';
    if (!str_starts_with($class, $prefix)) return;
    $path = __DIR__ . '/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($path)) require $path;
});

use OtaAudit\Config;
use OtaAudit\Database;

$root = $_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__);
$configFile = getenv('OTA_AUDIT_CONFIG') ?: dirname($root) . '/ota-audit-private/config.env';
if (!is_file($configFile)) {
    $fallback = dirname(__DIR__, 2) . '/private/config.env';
    if (is_file($fallback)) $configFile = $fallback;
}
$config = Config::fromFile($configFile);
date_default_timezone_set($config->get('APP_TIMEZONE', 'Europe/Paris'));
$db = new Database($config);
$db->migrate();
return [$config, $db];
