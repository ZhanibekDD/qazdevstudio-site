<?php
if (defined('_QD_CONFIG')) return;
define('_QD_CONFIG', true);

// ============================
// REQUIRED — заполни перед использованием
// ============================
define('BOT_TOKEN',         'ВСТАВЬ_ТОКЕН_БОТА');       // Получить у @BotFather в Telegram
define('ADMIN_TELEGRAM_ID', 'ВСТАВЬ_СВОЙ_TELEGRAM_ID'); // Получить у @userinfobot в Telegram

// ============================
// Настройки сайта
// ============================
define('SITE_DOMAIN',  'qazdevstudio.kz');
define('SITE_URL',     'https://qazdevstudio.kz');
define('WA_NUMBER',    '77000300024');
define('TG_USERNAME',  'QazDevStudio');
define('TIMEZONE',     'Asia/Almaty');

// ============================
// Уведомления в Telegram
// ============================
define('NOTIFY_NEW_VISITS',       true);  // Уведомлять о каждом новом посетителе
define('NOTIFY_IMPORTANT_EVENTS', true);  // Уведомлять о кликах по контактам и заявках

// ============================
// База данных
// ============================
define('DB_PATH',         __DIR__ . '/qazdev_analytics.sqlite');
define('GEO_CACHE_HOURS', 24);

date_default_timezone_set(TIMEZONE);
