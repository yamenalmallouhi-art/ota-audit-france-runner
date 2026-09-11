<?php
declare(strict_types=1);
namespace OtaAudit;

final class Config
{
    public function __construct(private array $values) {}
    public static function fromFile(string $path): self
    {
        if (!is_file($path)) throw new \RuntimeException("Configuration absente: {$path}");
        $values = [];
        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) continue;
            [$key, $value] = array_pad(explode('=', $line, 2), 2, '');
            $values[trim($key)] = trim($value, " \t\n\r\0\x0B\"'");
        }
        return new self($values);
    }
    public function get(string $key, ?string $default = null): string
    {
        $env = getenv($key);
        $value = $env !== false ? $env : ($this->values[$key] ?? $default);
        if ($value === null) throw new \RuntimeException("Configuration requise: {$key}");
        return (string)$value;
    }
    public function int(string $key, int $default): int { return (int)$this->get($key, (string)$default); }
    public function require(string $key): string
    {
        $value = $this->get($key, '');
        if ($value === '') throw new \RuntimeException("Configuration requise: {$key}");
        return $value;
    }
}
