<?php
declare(strict_types=1);

require_once __DIR__ . '/json.php';

function sorcery_proxy_path(): string
{
    $path = trim((string)($_GET['path'] ?? ''), '/');
    if (
        $path === '' ||
        preg_match('/^[a-z][a-z0-9+.-]*:/i', $path) ||
        strpos($path, '//') !== false ||
        preg_match('/(^|\/)\.\.(\/|$)/', $path) ||
        preg_match('/[\x00-\x1f\x7f]/', $path)
    ) {
        sorcery_error('Invalid proxy path', 400);
    }

    return $path;
}

function sorcery_proxy_query(): string
{
    $params = $_GET;
    unset($params['path']);
    $query = http_build_query($params);
    return $query !== '' ? '?' . $query : '';
}

function sorcery_proxy_millis(): int
{
    return (int)floor(microtime(true) * 1000);
}

function sorcery_proxy_rate_number($value): ?float
{
    if (is_int($value) || is_float($value)) {
        return is_finite((float)$value) ? (float)$value : null;
    }
    if (is_string($value) && is_numeric($value)) {
        return (float)$value;
    }
    return null;
}

function sorcery_proxy_header_number(?string $value): ?float
{
    if ($value === null || trim($value) === '' || !is_numeric(trim($value))) {
        return null;
    }
    return (float)trim($value);
}

function sorcery_proxy_retry_after_ms(?string $value, int $nowMs): ?int
{
    if ($value === null || trim($value) === '') {
        return null;
    }
    $trimmed = trim($value);
    if (is_numeric($trimmed)) {
        $milliseconds = ((float)$trimmed) * 1000;
        return is_finite($milliseconds) && $milliseconds >= 0 && $milliseconds <= PHP_INT_MAX
            ? (int)ceil($milliseconds) : null;
    }
    $dateSeconds = strtotime($trimmed);
    if ($dateSeconds === false) {
        return null;
    }
    return max(0, ($dateSeconds * 1000) - $nowMs);
}

function sorcery_proxy_reset_ms(?string $value, int $nowMs): ?int
{
    $parsed = sorcery_proxy_header_number($value);
    if ($parsed === null) {
        return null;
    }
    if ($parsed > 1000000000) {
        return (int)round($parsed * 1000);
    }
    return $nowMs + (int)round($parsed * 1000);
}

function sorcery_proxy_rate_paths(string $namespace): array
{
    $safeNamespace = preg_replace('/[^a-zA-Z0-9_-]/', '_', $namespace);
    if (!is_string($safeNamespace) || $safeNamespace === '') {
        $safeNamespace = 'default';
    }
    $basePath = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR
        . 'sorcery-stacks-proxy-rate-' . $safeNamespace;
    return [
        'state' => $basePath . '.json',
        'lock' => $basePath . '.lock',
    ];
}

function sorcery_proxy_read_rate_state(string $path): array
{
    if (!is_file($path)) {
        return [];
    }
    $raw = file_get_contents($path);
    if (!is_string($raw) || trim($raw) === '') {
        sorcery_error('Proxy rate limiter state is unreadable', 503);
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        sorcery_error('Proxy rate limiter state is invalid', 503);
    }
    foreach (['nextAllowedAtMs', 'retryAfterUntilMs', 'budgetReadyAtMs', 'updatedAtMs', 'remaining', 'resetMs'] as $key) {
        if (isset($decoded[$key]) && sorcery_proxy_rate_number($decoded[$key]) === null) {
            sorcery_error('Proxy rate limiter state is invalid', 503);
        }
    }
    return $decoded;
}

function sorcery_proxy_write_rate_state(string $path, array $state): void
{
    if (file_put_contents($path, json_encode($state, JSON_UNESCAPED_SLASHES)) === false) {
        sorcery_error('Proxy rate limiter state could not be saved', 503);
    }
}

function sorcery_proxy_rate_config(?array $config): ?array
{
    if ($config === null) {
        return null;
    }
    return [
        // Cards, decks, search and legacy aliases consume the same host budget.
        'namespace' => 'sorcerytcg',
        'minIntervalMs' => max(3000, (int)($config['min_interval_ms'] ?? 3000)),
        'lowRemainingThreshold' => max(2, (int)($config['low_remaining_threshold'] ?? 2)),
        'safeRemainingTarget' => max(5, (int)($config['safe_remaining_target'] ?? 5)),
        'maxSleepMs' => max(0, (int)($config['max_sleep_ms'] ?? 8000)),
    ];
}

function sorcery_proxy_rate_delay(array &$state, array $config, int $nowMs): array
{
    $delayMs = 0;
    $reason = 'spacing';

    $retryAfterUntilMs = sorcery_proxy_rate_number($state['retryAfterUntilMs'] ?? null);
    if ($retryAfterUntilMs !== null && $retryAfterUntilMs > $nowMs) {
        $delayMs = max($delayMs, (int)ceil($retryAfterUntilMs - $nowMs));
        $reason = 'retry-after';
    }

    $resetMs = sorcery_proxy_rate_number($state['resetMs'] ?? null);
    if ($resetMs !== null && $resetMs <= $nowMs) {
        unset($state['remaining'], $state['resetMs']);
    }

    $remaining = sorcery_proxy_rate_number($state['remaining'] ?? null);
    $resetMs = sorcery_proxy_rate_number($state['resetMs'] ?? null);
    if ($remaining !== null && $remaining <= $config['lowRemainingThreshold']) {
        if ($resetMs !== null && $resetMs > $nowMs) {
            $delayMs = max($delayMs, (int)ceil($resetMs - $nowMs));
            $reason = 'rate-reset';
        } else {
            $ticks = max(1, $config['safeRemainingTarget'] - (int)$remaining);
            // Anchor to the response time, not each arriving visitor. Otherwise
            // a 9s wait with an 8s sleep limit returns 429 forever.
            $observedAtMs = sorcery_proxy_rate_number($state['updatedAtMs'] ?? null) ?? $nowMs;
            $readyAtMs = $state['budgetReadyAtMs'] ?? ($observedAtMs + $ticks * $config['minIntervalMs']);
            if ($readyAtMs > $nowMs) {
                $delayMs = max($delayMs, (int)ceil($readyAtMs - $nowMs));
                $reason = 'rate-replenish';
            } else {
                unset($state['remaining'], $state['budgetReadyAtMs']);
            }
        }
    }

    $nextAllowedAtMs = sorcery_proxy_rate_number($state['nextAllowedAtMs'] ?? null);
    if ($nextAllowedAtMs !== null && $nextAllowedAtMs > $nowMs) {
        $delayMs = max($delayMs, (int)ceil($nextAllowedAtMs - $nowMs));
        if ($reason === 'spacing') {
            $reason = 'spacing';
        }
    }

    return [$delayMs, $reason];
}

function sorcery_proxy_rate_limit_begin(?array $configInput): ?array
{
    $config = sorcery_proxy_rate_config($configInput);
    if ($config === null) {
        return null;
    }

    $paths = sorcery_proxy_rate_paths($config['namespace']);
    $lockHandle = fopen($paths['lock'], 'c+');
    if ($lockHandle === false || !flock($lockHandle, LOCK_EX)) {
        sorcery_error('Proxy rate limiter unavailable', 503);
    }

    $state = sorcery_proxy_read_rate_state($paths['state']);
    $nowMs = sorcery_proxy_millis();
    [$delayMs, $reason] = sorcery_proxy_rate_delay($state, $config, $nowMs);

    if ($delayMs > $config['maxSleepMs']) {
        $retryAfterSeconds = max(1, (int)ceil($delayMs / 1000));
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
        header('Retry-After: ' . $retryAfterSeconds);
        header('X-Sorcery-Proxy-Throttle: active');
        header('X-Sorcery-Proxy-Min-Interval-Ms: ' . (int)$config['minIntervalMs']);
        header('X-Sorcery-Proxy-Delay-Ms: ' . $delayMs);
        header('X-Sorcery-Proxy-Delay-Reason: ' . $reason);
        sorcery_error('SorceryTCG proxy is waiting to respect upstream rate limits', 429);
    }

    if ($delayMs > 0) {
        usleep($delayMs * 1000);
    }

    // Verify writable state and reserve the attempt before contacting upstream.
    $state['nextAllowedAtMs'] = sorcery_proxy_millis() + 30000 + $config['minIntervalMs'];
    sorcery_proxy_write_rate_state($paths['state'], $state);

    return [
        'config' => $config,
        'statePath' => $paths['state'],
        'lockHandle' => $lockHandle,
        'delayMs' => $delayMs,
        'delayReason' => $reason,
    ];
}

function sorcery_proxy_extract_response_headers(string $rawHeaders): array
{
    $headers = [];
    foreach (preg_split('/\r?\n/', $rawHeaders) as $line) {
        if (preg_match('/^([^:]+):\s*(.+)$/', $line, $matches)) {
            $headers[strtolower($matches[1])] = trim($matches[2]);
        }
    }
    return $headers;
}

function sorcery_proxy_rate_limit_finish(?array $limiter, string $rawHeaders, int $status = 200): void
{
    if ($limiter === null) {
        return;
    }

    $config = $limiter['config'];
    $state = sorcery_proxy_read_rate_state($limiter['statePath']);
    $headers = sorcery_proxy_extract_response_headers($rawHeaders);
    $nowMs = sorcery_proxy_millis();

    $limit = sorcery_proxy_header_number($headers['x-ratelimit-limit'] ?? null);
    $remaining = sorcery_proxy_header_number($headers['x-ratelimit-remaining'] ?? null);
    $resetMs = sorcery_proxy_reset_ms($headers['x-ratelimit-reset'] ?? null, $nowMs);
    $retryAfterMs = sorcery_proxy_retry_after_ms($headers['retry-after'] ?? null, $nowMs);

    if ($limit !== null) {
        $state['limit'] = $limit;
    }
    if ($remaining !== null) {
        $state['remaining'] = $remaining;
        if ($remaining <= $config['lowRemainingThreshold']) {
            $state['budgetReadyAtMs'] = $nowMs
                + max(1, $config['safeRemainingTarget'] - (int)$remaining) * $config['minIntervalMs'];
        } else {
            unset($state['budgetReadyAtMs']);
        }
    }
    if ($resetMs !== null) {
        $state['resetMs'] = $resetMs;
    }
    if ($retryAfterMs !== null) {
        $state['retryAfterUntilMs'] = max($state['retryAfterUntilMs'] ?? 0, $nowMs + $retryAfterMs);
    } elseif ($status === 429 || $status === 503) {
        $state['retryAfterUntilMs'] = max($state['retryAfterUntilMs'] ?? 0, $nowMs + 60000);
    }

    $state['nextAllowedAtMs'] = $nowMs + $config['minIntervalMs'];
    $state['updatedAtMs'] = $nowMs;
    sorcery_proxy_write_rate_state($limiter['statePath'], $state);

    flock($limiter['lockHandle'], LOCK_UN);
    fclose($limiter['lockHandle']);
}

function sorcery_proxy_rate_limit_abort(?array $limiter): void
{
    if ($limiter === null) {
        return;
    }

    $config = $limiter['config'];
    $state = sorcery_proxy_read_rate_state($limiter['statePath']);
    $nowMs = sorcery_proxy_millis();

    // Even failed proxy attempts should consume the shared spacing window.
    $state['nextAllowedAtMs'] = $nowMs + $config['minIntervalMs'];
    $state['updatedAtMs'] = $nowMs;
    sorcery_proxy_write_rate_state($limiter['statePath'], $state);

    flock($limiter['lockHandle'], LOCK_UN);
    fclose($limiter['lockHandle']);
}

function sorcery_proxy_request(string $baseUrl, array $headers = [], array $options = []): void
{
    if (!function_exists('curl_init')) {
        sorcery_error('PHP cURL extension is required', 500);
    }

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'OPTIONS') {
        http_response_code(204);
        exit;
    }

    if (!in_array($method, ['GET', 'POST'], true)) {
        sorcery_error('Method not allowed', 405);
    }

    $targetUrl = rtrim($baseUrl, '/') . '/' . sorcery_proxy_path() . sorcery_proxy_query();
    $body = file_get_contents('php://input');
    $requestHeaders = $headers;
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if ($contentType !== '') {
        $requestHeaders[] = 'Content-Type: ' . $contentType;
    }
    $accept = $_SERVER['HTTP_ACCEPT'] ?? '';
    if ($accept !== '') {
        $requestHeaders[] = 'Accept: ' . $accept;
    }

    // Every upstream route is throttled, even when its caller omits options.
    $limiter = sorcery_proxy_rate_limit_begin($options['rate_limit'] ?? []);

    $curl = curl_init($targetUrl);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $requestHeaders,
        CURLOPT_USERAGENT => 'SorceryStacks/1.0',
    ]);

    if ($method === 'POST') {
        curl_setopt($curl, CURLOPT_POSTFIELDS, $body === false ? '' : $body);
    }

    $response = curl_exec($curl);
    if ($response === false) {
        $error = curl_error($curl);
        curl_close($curl);
        sorcery_proxy_rate_limit_abort($limiter);
        sorcery_error('Proxy request failed: ' . $error, 502);
    }

    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE) ?: 502;
    $headerSize = curl_getinfo($curl, CURLINFO_HEADER_SIZE) ?: 0;
    $contentType = curl_getinfo($curl, CURLINFO_CONTENT_TYPE) ?: 'application/octet-stream';
    curl_close($curl);

    $rawHeaders = substr((string)$response, 0, $headerSize);
    $responseBody = substr((string)$response, $headerSize);
    sorcery_proxy_rate_limit_finish($limiter, $rawHeaders, (int)$status);

    $safeContentType = preg_replace('/[\r\n].*/', '', (string)$contentType);
    if (!is_string($safeContentType) || trim($safeContentType) === '') {
        $safeContentType = 'application/octet-stream';
    }

    http_response_code((int)$status);
    header('Content-Type: ' . $safeContentType);
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Referrer-Policy: no-referrer');
    header('X-Content-Type-Options: nosniff');
    if ($limiter !== null) {
        $limiterConfig = $limiter['config'];
        $delayReason = preg_replace(
            '/[^a-zA-Z0-9_-]/',
            '',
            (string)($limiter['delayReason'] ?? 'spacing')
        );
        if (!is_string($delayReason) || $delayReason === '') {
            $delayReason = 'spacing';
        }
        header('X-Sorcery-Proxy-Throttle: active');
        header('X-Sorcery-Proxy-Min-Interval-Ms: ' . (int)$limiterConfig['minIntervalMs']);
        header('X-Sorcery-Proxy-Delay-Ms: ' . (int)$limiter['delayMs']);
        header('X-Sorcery-Proxy-Delay-Reason: ' . $delayReason);
    }

    foreach (preg_split('/\r?\n/', $rawHeaders) as $line) {
        if (preg_match('/^(x-ratelimit-[^:]+):\s*(.+)$/i', $line, $matches)) {
            header($matches[1] . ': ' . $matches[2], false);
        } elseif (preg_match('/^(retry-after):\s*(.+)$/i', $line, $matches)) {
            header($matches[1] . ': ' . $matches[2], false);
        }
    }

    echo $responseBody;
    exit;
}
