<?php
// Run once to create the database and tables.
// Delete this file after installation.
header('Content-Type: text/plain; charset=utf-8');

require_once __DIR__ . '/config.php';

$exists = file_exists(DB_PATH);

try {
    $pdo = new PDO('sqlite:' . DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('PRAGMA journal_mode=WAL');

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS visits (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            visitor_id   TEXT NOT NULL,
            session_id   TEXT NOT NULL,
            ip           TEXT,
            user_agent   TEXT,
            device_type  TEXT,
            browser      TEXT,
            os           TEXT,
            page_url     TEXT,
            page_title   TEXT,
            referrer     TEXT,
            utm_source   TEXT,
            utm_medium   TEXT,
            utm_campaign TEXT,
            country      TEXT,
            city         TEXT,
            created_at   TEXT NOT NULL
        )
    ");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_visits_session ON visits(session_id)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_visits_visitor ON visits(visitor_id)');

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            visitor_id  TEXT NOT NULL,
            session_id  TEXT NOT NULL,
            event_type  TEXT NOT NULL,
            event_label TEXT,
            page_url    TEXT,
            extra_json  TEXT,
            created_at  TEXT NOT NULL
        )
    ");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)');

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS leads (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            visitor_id TEXT,
            session_id TEXT,
            name       TEXT,
            phone      TEXT,
            city       TEXT,
            service    TEXT,
            comment    TEXT,
            page_url   TEXT,
            created_at TEXT NOT NULL
        )
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS geo_cache (
            ip         TEXT PRIMARY KEY,
            country    TEXT,
            city       TEXT,
            cached_at  TEXT NOT NULL
        )
    ");

    $prefix = $exists ? '✅ Таблицы проверены / обновлены.' : '✅ База данных создана успешно.';
    echo $prefix . "\n\n";
    echo "⚠️  ВАЖНО: Удали этот файл после установки!\n";
    echo "   rm /home/qazdevstudio.kz/public_html/api/install.php\n\n";
    echo "📋 Следующие шаги:\n";
    echo "1. Создай бота у @BotFather → получи BOT_TOKEN\n";
    echo "2. Узнай свой Telegram ID у @userinfobot\n";
    echo "3. Заполни /api/config.php (BOT_TOKEN и ADMIN_TELEGRAM_ID)\n";
    echo "4. Установи webhook одним GET-запросом в браузере:\n";
    echo "   https://api.telegram.org/bot{ВАШ_ТОКЕН}/setWebhook?url=https://qazdevstudio.kz/api/bot.php\n";
    echo "5. Напиши своему боту /start\n";

} catch (Exception $e) {
    echo '❌ Ошибка: ' . $e->getMessage() . "\n";
}
