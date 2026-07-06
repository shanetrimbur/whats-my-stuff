<?php
declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/process_image.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'Method not allowed'], 405);
    exit;
}

try {
    if (empty($_POST['image'])) {
        json_response(['status' => 'error', 'message' => 'Missing image payload'], 400);
        exit;
    }

    if (!preg_match('/^data:image\/(png|jpe?g|webp);base64,(.+)$/', $_POST['image'], $matches)) {
        json_response(['status' => 'error', 'message' => 'Unsupported image format'], 400);
        exit;
    }

    $extension = $matches[1] === 'jpeg' ? 'jpg' : $matches[1];
    $imageBinary = base64_decode($matches[2], true);
    if ($imageBinary === false) {
        json_response(['status' => 'error', 'message' => 'Invalid image data'], 400);
        exit;
    }

    if (strlen($imageBinary) > 8 * 1024 * 1024) {
        json_response(['status' => 'error', 'message' => 'Image exceeds 8MB limit'], 413);
        exit;
    }

    if (!is_dir(UPLOAD_DIR) && !mkdir(UPLOAD_DIR, 0755, true)) {
        throw new RuntimeException('Unable to create upload directory');
    }

    $filename = sprintf('item_%s_%s.%s', date('Ymd_His'), bin2hex(random_bytes(6)), $extension);
    $absolutePath = UPLOAD_DIR . '/' . $filename;
    if (file_put_contents($absolutePath, $imageBinary) === false) {
        throw new RuntimeException('Unable to save uploaded image');
    }

    $relativePath = PUBLIC_UPLOAD_PATH . '/' . $filename;
    $tags = generate_tags_for_image($absolutePath);
    $title = 'Captured item';

    $db = get_db();
    $stmt = $db->prepare(
        'INSERT INTO items (image_path, tags, title, created_at)
         VALUES (:image_path, :tags, :title, :created_at)'
    );
    $stmt->bindValue(':image_path', $relativePath, SQLITE3_TEXT);
    $stmt->bindValue(':tags', json_encode($tags), SQLITE3_TEXT);
    $stmt->bindValue(':title', $title, SQLITE3_TEXT);
    $stmt->bindValue(':created_at', date(DATE_ATOM), SQLITE3_TEXT);
    $stmt->execute();

    $item = [
        'id' => $db->lastInsertRowID(),
        'image_path' => $relativePath,
        'image_url' => '../' . $relativePath,
        'tags' => $tags,
        'title' => $title,
        'description' => null,
        'created_at' => date(DATE_ATOM),
    ];

    json_response(['status' => 'success', 'item' => $item], 201);
} catch (Throwable $error) {
    json_response(['status' => 'error', 'message' => 'Unable to save image'], 500);
}
?>
