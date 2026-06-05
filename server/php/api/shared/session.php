<?php
declare(strict_types=1);

require_once __DIR__ . '/db.php';

const SORCERY_SESSION_TTL_SECONDS = 2592000;

function sorcery_base64url(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function sorcery_uuid_v4(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    $hex = bin2hex($data);

    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex, 0, 8),
        substr($hex, 8, 4),
        substr($hex, 12, 4),
        substr($hex, 16, 4),
        substr($hex, 20)
    );
}

function sorcery_create_session(PDO $pdo, string $userId, string $username): string
{
    $token = sorcery_base64url(random_bytes(32));
    $tokenHash = hash('sha256', $token);
    $expiresAt = gmdate('Y-m-d H:i:s', time() + SORCERY_SESSION_TTL_SECONDS);

    $stmt = $pdo->prepare(
        'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
    );
    $stmt->execute([$tokenHash, $userId, $expiresAt]);

    $cleanup = $pdo->prepare('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()');
    $cleanup->execute();

    return $token;
}

function sorcery_bearer_token(): ?string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (stripos($header, 'Bearer ') !== 0) {
        return null;
    }

    $token = trim(substr($header, 7));
    return $token !== '' ? $token : null;
}

function sorcery_require_session(PDO $pdo): array
{
    $token = sorcery_bearer_token();
    if ($token === null) {
        sorcery_error('Unauthorized', 401);
    }

    $stmt = $pdo->prepare(
        'SELECT s.user_id, u.username
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()
         LIMIT 1'
    );
    $stmt->execute([hash('sha256', $token)]);
    $session = $stmt->fetch();

    if (!$session) {
        sorcery_error('Unauthorized', 401);
    }

    return [
        'userId' => (string)$session['user_id'],
        'username' => (string)$session['username'],
    ];
}
