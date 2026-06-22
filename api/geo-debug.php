<?php
// ВРЕМЕННЫЙ ДИАГНОСТИЧЕСКИЙ СКРИПТ — удалить после отладки
header('Content-Type: text/plain; charset=utf-8');

$config = __DIR__ . '/config.php';
if (file_exists($config)) require_once $config;

$token = defined('GEO_API_TOKEN') ? GEO_API_TOKEN : 'НЕ ОПРЕДЕЛЁН';
$ip    = '95.46.137.2'; // тестовый IP

echo "=== CONFIG ===\n";
echo "GEO_API_TOKEN: " . (defined('GEO_API_TOKEN') ? substr($token,0,6).'...' : 'НЕ ОПРЕДЕЛЁН') . "\n";
echo "BOT_TOKEN defined: " . (defined('BOT_TOKEN') ? 'да' : 'нет') . "\n\n";

echo "=== allow_url_fopen ===\n";
echo ini_get('allow_url_fopen') ? "включён\n" : "ВЫКЛЮЧЕН\n";

echo "\n=== cURL available ===\n";
echo function_exists('curl_init') ? "да\n" : "нет\n";

// Попробуем разные форматы endpoint
$endpoints = [
    "https://api.2ip.io/geo/{$ip}?token={$token}",
    "https://api.2ip.io/geo.json?ip={$ip}&token={$token}",
    "https://api.2ip.io/{$ip}.json?token={$token}",
];

foreach ($endpoints as $url) {
    echo "\n=== GET {$url} ===\n";

    // Попытка через cURL
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 8,
            CURLOPT_USERAGENT      => 'QazDevStudio/1.0',
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);

        echo "HTTP: {$code}\n";
        if ($err) echo "cURL error: {$err}\n";
        echo "Response: " . substr($resp ?: '(пусто)', 0, 500) . "\n";
    } else {
        // file_get_contents fallback
        $ctx = stream_context_create(['http'=>['timeout'=>8,'ignore_errors'=>true]]);
        $resp = @file_get_contents($url, false, $ctx);
        echo "Response: " . substr($resp ?: '(пусто)', 0, 500) . "\n";
    }

    // Если получили ответ — распарсим и покажем ключи
    if (!empty($resp)) {
        $d = json_decode($resp, true);
        if (is_array($d)) {
            echo "JSON keys: " . implode(', ', array_keys($d)) . "\n";
            break; // нашли рабочий endpoint
        }
    }
}
