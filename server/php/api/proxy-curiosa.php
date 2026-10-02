<?php
declare(strict_types=1);

// Legacy filename retained so existing deployments and /api/curiosa links work.
require_once __DIR__ . '/shared/proxy.php';

sorcery_proxy_request('https://sorcerytcg.com', [
    'Origin: https://sorcerytcg.com',
    'Referer: https://sorcerytcg.com/',
]);
