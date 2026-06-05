<?php
declare(strict_types=1);

require_once __DIR__ . '/json.php';

function sorcery_environment(): string
{
    $host = strtolower($_SERVER['HTTP_HOST'] ?? '');
    return strpos($host, 'staging.') === 0 ? 'staging' : 'production';
}

function sorcery_config_path(): string
{
    return sorcery_environment() === 'staging'
        ? '/home/julianru/sorcery_private/staging.php'
        : '/home/julianru/sorcery_private/prod.php';
}

function sorcery_config(): array
{
    static $config = null;
    if (is_array($config)) {
        return $config;
    }

    $path = sorcery_config_path();
    if (!is_readable($path)) {
        sorcery_error('Server configuration is missing', 500);
    }

    $loaded = require $path;
    if (!is_array($loaded)) {
        sorcery_error('Server configuration is invalid', 500);
    }

    $config = $loaded;
    return $config;
}

function sorcery_docroot(): string
{
    return realpath(__DIR__ . '/../../') ?: dirname(__DIR__, 2);
}
