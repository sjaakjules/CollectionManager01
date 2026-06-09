<?php
declare(strict_types=1);

require_once __DIR__ . '/shared/proxy.php';

sorcery_proxy_request('https://curiosa.io', [
    'Origin: https://curiosa.io',
    'Referer: https://curiosa.io/',
], [
    // Shared server-side backstop for all deployed clients of this PHP proxy.
    'rate_limit' => [
        'namespace' => 'curiosa',
        'min_interval_ms' => 1000,
        'low_remaining_threshold' => 2,
        'safe_remaining_target' => 5,
        'max_sleep_ms' => 8000,
    ],
]);
