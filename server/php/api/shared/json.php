<?php
declare(strict_types=1);

function sorcery_json($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function sorcery_error(string $message, int $status = 400): void
{
    sorcery_json(['message' => $message, 'error' => $message], $status);
}

function sorcery_read_json_object(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        sorcery_error('Invalid request body', 400);
    }

    return $decoded;
}

function sorcery_require_method(array $methods): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'OPTIONS') {
        http_response_code(204);
        header('Allow: ' . implode(', ', $methods));
        exit;
    }

    if (!in_array($method, $methods, true)) {
        header('Allow: ' . implode(', ', $methods));
        sorcery_error('Method not allowed', 405);
    }
}
