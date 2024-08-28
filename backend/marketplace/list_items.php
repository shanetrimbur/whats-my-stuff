<?php
$db = new SQLite3('../database/database.db');
$results = $db->query('SELECT * FROM items');

$items = [];
while ($row = $results->fetchArray()) {
    $items[] = $row;
}

echo json_encode($items);
?>
