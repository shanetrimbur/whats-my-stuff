<?php
declare(strict_types=1);

define('APP_ROOT', __DIR__);
define('DATABASE_PATH', APP_ROOT . '/database/database.db');
define('UPLOAD_DIR', APP_ROOT . '/uploads/items');
define('PUBLIC_UPLOAD_PATH', 'uploads/items');

function get_db(): SQLite3
{
    $db = new SQLite3(DATABASE_PATH);
    $db->enableExceptions(true);
    ensure_database_schema($db);

    return $db;
}

function ensure_database_schema(SQLite3 $db): void
{
    $db->exec(
        "CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE
        )"
    );

    $db->exec(
        "CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            image_path TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            title TEXT,
            description TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )"
    );

    $columns = [];
    $result = $db->query('PRAGMA table_info(items)');
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $columns[$row['name']] = true;
    }

    $optionalColumns = [
        'user_id' => 'INTEGER',
        'image_path' => 'TEXT',
        'title' => 'TEXT',
        'description' => 'TEXT',
        'created_at' => 'TEXT',
    ];

    foreach ($optionalColumns as $name => $definition) {
        if (!isset($columns[$name])) {
            $db->exec("ALTER TABLE items ADD COLUMN {$name} {$definition}");
        }
    }
}

function json_response(array $payload, int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode($payload);
}
?>
