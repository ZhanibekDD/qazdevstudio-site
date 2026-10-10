<?php
// Preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit('{"error":"Method not allowed"}');
}

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';

/* ============================
   Helpers
   ============================ */

function s(mixed $val, int $max = 500): string {
    return mb_substr(strip_tags(trim((string)($val ?? ''))), 0, $max);
}

function getClientIP(): string {
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR'] as $h) {
        if (!empty($_SERVER[$h])) {
            $ip = trim(explode(',', $_SERVER[$h])[0]);
            if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                return $ip;
            }
        }
    }
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function detectDevice(string $ua): string {
    if (preg_match('/tablet|ipad|playbook|silk/i', $ua)) return 'tablet';
    if (preg_match('/mobile|android|iphone|ipod|blackberry|windows phone/i', $ua)) return 'mobile';
    return 'desktop';
}

function detectBrowser(string $ua): string {
    if (preg_match('/YaBrowser\//i', $ua))                         return 'Yandex';
    if (preg_match('/Edg\//i', $ua))                               return 'Edge';
    if (preg_match('/OPR\/|Opera/i', $ua))                         return 'Opera';
    if (preg_match('/Chrome\//i', $ua))                            return 'Chrome';
    if (preg_match('/Firefox\//i', $ua))                           return 'Firefox';
    if (preg_match('/Safari\//i', $ua))                            return 'Safari';
    if (preg_match('/MSIE|Trident/i', $ua))                        return 'IE';
    return 'Other';
}

function detectOS(string $ua): string {
    if (preg_match('/Windows NT/i', $ua))  return 'Windows';
    if (preg_match('/Android/i', $ua))     return 'Android';
    if (preg_match('/iPhone|iPad/i', $ua)) return 'iOS';
    if (preg_match('/Mac OS X/i', $ua))    return 'macOS';
    if (preg_match('/Linux/i', $ua))       return 'Linux';
    return 'Other';
}

function getTrafficSource(string $referrer, string $utm_source): string {
    if ($utm_source) return ucfirst($utm_source);
    if (!$referrer)  return 'Direct';
    if (preg_match('/google\./i',    $referrer)) return 'Google';
    if (preg_match('/yandex\./i',    $referrer)) return 'Yandex';
    if (preg_match('/instagram\./i', $referrer)) return 'Instagram';
    if (preg_match('/tiktok\./i',    $referrer)) return 'TikTok';
    if (preg_match('/t\.me|telegram/i', $referrer)) return 'Telegram';
    if (preg_match('/whatsapp/i',    $referrer)) return 'WhatsApp';
    if (preg_match('/facebook\./i',  $referrer)) return 'Facebook';
    if (preg_match('/vk\.com/i',     $referrer)) return 'VKontakte';
    return parse_url($referrer, PHP_URL_HOST) ?: 'Referral';
}

function getGeoInfo(string $ip): array {
    // Skip private / local IPs
    if (in_array(substr($ip, 0, 3), ['127', '0.0', '::1'])
        || str_starts_with($ip, '192.168.')
        || str_starts_with($ip, '10.')
    ) {
        return ['country' => '', 'city' => 'Localhost'];
    }

    try {
        $db   = getDB();
        $stmt = $db->prepare(
            "SELECT country, city FROM geo_cache WHERE ip = ? AND cached_at > datetime('now', '-" . GEO_CACHE_HOURS . " hours')"
        );
        $stmt->execute([$ip]);
        $row = $stmt->fetch();
        if ($row) return ['country' => $row['country'], 'city' => $row['city']];
    } catch (Exception $e) {}

    // External lookup with 2 s timeout
    $url  = "http://ip-api.com/json/{$ip}?fields=status,country,city&lang=ru";
    $ctx  = stream_context_create(['http' => ['timeout' => 2, 'ignore_errors' => true]]);
    $json = @file_get_contents($url, false, $ctx);

    if ($json) {
        $data = json_decode($json, true);
        if (isset($data['status']) && $data['status'] === 'success') {
            $country = $data['country'] ?? '';
            $city    = $data['city']    ?? '';
            try {
                $db   = getDB();
                $stmt = $db->prepare(
                    "INSERT OR REPLACE INTO geo_cache (ip, country, city, cached_at) VALUES (?, ?, ?, datetime('now'))"
                );
                $stmt->execute([$ip, $country, $city]);
            } catch (Exception $e) {}
            return ['country' => $country, 'city' => $city];
        }
    }

    return ['country' => '', 'city' => ''];
}

function sendTelegram(string $text, ?string $chatId = null, array $extra = []): void {
    if (!defined('BOT_TOKEN') || BOT_TOKEN === 'ВСТАВЬ_ТОКЕН_БОТА')             return;
    if (!defined('ADMIN_TELEGRAM_ID') || ADMIN_TELEGRAM_ID === 'ВСТАВЬ_СВОЙ_TELEGRAM_ID') return;

    $params = array_merge([
        'chat_id'    => $chatId ?? ADMIN_TELEGRAM_ID,
        'text'       => mb_substr($text, 0, 4096),
        'parse_mode' => 'HTML',
    ], $extra);

    $ctx = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => 'Content-Type: application/json',
            'content'       => json_encode($params, JSON_UNESCAPED_UNICODE),
            'timeout'       => 5,
            'ignore_errors' => true,
        ]
    ]);
    @file_get_contents('https://api.telegram.org/bot' . BOT_TOKEN . '/sendMessage', false, $ctx);
}

function buildNotification(
    string $type, string $label, string $url,
    string $city, string $country, string $ip, string $device,
    array $extra, string $now
): ?string {
    $loc = implode(' / ', array_filter([$city, $country]));

    switch ($type) {
        case 'whatsapp_click':
            $m  = "💬 <b>Клик по WhatsApp</b>\n\n";
            $m .= "📄 Страница: <code>{$url}</code>\n";
            if ($label) $m .= "🎯 Кнопка: {$label}\n";
            if ($loc)   $m .= "🌍 Город: {$loc}\n";
            $m .= "📱 Устройство: {$device}\n";
            $m .= "🌐 IP: <code>{$ip}</code>";
            return $m;

        case 'telegram_click':
            $m  = "✈️ <b>Клик по Telegram</b>\n\n";
            $m .= "📄 Страница: <code>{$url}</code>\n";
            if ($label) $m .= "🎯 Кнопка: {$label}\n";
            if ($loc)   $m .= "🌍 Город: {$loc}\n";
            $m .= "📱 Устройство: {$device}\n";
            $m .= "🌐 IP: <code>{$ip}</code>";
            return $m;

        case 'phone_click':
            $m  = "📞 <b>Клик по телефону</b>\n\n";
            $m .= "📄 Страница: <code>{$url}</code>\n";
            if ($label) $m .= "🎯 Кнопка: {$label}\n";
            if ($loc)   $m .= "🌍 Город: {$loc}\n";
            $m .= "📱 Устройство: {$device}\n";
            $m .= "🌐 IP: <code>{$ip}</code>";
            return $m;

        case 'email_click':
            $m  = "📧 <b>Клик по Email</b>\n\n";
            $m .= "📄 Страница: <code>{$url}</code>\n";
            if ($loc) $m .= "🌍 Город: {$loc}\n";
            $m .= "🌐 IP: <code>{$ip}</code>";
            return $m;

        case 'price_click':
            $m  = "💰 <b>Интерес к тарифу</b>\n\n";
            if ($label) $m .= "🎯 Тариф: {$label}\n";
            $m .= "📄 Страница: <code>{$url}</code>\n";
            if ($loc) $m .= "🌍 Город: {$loc}\n";
            $m .= "📱 Устройство: {$device}\n";
            $m .= "🌐 IP: <code>{$ip}</code>";
            return $m;

        case 'form_submit':
            $service = s($extra['service'] ?? '');
            $cityL   = s($extra['city']    ?? '');
            $phone   = s($extra['phone']   ?? '');
            $comment = s($extra['comment'] ?? '');

            $m  = "📝 <b>Новая заявка с сайта!</b>\n\n";
            if ($phone)   $m .= "📞 Телефон: <code>{$phone}</code>\n";
            if ($cityL)   $m .= "🏙 Город: {$cityL}\n";
            if ($service) $m .= "🛠 Услуга: {$service}\n";
            if ($comment) $m .= "💬 Комментарий: {$comment}\n";
            $m .= "\n📄 Страница: <code>{$url}</code>\n";
            $m .= "🌐 IP: <code>{$ip}</code>\n";
            $m .= "🕒 Время: " . date('d.m.Y H:i', strtotime($now));
            return $m;

        default:
            return null;
    }
}

/* ============================
   Main
   ============================ */

$raw = file_get_contents('php://input');
if (strlen($raw) > 8192) {
    http_response_code(413);
    exit('{"error":"Payload too large"}');
}

$data = json_decode($raw, true);
if (!is_array($data)) {
    http_response_code(400);
    exit('{"error":"Invalid JSON"}');
}

// Extract + sanitize
$visitor_id   = s($data['visitor_id']   ?? '', 64);
$session_id   = s($data['session_id']   ?? '', 64);
$event_type   = s($data['event_type']   ?? '', 64);
$event_label  = s($data['event_label']  ?? '', 200);
$page_url     = s($data['page_url']     ?? '', 500);
$page_title   = s($data['page_title']   ?? '', 200);
$referrer     = s($data['referrer']     ?? '', 500);
$utm_source   = s($data['utm_source']   ?? '', 100);
$utm_medium   = s($data['utm_medium']   ?? '', 100);
$utm_campaign = s($data['utm_campaign'] ?? '', 100);
$extra        = is_array($data['extra'] ?? null) ? $data['extra'] : [];

if (!$visitor_id || !$session_id || !$event_type) {
    http_response_code(400);
    exit('{"error":"Missing required fields"}');
}

// Client detection
$ip      = getClientIP();
$ua      = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 500);
$device  = detectDevice($ua);
$browser = detectBrowser($ua);
$os      = detectOS($ua);
$now     = date('Y-m-d H:i:s');
$geo     = getGeoInfo($ip);
$country = $geo['country'];
$city    = $geo['city'];

try {
    $db = getDB();

    if ($event_type === 'page_view') {
        // New session check
        $st  = $db->prepare('SELECT id FROM visits WHERE session_id = ? LIMIT 1');
        $st->execute([$session_id]);
        $isNew = !$st->fetch();

        $st = $db->prepare('INSERT INTO visits
            (visitor_id,session_id,ip,user_agent,device_type,browser,os,
             page_url,page_title,referrer,utm_source,utm_medium,utm_campaign,
             country,city,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        $st->execute([
            $visitor_id,$session_id,$ip,$ua,$device,$browser,$os,
            $page_url,$page_title,$referrer,$utm_source,$utm_medium,$utm_campaign,
            $country,$city,$now,
        ]);

        if ($isNew && NOTIFY_NEW_VISITS) {
            $source = getTrafficSource($referrer, $utm_source);
            $loc    = implode(' / ', array_filter([$city, $country]));
            $m  = "🟢 <b>Новый визит на сайт</b>\n\n";
            $m .= "📄 Страница: <code>{$page_url}</code>\n";
            if ($loc)    $m .= "🌍 Город: {$loc}\n";
            $m .= "📱 Устройство: {$device}\n";
            $m .= "🧭 Браузер: {$browser}\n";
            $m .= "🔗 Источник: {$source}\n";
            $m .= "🌐 IP: <code>{$ip}</code>\n";
            $m .= "🕒 Время: " . date('d.m.Y H:i', strtotime($now));
            sendTelegram($m);
        }

    } else {
        // Save event
        $st = $db->prepare('INSERT INTO events
            (visitor_id,session_id,event_type,event_label,page_url,extra_json,created_at)
            VALUES (?,?,?,?,?,?,?)');
        $st->execute([
            $visitor_id,$session_id,$event_type,$event_label,
            $page_url,json_encode($extra, JSON_UNESCAPED_UNICODE),$now,
        ]);

        // Also persist lead
        if ($event_type === 'form_submit' && !empty($extra)) {
            $st = $db->prepare('INSERT INTO leads
                (visitor_id,session_id,phone,city,service,comment,page_url,created_at)
                VALUES (?,?,?,?,?,?,?,?)');
            $st->execute([
                $visitor_id, $session_id,
                s($extra['phone']   ?? ''),
                s($extra['city']    ?? ''),
                s($extra['service'] ?? ''),
                s($extra['comment'] ?? ''),
                $page_url, $now,
            ]);
        }

        // Telegram notification (no scrolls, no internal meta events)
        $silent = ['scroll_50', 'scroll_90', 'form_start', 'contact_intent', 'service_select', 'button_click'];
        if (NOTIFY_IMPORTANT_EVENTS && !in_array($event_type, $silent)) {
            $note = buildNotification($event_type,$event_label,$page_url,$city,$country,$ip,$device,$extra,$now);
            if ($note) sendTelegram($note);
        }
    }

    echo '{"ok":true}';

} catch (Exception $e) {
    error_log('QazDev Track Error: ' . $e->getMessage());
    http_response_code(500);
    echo '{"ok":false}';
}
