<?php
declare(strict_types=1);

require_once __DIR__ . '/shared/db.php';

function sorcery_scores_seed(): array
{
    $path = sorcery_docroot() . '/assets/sorcery_card_archetype_scores.json';
    if (!is_readable($path)) {
        return ['__meta' => ['categories' => []]];
    }

    $decoded = json_decode((string)file_get_contents($path), true);
    if (!is_array($decoded)) {
        return ['__meta' => ['categories' => []]];
    }

    if (!isset($decoded['__meta']) || !is_array($decoded['__meta'])) {
        $decoded['__meta'] = ['categories' => []];
    }

    return $decoded;
}

function sorcery_scores_load(PDO $pdo): array
{
    $stmt = $pdo->query('SELECT data_json FROM archetype_scores WHERE id = 1 LIMIT 1');
    $row = $stmt ? $stmt->fetch() : false;
    if ($row) {
        $decoded = json_decode((string)$row['data_json'], true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }

    $seed = sorcery_scores_seed();
    sorcery_scores_save($pdo, $seed);
    return $seed;
}

function sorcery_scores_save(PDO $pdo, array $scores): void
{
    $keys = array_filter(array_keys($scores), static fn (string $key): bool => $key !== '__meta');
    sort($keys, SORT_STRING);
    $sorted = [];
    if (isset($scores['__meta'])) {
        $sorted['__meta'] = $scores['__meta'];
    }
    foreach ($keys as $key) {
        $sorted[$key] = $scores[$key];
    }

    $json = json_encode($sorted, JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        sorcery_error('Scores could not be encoded', 400);
    }

    $stmt = $pdo->prepare(
        'INSERT INTO archetype_scores (id, data_json)
         VALUES (1, ?)
         ON DUPLICATE KEY UPDATE data_json = VALUES(data_json)'
    );
    $stmt->execute([$json]);
}

function sorcery_sanitize_category_name(string $name): string
{
    $name = strtolower(trim($name));
    $name = preg_replace('/\s+/', '_', $name) ?? '';
    $name = preg_replace('/[^a-z0-9_]/', '', $name) ?? '';
    return $name;
}

sorcery_require_method(['GET', 'POST']);

$pdo = sorcery_db();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    sorcery_json(sorcery_scores_load($pdo));
}

$action = (string)($_GET['action'] ?? '');
$payload = sorcery_read_json_object();

if ($action === 'update-score') {
    $cardName = (string)($payload['cardName'] ?? '');
    $archetype = (string)($payload['archetype'] ?? '');
    $delta = $payload['delta'] ?? null;

    if ($cardName === '' || $archetype === '' || !is_numeric($delta)) {
        sorcery_error('Missing cardName, archetype, or delta', 400);
    }

    $scores = sorcery_scores_load($pdo);
    $cardScores = isset($scores[$cardName]) && is_array($scores[$cardName])
        ? $scores[$cardName]
        : [];
    $current = isset($cardScores[$archetype]) && is_numeric($cardScores[$archetype])
        ? (int)$cardScores[$archetype]
        : 0;
    $next = $current + (int)$delta;

    if ($next === 0) {
        unset($cardScores[$archetype]);
        if (count($cardScores) === 0) {
            unset($scores[$cardName]);
        } else {
            $scores[$cardName] = $cardScores;
        }
    } else {
        $cardScores[$archetype] = $next;
        $scores[$cardName] = $cardScores;
    }

    sorcery_scores_save($pdo, $scores);
    sorcery_json(['ok' => true, 'score' => $next]);
}

if ($action === 'add-category') {
    $categoryName = (string)($payload['categoryName'] ?? '');
    $sanitized = sorcery_sanitize_category_name($categoryName);
    if ($sanitized === '') {
        sorcery_error('Invalid category name', 400);
    }

    $scores = sorcery_scores_load($pdo);
    if (!isset($scores['__meta']) || !is_array($scores['__meta'])) {
        $scores['__meta'] = ['categories' => []];
    }
    if (!isset($scores['__meta']['categories']) || !is_array($scores['__meta']['categories'])) {
        $scores['__meta']['categories'] = [];
    }

    $existing = [];
    foreach ($scores as $key => $value) {
        if ($key === '__meta' || !is_array($value)) {
            continue;
        }
        foreach (array_keys($value) as $archetype) {
            $existing[$archetype] = true;
        }
    }

    if (in_array($sanitized, $scores['__meta']['categories'], true) || isset($existing[$sanitized])) {
        sorcery_error('Category already exists', 409);
    }

    $scores['__meta']['categories'][] = $sanitized;
    sorcery_scores_save($pdo, $scores);
    sorcery_json(['ok' => true, 'name' => $sanitized]);
}

if ($action === 'save-full') {
    sorcery_scores_save($pdo, $payload);
    sorcery_json(['ok' => true]);
}

sorcery_error('Unknown action', 400);
