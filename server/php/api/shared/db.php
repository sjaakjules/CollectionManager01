<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

function sorcery_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = sorcery_config();
    $db = $config['db'] ?? [];
    $host = $db['host'] ?? 'localhost';
    $database = $db['database'] ?? '';
    $user = $db['user'] ?? '';
    $password = $db['password'] ?? '';
    $dsn = $db['dsn'] ?? sprintf(
        'mysql:host=%s;dbname=%s;charset=utf8mb4',
        $host,
        $database
    );

    try {
        $pdo = new PDO($dsn, $user, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (Throwable $error) {
        error_log('Sorcery DB connection failed: ' . $error->getMessage());
        sorcery_error('Database connection failed', 500);
    }

    return $pdo;
}
