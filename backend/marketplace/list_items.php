<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config.php';

try {
    $db = get_db();
    $results = $db->query(
        'SELECT id, image_path, tags, title, description, created_at
         FROM items
         ORDER BY id DESC'
    );

    $items = [];
    while ($row = $results->fetchArray(SQLITE3_ASSOC)) {
        $tags = json_decode($row['tags'] ?? '[]', true);
        $imagePath = $row['image_path'] ?? null;

        $items[] = [
            'id' => (int) $row['id'],
            'image_path' => $imagePath,
            'image_url' => $imagePath ? '../' . $imagePath : null,
            'tags' => is_array($tags) ? $tags : [],
            'title' => $row['title'] ?: 'Untitled item',
            'description' => $row['description'] ?: null,
            'created_at' => $row['created_at'] ?: null,
        ];
    }

    json_response(['status' => 'success', 'items' => $items]);
} catch (Throwable $error) {
    json_response(['status' => 'error', 'message' => 'Unable to load items'], 500);
}
?>
