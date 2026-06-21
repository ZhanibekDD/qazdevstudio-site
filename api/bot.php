<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/report.php';

// Security: verify BOT_TOKEN and ADMIN_TELEGRAM_ID are configured
if (!defined('BOT_TOKEN') || BOT_TOKEN === 'ВСТАВЬ_ТОКЕН_БОТА'
    || !defined('ADMIN_TELEGRAM_ID') || ADMIN_TELEGRAM_ID === 'ВСТАВЬ_СВОЙ_TELEGRAM_ID'
) {
    http_response_code(403);
    exit;
}

// Validate Telegram signature via secret_token is optional —
// here we rely on the webhook URL being secret enough.
// Parse update
$input  = file_get_contents('php://input');
$update = json_decode($input, true);
if (!is_array($update)) exit;

$message  = $update['message']        ?? null;
$callback = $update['callback_query'] ?? null;

$chatId       = (string)($message['chat']['id']             ?? $callback['message']['chat']['id'] ?? '');
$userId       = (string)($message['from']['id']             ?? $callback['from']['id']            ?? '');
$text         = (string)($message['text']                   ?? '');
$callbackData = (string)($callback['data']                  ?? '');
$callbackId   = (string)($callback['id']                    ?? '');
$msgId        = (int)($callback['message']['message_id']    ?? 0);

if (!$chatId || !$userId) exit;

// ============================
// Access check
// ============================
if ($userId !== (string)ADMIN_TELEGRAM_ID) {
    botSend($chatId, "🔒 Доступ закрыт.");
    exit;
}

/* ============================
   Telegram API helpers
   ============================ */

function botRequest(string $method, array $params): void {
    $ctx = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => 'Content-Type: application/json',
            'content'       => json_encode($params, JSON_UNESCAPED_UNICODE),
            'timeout'       => 10,
            'ignore_errors' => true,
        ]
    ]);
    @file_get_contents('https://api.telegram.org/bot' . BOT_TOKEN . '/' . $method, false, $ctx);
}

function botSend(string $chatId, string $text, array $extra = []): void {
    botRequest('sendMessage', array_merge([
        'chat_id'    => $chatId,
        'text'       => mb_substr($text, 0, 4096),
        'parse_mode' => 'HTML',
    ], $extra));
}

function botEdit(string $chatId, int $msgId, string $text, array $extra = []): void {
    botRequest('editMessageText', array_merge([
        'chat_id'    => $chatId,
        'message_id' => $msgId,
        'text'       => mb_substr($text, 0, 4096),
        'parse_mode' => 'HTML',
    ], $extra));
}

function botAnswerCb(string $id, string $text = ''): void {
    botRequest('answerCallbackQuery', ['callback_query_id' => $id, 'text' => $text]);
}

function mainKeyboard(): array {
    return [
        'keyboard' => [
            ['📊 Сегодня',  '📈 7 дней',   '🟢 Онлайн'],
            ['👥 Посетители','📄 Страницы', '🔥 Источники'],
            ['💬 WhatsApp',  '✈️ Telegram', '📞 Телефон'],
            ['📝 Заявки',   '⚙️ Настройки'],
        ],
        'resize_keyboard' => true,
        'persistent'      => true,
    ];
}

/* ============================
   Handle callback queries (inline buttons)
   ============================ */
if ($callback) {
    botAnswerCb($callbackId);

    if ($callbackData === 'confirm_clean') {
        try {
            botEdit($chatId, $msgId, clean_old_logs());
        } catch (Exception $e) {
            botEdit($chatId, $msgId, "❌ Ошибка: " . $e->getMessage());
        }
    } elseif ($callbackData === 'cancel_clean') {
        botEdit($chatId, $msgId, "❌ Очистка отменена.");
    }
    exit;
}

/* ============================
   Handle text messages
   ============================ */
try {
    $kb = ['reply_markup' => mainKeyboard()];

    switch (true) {
        case in_array($text, ['/start', '/menu', '']):
            botSend($chatId,
                "👋 <b>QazDev Analytics</b>\n\nВыбери отчёт из меню ниже:",
                $kb
            );
            break;

        case $text === '📊 Сегодня':
            botSend($chatId, rpt_today(), $kb);
            break;

        case $text === '📈 7 дней':
            botSend($chatId, rpt_7days(), $kb);
            break;

        case $text === '🟢 Онлайн':
            botSend($chatId, rpt_online(), $kb);
            break;

        case $text === '👥 Посетители':
            botSend($chatId, rpt_visitors(10), $kb);
            break;

        case $text === '📄 Страницы':
            botSend($chatId, rpt_pages(), $kb);
            break;

        case $text === '🔥 Источники':
            botSend($chatId, rpt_sources(), $kb);
            break;

        case $text === '💬 WhatsApp':
            botSend($chatId, rpt_contact('whatsapp_click', '💬', 'WhatsApp клики'), $kb);
            break;

        case $text === '✈️ Telegram':
            botSend($chatId, rpt_contact('telegram_click', '✈️', 'Telegram клики'), $kb);
            break;

        case $text === '📞 Телефон':
            botSend($chatId, rpt_contact('phone_click', '📞', 'Звонки (телефон)'), $kb);
            break;

        case $text === '📝 Заявки':
            botSend($chatId, rpt_leads(10), $kb);
            break;

        case $text === '⚙️ Настройки':
            $inline = ['inline_keyboard' => [[
                ['text' => '🗑 Очистить логи старше 90 дней', 'callback_data' => 'confirm_clean'],
            ]]];
            // Send settings with inline keyboard (cleanup action).
            // The persistent reply keyboard is already shown from previous messages.
            botSend($chatId, rpt_settings(), ['reply_markup' => $inline]);
            break;

        default:
            botSend($chatId, "Выбери пункт из меню:", $kb);
    }
} catch (Exception $e) {
    botSend($chatId, "❌ Ошибка при получении данных: " . $e->getMessage());
}
