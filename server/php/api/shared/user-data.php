<?php
declare(strict_types=1);

function sorcery_empty_user_data(string $userId, string $username): array
{
    return [
        'name' => $username,
        'id' => $userId,
        'decks' => [],
        'removedDecks' => (object)[],
        'collection' => [],
        'selectedCardCategory' => null,
        'favouriteDeckIds' => [],
        'canvasLabels' => [],
        'canvasAreas' => [],
    ];
}

function sorcery_sanitize_favourite_deck_ids($value): array
{
    if (!is_array($value)) {
        return [];
    }

    $seen = [];
    $ids = [];
    foreach ($value as $entry) {
        if (!is_string($entry)) {
            continue;
        }
        $id = trim($entry);
        if ($id === '' || isset($seen[$id])) {
            continue;
        }
        $seen[$id] = true;
        $ids[] = $id;
    }

    return $ids;
}

function sorcery_sanitize_canvas_labels($value): array
{
    if (!is_array($value)) {
        return [];
    }

    $labels = [];
    foreach ($value as $label) {
        if (!is_array($label)) {
            continue;
        }
        if (
            isset($label['id'], $label['text'], $label['x'], $label['y']) &&
            is_string($label['id']) &&
            is_string($label['text']) &&
            is_numeric($label['x']) &&
            is_numeric($label['y'])
        ) {
            $saved = [
                'id' => $label['id'],
                'text' => $label['text'],
                'x' => (float)$label['x'],
                'y' => (float)$label['y'],
            ];
            foreach (['areaId', 'parentLabelId'] as $key) {
                if (isset($label[$key]) && is_string($label[$key]) && $label[$key] !== '') {
                    $saved[$key] = $label[$key];
                }
            }
            $board = sorcery_normalize_saved_board($label['board'] ?? null);
            if ($board !== null) {
                $saved['board'] = $board;
            }
            $labels[] = $saved;
        }
    }

    return $labels;
}

function sorcery_normalize_saved_board($value): ?string
{
    if ($value === 'sideboard') {
        return 'collection';
    }
    return in_array($value, ['mainboard', 'collection', 'avatar', 'maybeboard'], true) ? $value : null;
}

function sorcery_normalize_saved_decks($value): array
{
    if (!is_array($value)) {
        return [];
    }
    return array_map(function ($deck) {
        if (is_array($deck) && is_array($deck['boards'] ?? null)) {
            $boards = $deck['boards'];
            if (array_key_exists('sideboard', $boards)) {
                if (!is_array($boards['collection'] ?? null)) {
                    $boards['collection'] = $boards['sideboard'];
                }
                unset($boards['sideboard']);
                $deck['boards'] = $boards;
            }
        }
        return $deck;
    }, array_values($value));
}

function sorcery_sanitize_canvas_areas($value): array
{
    if (!is_array($value)) {
        return [];
    }

    $areas = [];
    foreach ($value as $area) {
        if (!is_array($area)) {
            continue;
        }
        $type = $area['type'] ?? null;
        if (
            isset($area['id'], $area['name']) &&
            is_string($area['id']) &&
            is_string($area['name']) &&
            ($type === 'stack' || $type === 'deck')
        ) {
            if (is_array($area['cards'] ?? null)) {
                $area['cards'] = array_map(function ($card) {
                    if (is_array($card) && array_key_exists('board', $card)) {
                        $card['board'] = sorcery_normalize_saved_board($card['board']);
                    }
                    return $card;
                }, $area['cards']);
            }
            $areas[] = $area;
        }
    }

    return $areas;
}

function sorcery_sanitize_deck_removals($value): object
{
    $removals = [];
    if (is_array($value)) {
        foreach ($value as $id => $date) {
            // json_decode(..., true) converts numeric object keys to integers.
            // They are still valid string deck IDs in the shared JSON schema.
            $id = (string)$id;
            if (trim($id) !== '' && is_string($date) && strtotime($date) !== false) {
                $removals[$id] = $date;
            }
        }
    }
    return (object)$removals;
}

function sorcery_sanitize_user_data(array $payload, string $userId, string $username): array
{
    $selectedCardCategory = $payload['selectedCardCategory'] ?? null;
    if (!is_string($selectedCardCategory) && $selectedCardCategory !== null) {
        $selectedCardCategory = null;
    }

    $result = [
        'name' => $username,
        'id' => $userId,
        'decks' => sorcery_normalize_saved_decks($payload['decks'] ?? null),
        'removedDecks' => sorcery_sanitize_deck_removals($payload['removedDecks'] ?? null),
        'collection' => is_array($payload['collection'] ?? null) ? array_values($payload['collection']) : [],
        'selectedCardCategory' => $selectedCardCategory,
        'favouriteDeckIds' => sorcery_sanitize_favourite_deck_ids($payload['favouriteDeckIds'] ?? null),
        'canvasLabels' => sorcery_sanitize_canvas_labels($payload['canvasLabels'] ?? null),
        'canvasAreas' => sorcery_sanitize_canvas_areas($payload['canvasAreas'] ?? null),
    ];

    if (isset($payload['cardCategories']) && is_array($payload['cardCategories'])) {
        $result['cardCategories'] = $payload['cardCategories'];
    }
    if (isset($payload['catalogueLayout']) && is_array($payload['catalogueLayout'])) {
        $result['catalogueLayout'] = $payload['catalogueLayout'];
    }

    if (isset($payload['interactionEffects']) && is_array($payload['interactionEffects'])) {
        $effects = $payload['interactionEffects'];
        $result['interactionEffects'] = [
            'intensity' => in_array($effects['intensity'] ?? null, ['off', 'expressive'], true) ? $effects['intensity'] : 'subtle',
            'lettering' => in_array($effects['lettering'] ?? null, ['english', 'none'], true) ? $effects['lettering'] : 'both',
        ];
    }
    return $result;
}
