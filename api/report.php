<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';

/* ============================
   Individual report functions
   Each returns a Telegram-ready HTML string.
   ============================ */

function rpt_today(): string {
    $db    = getDB();
    $today = date('Y-m-d');

    $visits  = (int)$db->query("SELECT COUNT(*)          FROM visits WHERE DATE(created_at)='{$today}'")->fetchColumn();
    $unique  = (int)$db->query("SELECT COUNT(DISTINCT visitor_id) FROM visits WHERE DATE(created_at)='{$today}'")->fetchColumn();
    $wa      = (int)$db->query("SELECT COUNT(*) FROM events WHERE event_type='whatsapp_click' AND DATE(created_at)='{$today}'")->fetchColumn();
    $tg      = (int)$db->query("SELECT COUNT(*) FROM events WHERE event_type='telegram_click'  AND DATE(created_at)='{$today}'")->fetchColumn();
    $ph      = (int)$db->query("SELECT COUNT(*) FROM events WHERE event_type='phone_click'     AND DATE(created_at)='{$today}'")->fetchColumn();
    $leads   = (int)$db->query("SELECT COUNT(*) FROM leads   WHERE DATE(created_at)='{$today}'")->fetchColumn();

    $pages = $db->query(
        "SELECT page_url, COUNT(*) cnt FROM visits WHERE DATE(created_at)='{$today}' GROUP BY page_url ORDER BY cnt DESC LIMIT 5"
    )->fetchAll();

    $sources = $db->query("
        SELECT
            CASE
                WHEN utm_source != '' THEN utm_source
                WHEN referrer = ''    THEN 'Direct'
                WHEN referrer LIKE '%google%'    THEN 'Google'
                WHEN referrer LIKE '%yandex%'    THEN 'Yandex'
                WHEN referrer LIKE '%instagram%' THEN 'Instagram'
                WHEN referrer LIKE '%tiktok%'    THEN 'TikTok'
                WHEN referrer LIKE '%t.me%' OR referrer LIKE '%telegram%' THEN 'Telegram'
                ELSE 'Other'
            END AS src, COUNT(*) cnt
        FROM visits WHERE DATE(created_at)='{$today}'
        GROUP BY src ORDER BY cnt DESC LIMIT 5
    ")->fetchAll();

    $m  = "📊 <b>Статистика за сегодня</b> — " . date('d.m.Y') . "\n";
    $m .= "━━━━━━━━━━━━━━━━━━\n";
    $m .= "👁 Визиты:      <b>{$visits}</b>\n";
    $m .= "👤 Уникальные:  <b>{$unique}</b>\n\n";
    $m .= "💬 WhatsApp:    <b>{$wa}</b>\n";
    $m .= "✈️ Telegram:    <b>{$tg}</b>\n";
    $m .= "📞 Телефон:     <b>{$ph}</b>\n";
    $m .= "📝 Заявки:      <b>{$leads}</b>\n";

    if ($pages) {
        $m .= "\n📄 <b>Страницы:</b>\n";
        foreach ($pages as $p) {
            $m .= "  " . htmlspecialchars($p['page_url']) . " — {$p['cnt']}\n";
        }
    }
    if ($sources) {
        $m .= "\n🔗 <b>Источники:</b>\n";
        foreach ($sources as $s) {
            $m .= "  {$s['src']} — {$s['cnt']}\n";
        }
    }

    return $m;
}

function rpt_7days(): string {
    $db = getDB();

    $visits  = (int)$db->query("SELECT COUNT(*)          FROM visits WHERE created_at >= datetime('now','-7 days')")->fetchColumn();
    $unique  = (int)$db->query("SELECT COUNT(DISTINCT visitor_id) FROM visits WHERE created_at >= datetime('now','-7 days')")->fetchColumn();
    $wa      = (int)$db->query("SELECT COUNT(*) FROM events WHERE event_type='whatsapp_click' AND created_at >= datetime('now','-7 days')")->fetchColumn();
    $tg      = (int)$db->query("SELECT COUNT(*) FROM events WHERE event_type='telegram_click'  AND created_at >= datetime('now','-7 days')")->fetchColumn();
    $ph      = (int)$db->query("SELECT COUNT(*) FROM events WHERE event_type='phone_click'     AND created_at >= datetime('now','-7 days')")->fetchColumn();
    $leads   = (int)$db->query("SELECT COUNT(*) FROM leads   WHERE created_at >= datetime('now','-7 days')")->fetchColumn();

    $byDay = $db->query(
        "SELECT DATE(created_at) day, COUNT(*) cnt FROM visits WHERE created_at >= datetime('now','-7 days') GROUP BY day ORDER BY day"
    )->fetchAll();

    $contacts = $wa + $tg + $ph;
    $conv     = $visits > 0 ? round($contacts / $visits * 100, 1) : 0;

    $m  = "📈 <b>Статистика за 7 дней</b>\n";
    $m .= "━━━━━━━━━━━━━━━━━━\n";
    $m .= "👁 Визитов:     <b>{$visits}</b>\n";
    $m .= "👤 Уникальных:  <b>{$unique}</b>\n";
    $m .= "💬 WhatsApp:    <b>{$wa}</b>\n";
    $m .= "✈️ Telegram:    <b>{$tg}</b>\n";
    $m .= "📞 Телефон:     <b>{$ph}</b>\n";
    $m .= "📝 Заявки:      <b>{$leads}</b>\n";
    $m .= "🎯 Конверсия:   <b>{$conv}%</b>\n";

    if ($byDay) {
        $m .= "\n📅 <b>По дням:</b>\n";
        $max = max(array_column($byDay, 'cnt')) ?: 1;
        foreach ($byDay as $d) {
            $date  = date('d.m', strtotime($d['day']));
            $bar   = str_repeat('▪', (int)round($d['cnt'] / $max * 8));
            $m    .= "  {$date}: {$d['cnt']} {$bar}\n";
        }
    }

    return $m;
}

function rpt_visitors(int $limit = 10): string {
    $db   = getDB();
    $rows = $db->query(
        "SELECT page_url, city, country, device_type, referrer, utm_source, ip, created_at
         FROM visits ORDER BY created_at DESC LIMIT {$limit}"
    )->fetchAll();

    if (!$rows) return "👥 Посетителей пока нет.";

    $m = "👥 <b>Последние {$limit} визитов:</b>\n━━━━━━━━━━━━━━━━━━\n";
    foreach ($rows as $r) {
        $time = date('d.m H:i', strtotime($r['created_at']));
        $loc  = implode('/', array_filter([$r['city'], $r['country']]));
        $src  = $r['utm_source'] ?: (
            str_contains($r['referrer'], 'google')    ? 'Google'  : (
            str_contains($r['referrer'], 'yandex')    ? 'Yandex'  : (
            str_contains($r['referrer'], 't.me')      ? 'Telegram': (
            $r['referrer'] ? 'Ref' : 'Direct')))
        );
        $m .= "🕒 {$time} | {$r['device_type']}\n";
        $m .= "📄 " . htmlspecialchars($r['page_url']) . "\n";
        if ($loc) $m .= "🌍 {$loc} | 🔗 {$src}\n";
        $m .= "🌐 <code>{$r['ip']}</code>\n\n";
    }
    return rtrim($m);
}

function rpt_pages(): string {
    $db = getDB();

    $today = $db->query(
        "SELECT page_url, COUNT(*) cnt FROM visits WHERE DATE(created_at)=DATE('now') GROUP BY page_url ORDER BY cnt DESC LIMIT 8"
    )->fetchAll();
    $week = $db->query(
        "SELECT page_url, COUNT(*) cnt FROM visits WHERE created_at >= datetime('now','-7 days') GROUP BY page_url ORDER BY cnt DESC LIMIT 8"
    )->fetchAll();

    $m  = "📄 <b>Топ страниц</b>\n━━━━━━━━━━━━━━━━━━\n";
    $m .= "<b>Сегодня:</b>\n";
    foreach ($today as $p) $m .= "  " . htmlspecialchars($p['page_url']) . " — {$p['cnt']}\n";
    if (!$today) $m .= "  Нет данных\n";
    $m .= "\n<b>7 дней:</b>\n";
    foreach ($week as $p) $m .= "  " . htmlspecialchars($p['page_url']) . " — {$p['cnt']}\n";
    if (!$week) $m .= "  Нет данных\n";

    return $m;
}

function rpt_contact(string $type, string $emoji, string $name): string {
    $db = getDB();

    $today  = (int)$db->query("SELECT COUNT(*) FROM events WHERE event_type='{$type}' AND DATE(created_at)=DATE('now')")->fetchColumn();
    $week   = (int)$db->query("SELECT COUNT(*) FROM events WHERE event_type='{$type}' AND created_at >= datetime('now','-7 days')")->fetchColumn();
    $total  = (int)$db->query("SELECT COUNT(*) FROM events WHERE event_type='{$type}'")->fetchColumn();
    $recent = $db->query(
        "SELECT page_url, event_label, created_at FROM events WHERE event_type='{$type}' ORDER BY created_at DESC LIMIT 5"
    )->fetchAll();

    $m  = "{$emoji} <b>{$name}</b>\n━━━━━━━━━━━━━━━━━━\n";
    $m .= "Сегодня: <b>{$today}</b>\n";
    $m .= "7 дней:  <b>{$week}</b>\n";
    $m .= "Всего:   <b>{$total}</b>\n";

    if ($recent) {
        $m .= "\n<b>Последние клики:</b>\n";
        foreach ($recent as $r) {
            $time  = date('d.m H:i', strtotime($r['created_at']));
            $label = $r['event_label'] ? " — {$r['event_label']}" : '';
            $m    .= "  🕒 {$time}{$label}\n";
            $m    .= "  📄 " . htmlspecialchars($r['page_url']) . "\n";
        }
    }

    return $m;
}

function rpt_leads(int $limit = 10): string {
    $db   = getDB();
    $rows = $db->query("SELECT * FROM leads ORDER BY created_at DESC LIMIT {$limit}")->fetchAll();

    if (!$rows) return "📝 Заявок пока нет.";

    $m = "📝 <b>Последние заявки:</b>\n━━━━━━━━━━━━━━━━━━\n";
    foreach ($rows as $r) {
        $time = date('d.m H:i', strtotime($r['created_at']));
        $m   .= "🕒 {$time}\n";
        if ($r['phone'])   $m .= "📞 {$r['phone']}\n";
        if ($r['city'])    $m .= "🏙 {$r['city']}\n";
        if ($r['service']) $m .= "🛠 {$r['service']}\n";
        if ($r['comment']) $m .= "💬 " . htmlspecialchars($r['comment']) . "\n";
        $m .= "\n";
    }
    return rtrim($m);
}

function rpt_sources(): string {
    $db   = getDB();
    $rows = $db->query("
        SELECT
            CASE
                WHEN utm_source != ''  THEN utm_source
                WHEN referrer = ''     THEN 'Direct'
                WHEN referrer LIKE '%google%'    THEN 'Google'
                WHEN referrer LIKE '%yandex%'    THEN 'Yandex'
                WHEN referrer LIKE '%instagram%' THEN 'Instagram'
                WHEN referrer LIKE '%tiktok%'    THEN 'TikTok'
                WHEN referrer LIKE '%t.me%' OR referrer LIKE '%telegram%' THEN 'Telegram'
                WHEN referrer LIKE '%whatsapp%'  THEN 'WhatsApp'
                WHEN referrer LIKE '%facebook%'  THEN 'Facebook'
                WHEN referrer LIKE '%vk.com%'    THEN 'VKontakte'
                ELSE 'Other'
            END AS src,
            COUNT(*) AS total,
            COUNT(CASE WHEN created_at >= datetime('now','-7 days')  THEN 1 END) AS week,
            COUNT(CASE WHEN DATE(created_at) = DATE('now')           THEN 1 END) AS today
        FROM visits
        GROUP BY src ORDER BY total DESC LIMIT 12
    ")->fetchAll();

    if (!$rows) return "🔥 Данных об источниках пока нет.";

    $lines = sprintf("%-14s %5s %5s %5s\n", 'Источник', 'Всего', '7дн', 'Сег');
    foreach ($rows as $r) {
        $lines .= sprintf("%-14s %5d %5d %5d\n",
            mb_substr($r['src'], 0, 14), $r['total'], $r['week'], $r['today']);
    }
    return "🔥 <b>Источники трафика</b>\n<pre>{$lines}</pre>";
}

function rpt_online(): string {
    $db   = getDB();
    $rows = $db->query(
        "SELECT page_url, device_type, city, session_id FROM visits
         WHERE created_at >= datetime('now','-5 minutes')
         GROUP BY session_id ORDER BY created_at DESC"
    )->fetchAll();

    $count = count($rows);
    if (!$count) {
        return "🟢 <b>Онлайн</b>\n\nАктивных сессий за последние 5 минут нет.";
    }

    $m = "🟢 <b>Онлайн прямо сейчас: {$count}</b>\n━━━━━━━━━━━━━━━━━━\n";
    foreach ($rows as $r) {
        $loc = $r['city'] ? " | {$r['city']}" : '';
        $m  .= "📱 {$r['device_type']}{$loc}\n";
        $m  .= "📄 " . htmlspecialchars($r['page_url']) . "\n\n";
    }
    return rtrim($m);
}

function rpt_settings(): string {
    $db = getDB();

    $visits  = (int)$db->query("SELECT COUNT(*) FROM visits")->fetchColumn();
    $events  = (int)$db->query("SELECT COUNT(*) FROM events")->fetchColumn();
    $leads   = (int)$db->query("SELECT COUNT(*) FROM leads")->fetchColumn();
    $oldest  = $db->query("SELECT MIN(created_at) FROM visits")->fetchColumn();

    $m  = "⚙️ <b>Настройки и статус</b>\n━━━━━━━━━━━━━━━━━━\n";
    $m .= "🌐 Домен: " . SITE_DOMAIN . "\n";
    $m .= "⏰ Часовой пояс: " . TIMEZONE . "\n";
    $m .= "🔔 Уведомления о визитах: " . (NOTIFY_NEW_VISITS ? '✅' : '❌') . "\n";
    $m .= "🔔 Уведомления о кликах: "  . (NOTIFY_IMPORTANT_EVENTS ? '✅' : '❌') . "\n";
    $m .= "\n📊 <b>База данных:</b>\n";
    $m .= "  Визиты:  {$visits}\n";
    $m .= "  События: {$events}\n";
    $m .= "  Заявки:  {$leads}\n";
    if ($oldest) $m .= "  Данные с: " . date('d.m.Y', strtotime($oldest)) . "\n";
    $m .= "\nНажми кнопку ниже, чтобы удалить записи старше 90 дней:";

    return $m;
}

function clean_old_logs(): string {
    $db     = getDB();
    $cutoff = date('Y-m-d', strtotime('-90 days'));

    $v = $db->exec("DELETE FROM visits    WHERE created_at < '{$cutoff}'");
    $e = $db->exec("DELETE FROM events    WHERE created_at < '{$cutoff}'");
    $g = $db->exec("DELETE FROM geo_cache WHERE cached_at  < '{$cutoff}'");
    $db->exec('VACUUM');

    return "✅ Удалено: {$v} визитов, {$e} событий, {$g} кешей геолокации (старше 90 дней).";
}
