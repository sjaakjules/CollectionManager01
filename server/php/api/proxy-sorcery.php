<?php
declare(strict_types=1);

require_once __DIR__ . '/shared/proxy.php';

sorcery_proxy_request('https://api.sorcerytcg.com/api', [], [
    'catalogue_snapshot' => dirname(__DIR__) . '/assets/sorcery_cards.json',
]);
