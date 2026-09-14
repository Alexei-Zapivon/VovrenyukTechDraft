<?php
/**
 * API отзывов.
 *   GET  /api/reviews.php?offset=N      — опубликованные отзывы постранично + токен формы
 *   GET  /api/reviews.php?action=token  — новый токен формы
 *   POST /api/reviews.php               — новый отзыв (уходит в очередь на модерацию)
 */
declare(strict_types=1);

require __DIR__ . '/lib.php';

vtd_api_headers();
$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');

if ($method === 'OPTIONS') {
    // CORS-заголовки намеренно не отдаём: кросс-доменные запросы браузер отклонит сам.
    http_response_code(204);
    exit;
}

vtd_migrate_legacy();

if ($method === 'GET') {
    if ((string) ($_GET['action'] ?? '') === 'token') {
        vtd_json(200, ['ok' => true, 'token' => vtd_token_issue()]);
    }

    $all    = array_reverse(vtd_reviews_public(vtd_read('reviews'))); // новые сверху
    $total  = count($all);
    $limit  = 9;
    $offset = max(0, min((int) ($_GET['offset'] ?? 0), $total));
    $avg    = $total > 0 ? round(array_sum(array_column($all, 'stars')) / $total, 1) : 0;

    vtd_json(200, [
        'ok'        => true,
        'reviews'   => array_slice($all, $offset, $limit),
        'total'     => $total,
        'offset'    => $offset,
        'limit'     => $limit,
        'avg_stars' => $avg,
        'token'     => vtd_token_issue(),
    ]);
}

if ($method !== 'POST') {
    vtd_reject(405, 'method_not_allowed');
}

// Запрос должен прийти со страницы нашего сайта и из нашего скрипта.
// Кастомный заголовок заставляет чужие сайты делать preflight, который без CORS не пройдёт.
if (!vtd_same_origin() || (string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') {
    vtd_reject(403, 'forbidden', 'Запрос отклонён');
}

$raw = file_get_contents('php://input', false, null, 0, VTD_BODY_MAX + 1);
if ($raw === false || strlen($raw) > VTD_BODY_MAX) {
    vtd_reject(413, 'too_large', 'Слишком большой запрос');
}
$input = json_decode($raw, true);
if (!is_array($input)) {
    vtd_reject(400, 'invalid', 'Неверный формат');
}

// Honeypot: боту отвечаем «успех», ничего не сохраняя.
if (!empty($input['website'])) {
    vtd_json(200, ['ok' => true, 'pending' => true]);
}

// Токен формы: подписан секретом сервера, живёт 2 часа, отправка раньше 3 секунд отклоняется.
$age = vtd_token_age((string) ($input['token'] ?? ''));
if ($age === null) {
    vtd_reject(400, 'token_invalid', 'Обновите страницу и попробуйте снова');
}
if ($age < VTD_TOKEN_MIN) {
    vtd_reject(400, 'timing', 'Слишком быстро, попробуйте ещё раз');
}
if ($age > VTD_TOKEN_MAX) {
    vtd_reject(400, 'expired', 'Форма устарела, обновите страницу');
}

$name   = vtd_clean_text((string) ($input['name'] ?? ''), false);
$text   = vtd_clean_text((string) ($input['text'] ?? ''), true);
$stars  = (int) ($input['stars'] ?? 0);
$avatar = vtd_valid_avatar(trim((string) ($input['avatar'] ?? '')));

$nameLen = mb_strlen($name);
$textLen = mb_strlen($text);

if ($nameLen < VTD_NAME_MIN || !preg_match('/\p{L}/u', $name)) {
    vtd_reject(400, 'name', 'Укажите имя');
}
if ($nameLen > VTD_NAME_MAX) {
    vtd_reject(400, 'name_long', 'Имя длиннее ' . VTD_NAME_MAX . ' символов');
}
if ($stars < 1 || $stars > 5) {
    vtd_reject(400, 'stars', 'Выберите оценку');
}
if ($textLen < VTD_TEXT_MIN) {
    vtd_reject(400, 'text', 'Отзыв слишком короткий, минимум ' . VTD_TEXT_MIN . ' символов');
}
if ($textLen > VTD_TEXT_MAX) {
    vtd_reject(400, 'text_long', 'Отзыв длиннее ' . VTD_TEXT_MAX . ' символов');
}
if (vtd_has_link($name) || vtd_has_link($text)) {
    vtd_reject(400, 'no_links', 'Ссылки в отзывах запрещены');
}

$ipHash = vtd_ip_hash();
$now    = time();

$result = vtd_locked(function () use ($ipHash, $now, $name, $text, $stars, $avatar): array {
    $rate = array_filter(
        vtd_read('rate_limit'),
        static fn($ts) => is_int($ts) && ($now - $ts) < VTD_RATE_WINDOW
    );
    if (isset($rate[$ipHash])) {
        return [429, 'rate_limit', 'Отзыв можно оставить раз в сутки'];
    }

    $reviews = vtd_read('reviews');
    $pending = 0;
    $recent  = 0;
    foreach ($reviews as $r) {
        if (empty($r['approved'])) {
            $pending++;
        }
        if ((int) ($r['ts'] ?? 0) > $now - 3600) {
            $recent++;
        }
    }
    if ($pending >= VTD_PENDING_MAX || $recent >= VTD_HOURLY_MAX) {
        return [503, 'busy', 'Слишком много отзывов, попробуйте позже'];
    }

    $reviews[] = [
        'id'       => bin2hex(random_bytes(8)),
        'name'     => $name,
        'stars'    => $stars,
        'text'     => $text,
        'avatar'   => $avatar,
        'date'     => date('d.m.Y', $now),
        'ts'       => $now,
        'approved' => false,
    ];
    if (!vtd_write('reviews', $reviews)) {
        return [500, 'storage', 'Не удалось сохранить отзыв, попробуйте позже'];
    }

    $rate[$ipHash] = $now;
    vtd_write('rate_limit', $rate);
    return [200, '', ''];
});

if ($result[0] !== 200) {
    vtd_reject($result[0], $result[1], $result[2]);
}

vtd_json(200, ['ok' => true, 'pending' => true, 'message' => 'Спасибо! Отзыв появится на сайте после проверки']);
