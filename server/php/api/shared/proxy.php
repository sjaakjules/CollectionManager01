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

function sorcery_proxy_request(string $baseUrl, array $headers = []): void
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

    $curl = curl_init($targetUrl);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
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
        sorcery_error('Proxy request failed: ' . $error, 502);
    }

    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE) ?: 502;
    $headerSize = curl_getinfo($curl, CURLINFO_HEADER_SIZE) ?: 0;
    $contentType = curl_getinfo($curl, CURLINFO_CONTENT_TYPE) ?: 'application/octet-stream';
    curl_close($curl);

    $rawHeaders = substr((string)$response, 0, $headerSize);
    $responseBody = substr((string)$response, $headerSize);

    http_response_code((int)$status);
    header('Content-Type: ' . $contentType);
    header('X-Content-Type-Options: nosniff');

    foreach (preg_split('/\r?\n/', $rawHeaders) as $line) {
        if (preg_match('/^(x-ratelimit-[^:]+):\s*(.+)$/i', $line, $matches)) {
            header($matches[1] . ': ' . $matches[2], false);
        }
    }

    echo $responseBody;
    exit;
}
