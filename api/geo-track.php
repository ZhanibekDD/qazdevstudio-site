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

// ── IP ──────────────────────────────────────────────────────────
$ip = $_SERVER['HTTP_CF_CONNECTING_IP']
    ?? $_SERVER['HTTP_X_FORWARDED_FOR']
    ?? $_SERVER['REMOTE_ADDR']
    ?? '0.0.0.0';
$ip = trim(explode(',', $ip)[0]);

// ── POST body ───────────────────────────────────────────────────
$body     = json_decode(file_get_contents('php://input'), true) ?? [];
$page_url = substr(htmlspecialchars($body['page_url'] ?? '', ENT_QUOTES, 'UTF-8'), 0, 300);
$referrer = substr(htmlspecialchars($body['referrer'] ?? '', ENT_QUOTES, 'UTF-8'), 0, 300);
$ua       = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 300);

// ── Device ──────────────────────────────────────────────────────
if (preg_match('/iPhone|Android.*Mobile|Windows Phone/i', $ua))   $device = '📱 Смартфон';
elseif (preg_match('/iPad|Android(?!.*Mobile)/i', $ua))           $device = '📱 Планшет';
else                                                                $device = '💻 ПК / Ноутбук';

// ── 2ip.io geolocation ──────────────────────────────────────────
$geo   = [];
$token = defined('GEO_API_TOKEN') ? GEO_API_TOKEN : '';
if ($token && $token !== 'ВСТАВЬ_TOKEN_2IP') {
    $ctx = stream_context_create(['http' => [
        'timeout'       => 5,
        'header'        => "User-Agent: QazDevStudio/1.0\r\n",
        'ignore_errors' => true,
    ]]);
    $raw = @file_get_contents("https://api.2ip.io/geo/{$ip}?token={$token}", false, $ctx);
    if ($raw) $geo = json_decode($raw, true) ?: [];
}

// ── Extract fields ──────────────────────────────────────────────
$city     = $geo['city']             ?? '—';
$region   = $geo['region']           ?? '';
$country  = $geo['country']          ?? '—';
$code     = $geo['code']             ?? '';
$flag     = $geo['emoji']            ?? '🌍';
$lat      = $geo['lat']              ?? '';
$lon      = $geo['lon']              ?? '';
$tz       = $geo['timezone']         ?? '';
$asn_id   = $geo['asn']['id']        ?? '';
$asn_name = $geo['asn']['name']      ?? '';
$hosting  = $geo['asn']['hosting']   ?? false;
$vtype    = $hosting ? '⚠️ Хостинг / бот' : '✅ Живой пользователь';

// ── Build Telegram message ───────────────────────────────────────
$loc = "{$flag} {$city}";
if ($region && $region !== $city) $loc .= ", {$region}";
$loc .= ", {$country}";
if ($code) $loc .= " ({$code})";

$map_line = ($lat && $lon)
    ? "\n📍 <a href=\"https://maps.google.com/?q={$lat},{$lon}\">Открыть на карте</a>"
    : '';
$isp_line = $asn_name ? "\n🏢 AS{$asn_id} — {$asn_name}" : '';
$tz_line  = $tz       ? "\n⏰ {$tz}"                       : '';
$ref_line = $referrer ? "\n↩️ Откуда: {$referrer}"        : '';

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

// ── Send to Telegram ─────────────────────────────────────────────
$bot   = defined('BOT_TOKEN')         ? BOT_TOKEN         : '';
$admin = defined('ADMIN_TELEGRAM_ID') ? ADMIN_TELEGRAM_ID : '';
if ($bot && $admin) {
    $q = http_build_query([
        'chat_id'                  => $admin,
        'text'                     => $text,
        'parse_mode'               => 'HTML',
        'disable_web_page_preview' => true,
    ]);
    @file_get_contents("https://api.telegram.org/bot{$bot}/sendMessage?{$q}");
}

// ── Response to frontend ─────────────────────────────────────────
echo json_encode([
    'ok'      => true,
    'ip'      => $ip,
    'city'    => $city,
    'region'  => $region,
    'country' => $country,
    'code'    => $code,
    'flag'    => $flag,
    'lat'     => $lat,
    'lon'     => $lon,
    'tz'      => $tz,
    'isp'     => $asn_name,
    'asn'     => $asn_id,
    'hosting' => $hosting,
    'device'  => $device,
]);
