<?php
declare(strict_types=1);

function generate_tags_for_image(string $imagePath): array
{
    $tags = ['captured-item', 'needs-review'];

    $imageInfo = @getimagesize($imagePath);
    if ($imageInfo !== false && isset($imageInfo['mime'])) {
        $mimeTag = str_replace('image/', '', $imageInfo['mime']);
        $tags[] = $mimeTag;
    }

    return array_values(array_unique($tags));
}
?>
