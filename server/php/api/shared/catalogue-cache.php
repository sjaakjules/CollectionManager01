<?php
declare(strict_types=1);

// Public catalogue only. No deck, account or visitor data enters this cache.
const SORCERY_CATALOGUE_TTL = 86400;
const SORCERY_CATALOGUE_FAILURE_WAIT = 3600;

function sorcery_catalogue_valid(string $body): bool
{
    $cards = json_decode($body, true);
    if (!is_array($cards) || count($cards) === 0 || array_keys($cards) !== range(0, count($cards) - 1)) return false;
    $names = [];
    foreach ($cards as $card) {
        if (!is_array($card) || !is_string($card['name'] ?? null) || trim($card['name']) === '') return false;
        $stats = $card['engine'] ?? $card['guardian'] ?? null;
        if (!is_array($stats) || !is_string($stats['type'] ?? null) || trim($stats['type']) === '') return false;
        if (!is_array($card['printings'] ?? $card['sets'] ?? null)) return false;
        if (isset($names[$card['name']])) return false;
        $names[$card['name']] = true;
    }
    return true;
}

function sorcery_catalogue_saved(string $path, string $snapshot): array
{
    $saved = is_file($path) ? json_decode((string)file_get_contents($path), true) : null;
    if (!is_array($saved) || !isset($saved['updatedAt'], $saved['retryAt'])
        || !is_int($saved['updatedAt']) || !is_int($saved['retryAt'])
        || !array_key_exists('body', $saved)
        || ($saved['body'] !== null && (!is_string($saved['body']) || !sorcery_catalogue_valid($saved['body'])))) {
        $saved = ['body' => null, 'updatedAt' => 0, 'retryAt' => 0];
    }
    // A newly deployed reviewed snapshot supersedes an older shared cache.
    $modified = is_file($snapshot) ? (int)filemtime($snapshot) : 0;
    if ($modified > (int)($saved['updatedAt'] ?? 0)) {
        $body = (string)file_get_contents($snapshot);
        if (sorcery_catalogue_valid($body)) {
            $saved = ['body' => $body, 'updatedAt' => $modified,
                'retryAt' => max($modified + SORCERY_CATALOGUE_TTL, (int)($saved['retryAt'] ?? 0))];
        }
    }
    return $saved;
}

function sorcery_catalogue_write(string $path, array $saved): bool
{
    $temporary = $path . '.tmp';
    $encoded = json_encode($saved, JSON_UNESCAPED_SLASHES);
    if ($encoded === false || file_put_contents($temporary, $encoded) === false) return false;
    return rename($temporary, $path);
}

function sorcery_catalogue_unlock(array $cache): void
{
    if (isset($cache['lock'])) {
        flock($cache['lock'], LOCK_UN);
        fclose($cache['lock']);
    }
}

function sorcery_catalogue_begin(string $snapshot, ?int $now = null): array
{
    $now = $now ?? time();
    $path = sys_get_temp_dir() . '/sorcery-stacks-catalogue-' . hash('sha256', $snapshot) . '.json';
    $saved = sorcery_catalogue_saved($path, $snapshot);
    $result = ['path' => $path, 'saved' => $saved, 'body' => $saved['body'], 'refresh' => false,
        'state' => $now - (int)$saved['updatedAt'] < SORCERY_CATALOGUE_TTL ? 'fresh' : 'stale'];
    if ($now < (int)$saved['retryAt']) return $result;

    $lock = fopen($path . '.lock', 'c+');
    if ($lock === false) return $result; // Fail closed; never bypass the cache/limiter.
    if (!flock($lock, LOCK_EX | LOCK_NB)) { fclose($lock); return $result; }
    $saved = sorcery_catalogue_saved($path, $snapshot);
    $result = array_merge($result, ['lock' => $lock, 'saved' => $saved, 'body' => $saved['body']]);
    if ($now < (int)$saved['retryAt']) {
        sorcery_catalogue_unlock($result);
        unset($result['lock']);
        return $result;
    }
    // Reserve a failed-refresh interval before the attempt, including crashes.
    $reserved = array_merge($saved, ['retryAt' => $now + SORCERY_CATALOGUE_FAILURE_WAIT]);
    if (!sorcery_catalogue_write($path, $reserved)) {
        sorcery_catalogue_unlock($result);
        unset($result['lock']);
        return $result;
    }
    $result['refresh'] = true;
    return $result;
}

function sorcery_catalogue_finish(array $cache, string $body, int $status, ?int $now = null): array
{
    $now = $now ?? time();
    $valid = $status === 200 && sorcery_catalogue_valid($body);
    // A surprisingly small full-catalogue response requires a maintenance review.
    if ($valid && $cache['body'] !== null) {
        $valid = count(json_decode($body, true)) >= count(json_decode($cache['body'], true)) * 0.8;
    }
    $saved = $valid ? ['body' => $body, 'updatedAt' => $now, 'retryAt' => $now + SORCERY_CATALOGUE_TTL]
        : array_merge($cache['saved'], ['retryAt' => $now + SORCERY_CATALOGUE_FAILURE_WAIT]);
    $stored = sorcery_catalogue_write($cache['path'], $saved);
    sorcery_catalogue_unlock($cache);
    return ['body' => $stored ? $saved['body'] : $cache['body'], 'state' => $valid && $stored ? 'refreshed' : 'stale'];
}

function sorcery_catalogue_respond(array $cache): void
{
    if ($cache['body'] === null) sorcery_error('The shared catalogue is unavailable; using the bundled fallback is recommended', 503);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Sorcery-Catalogue-Cache: ' . $cache['state']);
    http_response_code(200);
    echo $cache['body'];
    exit;
}
