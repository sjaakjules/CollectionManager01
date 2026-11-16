<?php
declare(strict_types=1);

// Public SorceryTCG decks and search share the card proxy's upstream limiter.
require_once __DIR__ . '/shared/proxy.php';

sorcery_proxy_request('https://sorcerytcg.com', [
    'Origin: https://sorcerytcg.com',
    'Referer: https://sorcerytcg.com/',
]);
