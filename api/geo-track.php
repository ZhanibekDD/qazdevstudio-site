<?php
error_reporting(0);
ini_set('display_errors', 0);
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit(json_encode(['ok' => false, 'error' => 'Method not allowed']));
}

$config = __DIR__ . '/config.php';
if (file_exists($config)) require_once $config;

// IP (CF → X-Forwarded → REMOTE_ADDR)
$ip = $_SERVER['HTTP_CF_CONNECTING_IP']
    ?? $_SERVER['HTTP_X_FORWARDED_FOR']
    ?? $_SERVER['REMOTE_ADDR']
    ?? '0.0.0.0';
$ip = trim(explode(',', $ip)[0]);

// POST body
$body     = json_decode(file_get_contents('php://input'), true) ?? [];
$page_url = substr(htmlspecialchars($body['page_url'] ?? '', ENT_QUOTES, 'UTF-8'), 0, 300);
$referrer = substr(htmlspecialchars($body['referrer'] ?? '', ENT_QUOTES, 'UTF-8'), 0, 300);
$ua       = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 300);

// Device
if (preg_match('/iPhone|Android.*Mobile|Windows Phone/i', $ua))   $device = '📱 Смартфон';
elseif (preg_match('/iPad|Android(?!.*Mobile)/i', $ua))           $device = '📱 Планшет';
else                                                                $device = '💻 ПК / Ноутбук';

// Flag emoji from ISO country code
function geoFlag(string $code): string {
    if (!$code || strlen($code) !== 2) return '🌍';
    $c = strtoupper($code);
    return mb_chr(127397 + ord($c[0])) . mb_chr(127397 + ord($c[1]));
}

// Geo via ip-api.com (free, no token, 45 req/min)
$geo  = [];
$fields = 'status,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as,hosting,proxy,query';
$url  = "http://ip-api.com/json/{$ip}?fields={$fields}&lang=ru";

$raw = false;
if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 6,
        CURLOPT_USERAGENT      => 'QazDevStudio/1.0',
    ]);
    $raw = curl_exec($ch);
    curl_close($ch);
} else {
    $ctx = stream_context_create(['http' => ['timeout' => 6, 'ignore_errors' => true]]);
    $raw = @file_get_contents($url, false, $ctx);
}

if ($raw) $geo = json_decode($raw, true) ?: [];

// Extract
$ok      = ($geo['status'] ?? '') === 'success';
$city    = $ok ? ($geo['city']       ?? '—') : '—';
$region  = $ok ? ($geo['regionName'] ?? '')  : '';
$country = $ok ? ($geo['country']    ?? '—') : '—';
$code    = $ok ? ($geo['countryCode']?? '')  : '';
$flag    = $ok ? geoFlag($code)              : '🌍';
$lat     = $ok ? ($geo['lat']        ?? '')  : '';
$lon     = $ok ? ($geo['lon']        ?? '')  : '';
$tz      = $ok ? ($geo['timezone']   ?? '')  : '';
$isp     = $ok ? ($geo['isp']        ?? '')  : '';
$asn_raw = $ok ? ($geo['as']         ?? '')  : ''; // "AS9198 JSC Kazakhtelecom"
$hosting = $ok ? (bool)($geo['hosting'] ?? $geo['proxy'] ?? false) : false;
$vtype   = $hosting ? '⚠️ Хостинг / VPN' : '✅ Живой пользователь';

// Parse ASN id and name from "AS9198 JSC Kazakhtelecom"
$asn_id = ''; $asn_name = '';
if (preg_match('/^(AS\d+)\s+(.+)$/', $asn_raw, $m)) {
    $asn_id   = $m[1];
    $asn_name = $m[2];
}

// Build location string
$loc = "{$flag} {$city}";
if ($region && $region !== $city) $loc .= ", {$region}";
$loc .= ", {$country}";
if ($code) $loc .= " ({$code})";

$map_line = ($lat && $lon)
    ? "\n📍 <a href=\"https://maps.google.com/?q={$lat},{$lon}\">Открыть на карте</a>"
    : '';
$isp_line = $isp     ? "\n🏢 {$asn_id} — {$isp}"  : '';
$tz_line  = $tz      ? "\n⏰ {$tz}"                 : '';
$ref_line = $referrer ? "\n↩️ Откуда: {$referrer}" : '';

$text =
    "👁 <b>Зашли на страницу /ip</b>\n" .
    "━━━━━━━━━━━━━━━━━━\n" .
    "🌐 IP: <code>{$ip}</code>\n" .
    "{$loc}{$tz_line}{$map_line}{$isp_line}\n" .
    "{$vtype}\n" .
    "━━━━━━━━━━━━━━━━━━\n" .
    "{$device}\n" .
    "🔗 {$page_url}" .
    $ref_line;

// Send to Telegram
$bot   = defined('BOT_TOKEN')         ? BOT_TOKEN         : '';
$admin = defined('ADMIN_TELEGRAM_ID') ? ADMIN_TELEGRAM_ID : '';
if ($bot && $admin) {
    $q = http_build_query([
        'chat_id'                  => $admin,
        'text'                     => $text,
        'parse_mode'               => 'HTML',
        'disable_web_page_preview' => true,
    ]);
    if (function_exists('curl_init')) {
        $ch = curl_init("https://api.telegram.org/bot{$bot}/sendMessage");
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $q,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 8,
        ]);
        curl_exec($ch);
        curl_close($ch);
    } else {
        @file_get_contents("https://api.telegram.org/bot{$bot}/sendMessage?{$q}");
    }
}

echo json_encode([
    'ok'      => true,
    'ip'      => $ip,
    'city'    => $city,
    'region'  => $region,
    'country' => $country,
    'code'    => $code,
    'flag'    => $flag,
    'lat'     => (string)$lat,
    'lon'     => (string)$lon,
    'tz'      => $tz,
    'isp'     => $isp,
    'asn'     => $asn_id,
    'hosting' => $hosting,
    'device'  => $device,
], JSON_UNESCAPED_UNICODE);
