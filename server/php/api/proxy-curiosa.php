<?php
declare(strict_types=1);

require_once __DIR__ . '/shared/proxy.php';

sorcery_proxy_request('https://curiosa.io', [
    'Origin: https://curiosa.io',
    'Referer: https://curiosa.io/',
]);
