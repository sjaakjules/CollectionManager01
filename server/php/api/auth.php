<?php
declare(strict_types=1);

require_once __DIR__ . '/shared/session.php';
require_once __DIR__ . '/shared/user-data.php';

const SORCERY_USERNAME_RE = '/^[a-zA-Z0-9_]{3,24}$/';

function sorcery_normalize_username(string $username): string
{
    return strtolower(trim($username));
}

function sorcery_validate_credentials(array $payload): array
{
    $username = trim((string)($payload['username'] ?? ''));
    $password = (string)($payload['password'] ?? '');
    $normalized = sorcery_normalize_username($username);

    if (
        !preg_match(SORCERY_USERNAME_RE, $username) ||
        strlen($password) < 6 ||
        $normalized === 'guest'
    ) {
        sorcery_error(
            'Username must be 3-24 letters/numbers/underscore and password must be at least 6 characters',
            400
        );
    }

    return [$username, $normalized, $password];
}

function sorcery_save_user_data(PDO $pdo, string $userId, array $data): void
{
    $json = json_encode($data, JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        sorcery_error('User data could not be encoded', 400);
    }

    $stmt = $pdo->prepare(
        'INSERT INTO user_data (user_id, data_json)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE data_json = VALUES(data_json)'
    );
    $stmt->execute([$userId, $json]);
}

function sorcery_handle_signup(PDO $pdo): void
{
    sorcery_require_method(['POST']);
    $payload = sorcery_read_json_object();
    [$username, $normalized, $password] = sorcery_validate_credentials($payload);
    if (array_key_exists('userData', $payload) &&
        (!is_array($payload['userData']) ||
         !is_array($payload['userData']['decks'] ?? null) ||
         !is_array($payload['userData']['collection'] ?? null))) {
        sorcery_error('Guest workspace could not be read. Your guest data has not been changed.', 400);
    }

    $existing = $pdo->prepare('SELECT id FROM users WHERE username_norm = ? LIMIT 1');
    $existing->execute([$normalized]);
    if ($existing->fetch()) {
        sorcery_error('Username already exists', 409);
    }

    $userId = sorcery_uuid_v4();
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare(
            'INSERT INTO users (id, username, username_norm, password_hash) VALUES (?, ?, ?, ?)'
        );
        $stmt->execute([$userId, $username, $normalized, $passwordHash]);
        // Keep signup and the guest transfer atomic: never return a session for
        // an empty account if saving the workspace failed. Identity is server-owned.
        $data = isset($payload['userData'])
            ? sorcery_sanitize_user_data($payload['userData'], $userId, $username)
            : sorcery_empty_user_data($userId, $username);
        sorcery_save_user_data($pdo, $userId, $data);
        $token = sorcery_create_session($pdo, $userId, $username);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        error_log('Signup failed: ' . $error->getMessage());
        sorcery_error('Signup failed', 500);
    }

    sorcery_json(['userId' => $userId, 'username' => $username, 'token' => $token]);
}

function sorcery_handle_login(PDO $pdo): void
{
    sorcery_require_method(['POST']);
    $payload = sorcery_read_json_object();
    $username = trim((string)($payload['username'] ?? ''));
    $password = (string)($payload['password'] ?? '');

    if ($username === '' || $password === '') {
        sorcery_error('Username and password are required', 400);
    }

    $stmt = $pdo->prepare(
        'SELECT id, username, password_hash FROM users WHERE username_norm = ? LIMIT 1'
    );
    $stmt->execute([sorcery_normalize_username($username)]);
    $account = $stmt->fetch();

    if (!$account || !password_verify($password, (string)$account['password_hash'])) {
        sorcery_error('Invalid credentials', 401);
    }

    $token = sorcery_create_session($pdo, (string)$account['id'], (string)$account['username']);
    sorcery_json([
        'userId' => (string)$account['id'],
        'username' => (string)$account['username'],
        'token' => $token,
    ]);
}

function sorcery_handle_user(PDO $pdo): void
{
    sorcery_require_method(['GET', 'PUT']);
    $path = trim((string)($_GET['path'] ?? ''), '/');
    $parts = explode('/', $path);

    if (count($parts) !== 2 || $parts[1] !== 'data' || $parts[0] === '') {
        sorcery_error('Not found', 404);
    }

    $userId = $parts[0];
    $session = sorcery_require_session($pdo);

    if ($session['userId'] !== $userId) {
        sorcery_error('Forbidden', 403);
    }

    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
        $stmt = $pdo->prepare('SELECT data_json FROM user_data WHERE user_id = ? LIMIT 1');
        $stmt->execute([$userId]);
        $row = $stmt->fetch();
        if (!$row) {
            sorcery_error('User data not found', 404);
        }
        // Keep JSON objects as objects: decoding into PHP arrays here would turn
        // empty position/label maps back into [] on every account download.
        $decoded = json_decode((string)$row['data_json']);
        sorcery_json(is_object($decoded) ? $decoded : sorcery_empty_user_data($userId, $session['username']));
    }

    $payload = sorcery_read_json_object();
    $data = sorcery_sanitize_user_data($payload, $userId, $session['username']);
    sorcery_save_user_data($pdo, $userId, $data);
    sorcery_json(['ok' => true]);
}

$pdo = sorcery_db();
$action = (string)($_GET['action'] ?? '');

if ($action === 'signup') {
    sorcery_handle_signup($pdo);
}

if ($action === 'login') {
    sorcery_handle_login($pdo);
}

if ($action === 'user') {
    sorcery_handle_user($pdo);
}

sorcery_error('Not found', 404);
