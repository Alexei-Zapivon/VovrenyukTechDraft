<?php
/**
 * Общий код для API отзывов (api/reviews.php) и админки (admin/index.php).
 *
 * Хранилище: JSON-файлы в папке данных. Каждый файл начинается со строки
 * «<?php http_response_code(404); exit; ?>», поэтому даже при прямом запросе
 * через веб-сервер он выполняется как PHP и ничего не отдаёт.
 *
 * Папка данных выбирается так (см. vtd_data_dir):
 *   1. константа VTD_DATA_DIR из api/config.php, если задана;
 *   2. папка «vtd-data» рядом с папкой сайта (вне webroot), если она существует и доступна на запись;
 *   3. иначе — <webroot>/data.
 */
declare(strict_types=1);

if (is_file(__DIR__ . '/config.php')) {
    require_once __DIR__ . '/config.php';
}

date_default_timezone_set(defined('VTD_TIMEZONE') ? VTD_TIMEZONE : 'Europe/Moscow');

const VTD_GUARD        = "<?php http_response_code(404); exit; ?>\n";
const VTD_NAME_MIN     = 2;
const VTD_NAME_MAX     = 60;
const VTD_TEXT_MIN     = 10;
const VTD_TEXT_MAX     = 1000;
const VTD_TOKEN_MIN    = 3;      // секунд с момента выдачи токена до отправки формы
const VTD_TOKEN_MAX    = 7200;   // срок жизни токена формы
const VTD_RATE_WINDOW  = 86400;  // один отзыв с IP в сутки
const VTD_PENDING_MAX  = 200;    // предел очереди на модерацию
const VTD_HOURLY_MAX   = 30;     // предел новых отзывов в час со всех IP
const VTD_BODY_MAX     = 16384;  // байт в теле POST-запроса

/* ---------- пути ---------- */

function vtd_webroot(): string
{
    return dirname(__DIR__);
}

function vtd_data_dir(): string
{
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    if (defined('VTD_DATA_DIR') && VTD_DATA_DIR !== '') {
        $dir = rtrim(VTD_DATA_DIR, '/');
    } else {
        $outside = dirname(vtd_webroot()) . '/vtd-data';
        $dir = (is_dir($outside) && is_writable($outside)) ? $outside : vtd_webroot() . '/data';
    }
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }
    return $dir;
}

function vtd_data_outside_webroot(): bool
{
    $data = realpath(vtd_data_dir());
    $root = realpath(vtd_webroot());
    if ($data === false || $root === false) {
        return false;
    }
    return strpos($data . DIRECTORY_SEPARATOR, $root . DIRECTORY_SEPARATOR) !== 0;
}

function vtd_path(string $name): string
{
    return vtd_data_dir() . '/' . $name . '.json.php';
}

/* ---------- хранилище ---------- */

function vtd_read(string $name, array $default = []): array
{
    $file = vtd_path($name);
    if (!is_file($file)) {
        return $default;
    }
    $raw = file_get_contents($file);
    if ($raw === false) {
        return $default;
    }
    if (strncmp($raw, '<?php', 5) === 0) {
        $nl  = strpos($raw, "\n");
        $raw = $nl === false ? '' : substr($raw, $nl + 1);
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : $default;
}

function vtd_write(string $name, array $data): bool
{
    $file = vtd_path($name);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if ($json === false) {
        return false;
    }
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (file_put_contents($tmp, VTD_GUARD . $json . "\n") === false) {
        @unlink($tmp);
        return false;
    }
    @chmod($tmp, 0640);
    if (!rename($tmp, $file)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

/**
 * Выполняет $fn под эксклюзивной блокировкой. Внутри можно свободно
 * вызывать vtd_read / vtd_write — цикл «прочитал → изменил → записал»
 * не пересечётся с другим запросом.
 */
function vtd_locked(callable $fn)
{
    $lockFile = vtd_data_dir() . '/.lock';
    $h = @fopen($lockFile, 'c');
    if ($h === false) {
        return $fn();
    }
    $locked = flock($h, LOCK_EX);
    try {
        return $fn();
    } finally {
        if ($locked) {
            flock($h, LOCK_UN);
        }
        fclose($h);
    }
}

/* ---------- секрет ---------- */

function vtd_secret(): string
{
    static $secret = null;
    if ($secret !== null) {
        return $secret;
    }
    if (defined('VTD_SECRET') && strlen((string) VTD_SECRET) >= 16) {
        return $secret = (string) VTD_SECRET;
    }
    $secret = vtd_locked(function (): string {
        $store = vtd_read('secret');
        if (!empty($store['key']) && is_string($store['key']) && strlen($store['key']) >= 32) {
            return $store['key'];
        }
        $key = bin2hex(random_bytes(32));
        vtd_write('secret', ['key' => $key, 'created' => time()]);
        return $key;
    });
    return $secret;
}

function vtd_secret_source(): string
{
    return (defined('VTD_SECRET') && strlen((string) VTD_SECRET) >= 16) ? 'config' : 'auto';
}

/* ---------- клиент ---------- */

function vtd_trusted_proxies(): array
{
    return defined('VTD_TRUSTED_PROXIES') && is_array(VTD_TRUSTED_PROXIES)
        ? VTD_TRUSTED_PROXIES
        : ['127.0.0.1', '::1'];
}

/**
 * IP клиента. Заголовкам X-Forwarded-For / X-Real-IP верим только если запрос
 * пришёл с доверенного прокси (по умолчанию — локальный nginx перед Apache).
 * Из X-Forwarded-For берётся последний адрес: его дописал прокси, подделать
 * его снаружи нельзя.
 */
function vtd_client_ip(): string
{
    $remote = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    if ($remote !== '' && in_array($remote, vtd_trusted_proxies(), true)) {
        $xff = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
        if ($xff !== '') {
            $parts = array_map('trim', explode(',', $xff));
            for ($i = count($parts) - 1; $i >= 0; $i--) {
                if (filter_var($parts[$i], FILTER_VALIDATE_IP)) {
                    return $parts[$i];
                }
            }
        }
        $real = trim((string) ($_SERVER['HTTP_X_REAL_IP'] ?? ''));
        if ($real !== '' && filter_var($real, FILTER_VALIDATE_IP)) {
            return $real;
        }
    }
    return $remote !== '' ? $remote : 'unknown';
}

function vtd_ip_hash(): string
{
    return hash('sha256', vtd_secret() . '|ip|' . vtd_client_ip());
}

function vtd_is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') {
        return true;
    }
    return (string) ($_SERVER['SERVER_PORT'] ?? '') === '443';
}

function vtd_allowed_hosts(): array
{
    $hosts = defined('VTD_ALLOWED_HOSTS') && is_array(VTD_ALLOWED_HOSTS)
        ? VTD_ALLOWED_HOSTS
        : ['vovrenyuk.ru', 'www.vovrenyuk.ru'];
    $self = strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? '')));
    $self = preg_replace('/:\d+$/', '', $self);
    if ($self !== '') {
        $hosts[] = $self;
    }
    return array_values(array_unique(array_map('strtolower', $hosts)));
}

/**
 * Проверка, что запрос пришёл со страницы нашего сайта.
 * Берём Origin (браузер всегда шлёт его для POST), при отсутствии — Referer.
 * Сравнивается именно хост, а не подстрока, так что «vovrenyuk.ru.evil.com» не пройдёт.
 */
function vtd_same_origin(): bool
{
    $src = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($src === '' || $src === 'null') {
        $src = (string) ($_SERVER['HTTP_REFERER'] ?? '');
    }
    if ($src === '' || $src === 'null') {
        return false;
    }
    $host = strtolower((string) parse_url($src, PHP_URL_HOST));
    return $host !== '' && in_array($host, vtd_allowed_hosts(), true);
}

/* ---------- токен формы (защита от CSRF и от мгновенной отправки ботами) ---------- */

function vtd_token_issue(): string
{
    $ts = (string) time();
    return $ts . '.' . hash_hmac('sha256', 'form|' . $ts, vtd_secret());
}

/** Возвращает возраст токена в секундах или null, если подпись неверна. */
function vtd_token_age(string $token): ?int
{
    $parts = explode('.', $token, 2);
    if (count($parts) !== 2 || !ctype_digit($parts[0]) || $parts[1] === '') {
        return null;
    }
    $expected = hash_hmac('sha256', 'form|' . $parts[0], vtd_secret());
    if (!hash_equals($expected, $parts[1])) {
        return null;
    }
    return time() - (int) $parts[0];
}

/* ---------- очистка и проверка текста ---------- */

function vtd_clean_text(string $s, bool $multiline): string
{
    if (!mb_check_encoding($s, 'UTF-8')) {
        return '';
    }
    $s = str_replace(["\r\n", "\r"], "\n", $s);
    $s = $multiline
        ? preg_replace('/[^\P{C}\n]+/u', '', $s)
        : preg_replace('/\p{C}+/u', ' ', $s);
    $s = preg_replace('/[ \t\x{00A0}]+/u', ' ', $s);
    if ($multiline) {
        $s = preg_replace('/ *\n */', "\n", $s);
        $s = preg_replace('/\n{3,}/', "\n\n", $s);
    }
    return trim((string) $s);
}

function vtd_has_link(string $s): bool
{
    return (bool) preg_match('~(https?:)?//|www\.|\bt\.me/|\bwa\.me/~iu', $s);
}

function vtd_valid_avatar(string $s): string
{
    return preg_match('/^avatar(0[1-9]|1[0-9]|20)\.png$/', $s) ? $s : '';
}

/* ---------- отзывы ---------- */

/** Одноразовый импорт из старого data/reviews.json (там отзывы хранились уже опубликованными и HTML-экранированными). */
function vtd_migrate_legacy(): void
{
    if (is_file(vtd_path('reviews'))) {
        return;
    }
    $legacy = vtd_webroot() . '/data/reviews.json';
    if (!is_file($legacy)) {
        return;
    }
    vtd_locked(function () use ($legacy): void {
        if (is_file(vtd_path('reviews'))) {
            return;
        }
        $old = json_decode((string) file_get_contents($legacy), true);
        $new = [];
        foreach (is_array($old) ? $old : [] as $r) {
            if (!is_array($r)) {
                continue;
            }
            $new[] = [
                'id'       => is_string($r['id'] ?? null) && $r['id'] !== '' ? $r['id'] : bin2hex(random_bytes(8)),
                'name'     => html_entity_decode((string) ($r['name'] ?? ''), ENT_QUOTES, 'UTF-8'),
                'stars'    => max(1, min(5, (int) ($r['stars'] ?? 5))),
                'text'     => html_entity_decode((string) ($r['text'] ?? ''), ENT_QUOTES, 'UTF-8'),
                'avatar'   => vtd_valid_avatar((string) ($r['avatar'] ?? '')),
                'date'     => (string) ($r['date'] ?? date('d.m.Y')),
                // у старых записей нет метки времени: берём её из даты «дд.мм.гггг», чтобы порядок остался хронологическим
                'ts'       => (int) ($r['ts'] ?? (vtd_legacy_ts((string) ($r['date'] ?? '')) ?: time())),
                'approved' => true,
            ];
        }
        vtd_write('reviews', $new);
    });
}

function vtd_legacy_ts(string $date): int
{
    if (!preg_match('/^(\d{2})\.(\d{2})\.(\d{4})$/', $date, $m)) {
        return 0;
    }
    $ts = mktime(12, 0, 0, (int) $m[2], (int) $m[1], (int) $m[3]);
    return $ts === false ? 0 : $ts;
}

function vtd_reviews_public(array $all): array
{
    $out = [];
    foreach ($all as $r) {
        if (!empty($r['approved'])) {
            $out[] = [
                'id'     => (string) $r['id'],
                'name'   => (string) $r['name'],
                'stars'  => (int) $r['stars'],
                'text'   => (string) $r['text'],
                'avatar' => (string) ($r['avatar'] ?? ''),
                'date'   => (string) $r['date'],
            ];
        }
    }
    return $out;
}

/* ---------- ответы ---------- */

function vtd_api_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');
    header('Referrer-Policy: same-origin');
    header('X-Robots-Tag: noindex');
}

function vtd_json(int $code, array $payload): void
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function vtd_reject(int $code, string $error, string $message = ''): void
{
    vtd_json($code, ['ok' => false, 'error' => $error, 'message' => $message]);
}
