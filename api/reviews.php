<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

$reviewsFile   = __DIR__ . '/../data/reviews.json';
$rateLimitFile = __DIR__ . '/../data/rate_limit.json';
$salt          = 'vtd_2026_secret';
$allowedDomain = 'vovrenyuk.ru';

function readJson($file) {
    if (!file_exists($file)) return [];
    $data = json_decode(file_get_contents($file), true);
    return is_array($data) ? $data : [];
}

function writeJson($file, $data) {
    file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
}

function getIpHash($salt) {
    $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $ip = trim(explode(',', $ip)[0]);
    return hash('sha256', $salt . $ip);
}

function reject($code, $error, $message = '') {
    http_response_code($code);
    echo json_encode(['error' => $error, 'message' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

// GET — вернуть отзывы с пагинацией
if ($method === 'GET') {
    $reviews  = array_reverse(readJson($reviewsFile));
    $total    = count($reviews);
    $limit    = 9;
    $offset   = max(0, (int)($_GET['offset'] ?? 0));
    $page     = array_slice($reviews, $offset, $limit);
    echo json_encode([
        'reviews' => $page,
        'total'   => $total,
        'offset'  => $offset,
        'limit'   => $limit,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// POST — добавить отзыв
if ($method === 'POST') {

    // Проверка Referer — запрос должен идти с нашего сайта
    $referer = $_SERVER['HTTP_REFERER'] ?? '';
    if (!empty($referer) && strpos($referer, $allowedDomain) === false) {
        reject(403, 'forbidden', 'Запрос отклонён');
    }

    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        reject(400, 'invalid', 'Неверный формат');
    }

    // Honeypot — боты заполняют скрытое поле
    if (!empty($input['website'])) {
        reject(400, 'spam');
    }

    // Проверка времени — форма должна быть открыта минимум 3 секунды
    $loadedAt = (int)($input['loadedAt'] ?? 0);
    $elapsed  = time() - intdiv($loadedAt, 1000);
    if ($loadedAt === 0 || $elapsed < 3 || $elapsed > 7200) {
        reject(400, 'timing', 'Отправка слишком быстрая или токен устарел');
    }

    // Фильтр ссылок в тексте
    $text = trim($input['text'] ?? '');
    if (preg_match('/(https?:\/\/|www\.)/i', $text)) {
        reject(400, 'no_links', 'Ссылки в отзывах запрещены');
    }

    // Валидация полей
    $name  = trim($input['name'] ?? '');
    $stars = (int)($input['stars'] ?? 0);

    if (empty($name) || $stars < 1 || $stars > 5 || empty($text)) {
        reject(400, 'invalid', 'Заполните все поля');
    }

    // Валидация аватарки — только разрешённые файлы
    $avatar = '';
    $rawAvatar = trim($input['avatar'] ?? '');
    if ($rawAvatar !== '') {
        if (preg_match('/^avatar(0[1-9]|1[0-9]|20)\.png$/', $rawAvatar)) {
            $avatar = $rawAvatar;
        }
    }

    // Лимит по IP — 1 отзыв в 24 часа
    $hash      = getIpHash($salt);
    $rateLimit = readJson($rateLimitFile);
    $now       = time();

    $rateLimit = array_filter($rateLimit, fn($ts) => ($now - $ts) < 86400);

    if (isset($rateLimit[$hash])) {
        reject(429, 'rate_limit', 'Отзыв можно оставить раз в 24 часа');
    }

    $rateLimit[$hash] = $now;
    writeJson($rateLimitFile, $rateLimit);

    // Сохраняем отзыв
    $reviews   = readJson($reviewsFile);
    $reviews[] = [
        'id'     => uniqid('r_', true),
        'name'   => htmlspecialchars($name, ENT_QUOTES, 'UTF-8'),
        'stars'  => $stars,
        'text'   => htmlspecialchars($text, ENT_QUOTES, 'UTF-8'),
        'avatar' => $avatar,
        'date'   => date('d.m.Y'),
    ];
    writeJson($reviewsFile, $reviews);

    echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'method_not_allowed']);
