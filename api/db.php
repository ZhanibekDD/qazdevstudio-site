<?php
require_once __DIR__ . '/config.php';

function getDB(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    if (!file_exists(DB_PATH)) {
        throw new RuntimeException('База данных не создана. Запустите /api/install.php');
    }

    $pdo = new PDO('sqlite:' . DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode=WAL');
    $pdo->exec('PRAGMA foreign_keys=ON');
    $pdo->exec('PRAGMA synchronous=NORMAL');

    return $pdo;
}
