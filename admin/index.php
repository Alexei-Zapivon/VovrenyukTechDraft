<?php
/**
 * Админка отзывов: модерация (одобрить / скрыть / удалить), смена пароля, диагностика сервера.
 * Вход по паролю, сессия в cookie (HttpOnly, SameSite=Strict). После 5 неверных попыток
 * вход с этого IP блокируется на 15 минут. Папку admin/ можно переименовать во что угодно.
 */
declare(strict_types=1);

require dirname(__DIR__) . '/api/lib.php';

const ADM_LOCK_AFTER = 5;      // неверных попыток до блокировки
const ADM_LOCK_FOR   = 900;    // секунд блокировки
const ADM_IDLE       = 7200;   // выход при бездействии
const ADM_ABSOLUTE   = 43200;  // максимальная длина сессии
const ADM_PASS_MIN   = 10;

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex, nofollow');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");

$basePath = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/admin/index.php'))), '/') . '/';

session_name('vtdadmin');
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => $basePath,
    'secure'   => vtd_is_https(),
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

vtd_migrate_legacy();

/* ---------- helpers ---------- */

function h($s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function adm_hash_in_config(): bool
{
    return defined('VTD_ADMIN_PASSWORD_HASH') && (string) VTD_ADMIN_PASSWORD_HASH !== '';
}

function adm_hash(): string
{
    if (adm_hash_in_config()) {
        return (string) VTD_ADMIN_PASSWORD_HASH;
    }
    $s = vtd_read('admin');
    return (string) ($s['hash'] ?? '');
}

function adm_flash(string $type, string $text): void
{
    $_SESSION['flash'] = ['type' => $type, 'text' => $text];
}

function adm_redirect(string $tab = ''): void
{
    global $basePath;
    header('Location: ' . $basePath . ($tab !== '' ? '?tab=' . rawurlencode($tab) : ''), true, 303);
    exit;
}

function adm_lock_state(string $ipHash): array
{
    $now = time();
    $all = vtd_read('admin_attempts');
    $e   = $all[$ipHash] ?? null;
    if (!is_array($e)) {
        return ['locked' => false, 'left' => ADM_LOCK_AFTER, 'until' => 0];
    }
    $until = (int) ($e['until'] ?? 0);
    if ($until > $now) {
        return ['locked' => true, 'left' => 0, 'until' => $until];
    }
    if ($now - (int) ($e['first'] ?? 0) > 3600) {
        return ['locked' => false, 'left' => ADM_LOCK_AFTER, 'until' => 0];
    }
    return ['locked' => false, 'left' => max(0, ADM_LOCK_AFTER - (int) ($e['n'] ?? 0)), 'until' => 0];
}

function adm_record_fail(string $ipHash): void
{
    vtd_locked(function () use ($ipHash): void {
        $now = time();
        $all = vtd_read('admin_attempts');
        foreach ($all as $k => $e) {
            if (!is_array($e) || ((int) ($e['until'] ?? 0) < $now && $now - (int) ($e['first'] ?? 0) > 3600)) {
                unset($all[$k]);
            }
        }
        $e = $all[$ipHash] ?? ['n' => 0, 'first' => $now, 'until' => 0];
        if ($now - (int) $e['first'] > 3600) {
            $e = ['n' => 0, 'first' => $now, 'until' => 0];
        }
        $e['n']++;
        if ($e['n'] >= ADM_LOCK_AFTER) {
            $e['until'] = $now + ADM_LOCK_FOR;
            $e['n']     = 0;
            $e['first'] = $now;
        }
        $all[$ipHash] = $e;
        vtd_write('admin_attempts', $all);
    });
}

function adm_clear_fails(string $ipHash): void
{
    vtd_locked(function () use ($ipHash): void {
        $all = vtd_read('admin_attempts');
        if (isset($all[$ipHash])) {
            unset($all[$ipHash]);
            vtd_write('admin_attempts', $all);
        }
    });
}

function adm_login_session(): void
{
    session_regenerate_id(true);
    $_SESSION['admin'] = true;
    $_SESSION['login'] = time();
    $_SESSION['seen']  = time();
    $_SESSION['csrf']  = bin2hex(random_bytes(16));
}

function adm_check_new_password(string $p1, string $p2): ?string
{
    if (mb_strlen($p1) < ADM_PASS_MIN) {
        return 'Пароль короче ' . ADM_PASS_MIN . ' символов';
    }
    if ($p1 !== $p2) {
        return 'Пароли не совпадают';
    }
    return null;
}

/* ---------- состояние сессии ---------- */

$now      = time();
$loggedIn = false;
if (!empty($_SESSION['admin'])) {
    if ($now - (int) ($_SESSION['seen'] ?? 0) > ADM_IDLE || $now - (int) ($_SESSION['login'] ?? 0) > ADM_ABSOLUTE) {
        $_SESSION = [];
        session_regenerate_id(true);
        adm_flash('error', 'Сессия истекла, войдите снова');
    } else {
        $_SESSION['seen'] = $now;
        $loggedIn = true;
    }
}
if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}

$ipHash = vtd_ip_hash();
$hash   = adm_hash();

/* ---------- действия ---------- */

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = (string) ($_POST['action'] ?? '');
    $back   = (string) ($_POST['back'] ?? '');

    if (!hash_equals((string) $_SESSION['csrf'], (string) ($_POST['csrf'] ?? ''))) {
        adm_flash('error', 'Форма устарела, повторите действие');
        adm_redirect($back);
    }

    if ($action === 'setup') {
        if ($hash !== '') {
            adm_flash('error', 'Пароль уже задан');
            adm_redirect();
        }
        $err = adm_check_new_password((string) ($_POST['p1'] ?? ''), (string) ($_POST['p2'] ?? ''));
        if ($err !== null) {
            adm_flash('error', $err);
            adm_redirect();
        }
        $p1 = (string) $_POST['p1'];
        $ok = vtd_locked(function () use ($p1): bool {
            $s = vtd_read('admin');
            if (!empty($s['hash'])) {
                return false;
            }
            return vtd_write('admin', ['hash' => password_hash($p1, PASSWORD_DEFAULT), 'updated' => time()]);
        });
        if (!$ok) {
            adm_flash('error', 'Не удалось сохранить пароль. Проверьте права на папку данных');
            adm_redirect();
        }
        adm_login_session();
        adm_flash('ok', 'Пароль сохранён. Вы вошли в админку');
        adm_redirect('pending');
    }

    if ($action === 'login') {
        $lock = adm_lock_state($ipHash);
        if ($lock['locked']) {
            adm_flash('error', 'Вход заблокирован до ' . date('H:i', $lock['until']));
            adm_redirect();
        }
        $pw = (string) ($_POST['password'] ?? '');
        if ($hash !== '' && $pw !== '' && password_verify($pw, $hash)) {
            adm_clear_fails($ipHash);
            adm_login_session();
            adm_redirect('pending');
        }
        adm_record_fail($ipHash);
        usleep(400000);
        $lock = adm_lock_state($ipHash);
        adm_flash('error', $lock['locked']
            ? 'Слишком много попыток. Вход заблокирован на 15 минут'
            : 'Неверный пароль. Осталось попыток: ' . $lock['left']);
        adm_redirect();
    }

    if ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        adm_redirect();
    }

    if (!$loggedIn) {
        adm_flash('error', 'Войдите в админку');
        adm_redirect();
    }

    if ($action === 'approve' || $action === 'hide' || $action === 'delete') {
        $id    = (string) ($_POST['id'] ?? '');
        $found = vtd_locked(function () use ($action, $id): bool {
            $reviews = vtd_read('reviews');
            $found   = false;
            foreach ($reviews as $i => $r) {
                if ((string) ($r['id'] ?? '') !== $id) {
                    continue;
                }
                $found = true;
                if ($action === 'delete') {
                    unset($reviews[$i]);
                } else {
                    $reviews[$i]['approved'] = ($action === 'approve');
                }
                break;
            }
            if ($found) {
                vtd_write('reviews', array_values($reviews));
            }
            return $found;
        });
        $labels = ['approve' => 'Отзыв опубликован', 'hide' => 'Отзыв скрыт', 'delete' => 'Отзыв удалён'];
        adm_flash($found ? 'ok' : 'error', $found ? $labels[$action] : 'Отзыв не найден');
        adm_redirect($back !== '' ? $back : 'pending');
    }

    if ($action === 'password') {
        if (adm_hash_in_config()) {
            adm_flash('error', 'Пароль задан в api/config.php, меняйте его там');
            adm_redirect('settings');
        }
        if (!password_verify((string) ($_POST['current'] ?? ''), $hash)) {
            adm_flash('error', 'Текущий пароль неверный');
            adm_redirect('settings');
        }
        $err = adm_check_new_password((string) ($_POST['p1'] ?? ''), (string) ($_POST['p2'] ?? ''));
        if ($err !== null) {
            adm_flash('error', $err);
            adm_redirect('settings');
        }
        $p1 = (string) $_POST['p1'];
        vtd_locked(function () use ($p1): void {
            vtd_write('admin', ['hash' => password_hash($p1, PASSWORD_DEFAULT), 'updated' => time()]);
        });
        adm_flash('ok', 'Пароль изменён');
        adm_redirect('settings');
    }

    adm_flash('error', 'Неизвестное действие');
    adm_redirect();
}

/* ---------- отображение ---------- */

$flash = $_SESSION['flash'] ?? null;
unset($_SESSION['flash']);
$csrf = (string) $_SESSION['csrf'];

$tab = (string) ($_GET['tab'] ?? 'pending');
if (!in_array($tab, ['pending', 'approved', 'diag', 'settings'], true)) {
    $tab = 'pending';
}

function render_head(string $title): void
{
    echo '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="robots" content="noindex, nofollow"><title>', h($title), '</title>',
        '<link rel="stylesheet" href="admin.css"></head><body><div class="wrap">';
}

function render_flash(?array $flash): void
{
    if ($flash) {
        echo '<p class="flash flash--', h($flash['type']), '">', h($flash['text']), '</p>';
    }
}

function render_foot(): void
{
    echo '</div></body></html>';
}

function render_stars(int $n): string
{
    $n = max(0, min(5, $n));
    return '<span class="stars" aria-label="' . $n . ' из 5">' . str_repeat('★', $n) . '<span class="stars__off">' . str_repeat('★', 5 - $n) . '</span></span>';
}

function render_review(array $r, string $tab, string $csrf): void
{
    $approved = !empty($r['approved']);
    echo '<article class="review">';
    echo '<div class="review__head">';
    if (!empty($r['avatar'])) {
        echo '<img class="review__avatar" src="/assets/img/avatar/', h($r['avatar']), '" alt="">';
    } else {
        echo '<span class="review__avatar review__avatar--none"></span>';
    }
    echo '<div class="review__meta"><strong>', h($r['name']), '</strong> ', render_stars((int) $r['stars']),
        '<div class="muted">', h($r['date']), ' · ', $approved ? 'опубликован' : 'ожидает проверки', '</div></div>';
    echo '</div>';
    echo '<p class="review__text">', nl2br(h($r['text'])), '</p>';
    echo '<form method="post" class="review__actions">',
        '<input type="hidden" name="csrf" value="', h($csrf), '">',
        '<input type="hidden" name="id" value="', h($r['id']), '">',
        '<input type="hidden" name="back" value="', h($tab), '">';
    if ($approved) {
        echo '<button class="btn" name="action" value="hide">Скрыть</button>';
    } else {
        echo '<button class="btn btn--primary" name="action" value="approve">Опубликовать</button>';
    }
    echo '<button class="btn btn--danger" name="action" value="delete">Удалить</button>';
    echo '</form></article>';
}

/* --- первый запуск: пароль ещё не задан --- */
if ($hash === '') {
    render_head('Админка · первый запуск');
    echo '<h1>Задайте пароль админки</h1>';
    echo '<p class="muted">Пароль ещё не установлен. Сделайте это сразу после загрузки сайта на сервер: пока пароль не задан, эту страницу видит любой, кто знает адрес.</p>';
    render_flash($flash);
    echo '<form method="post" class="form"><input type="hidden" name="csrf" value="', h($csrf), '"><input type="hidden" name="action" value="setup">',
        '<label>Пароль (минимум ', ADM_PASS_MIN, ' символов)<input type="password" name="p1" required minlength="', ADM_PASS_MIN, '" autocomplete="new-password"></label>',
        '<label>Ещё раз<input type="password" name="p2" required minlength="', ADM_PASS_MIN, '" autocomplete="new-password"></label>',
        '<button class="btn btn--primary">Сохранить и войти</button></form>';
    echo '<p class="muted small">Альтернатива: задать хеш пароля константой VTD_ADMIN_PASSWORD_HASH в api/config.php, см. api/config.example.php.</p>';
    render_foot();
    exit;
}

/* --- вход --- */
if (!$loggedIn) {
    $lock = adm_lock_state($ipHash);
    render_head('Админка · вход');
    echo '<h1>Вход в админку</h1>';
    render_flash($flash);
    if ($lock['locked']) {
        echo '<p class="flash flash--error">Вход заблокирован до ', date('H:i', $lock['until']), ' из-за неверных попыток.</p>';
    }
    echo '<form method="post" class="form"><input type="hidden" name="csrf" value="', h($csrf), '"><input type="hidden" name="action" value="login">',
        '<label>Пароль<input type="password" name="password" required autocomplete="current-password" autofocus></label>',
        '<button class="btn btn--primary"', $lock['locked'] ? ' disabled' : '', '>Войти</button></form>';
    render_foot();
    exit;
}

/* --- панель --- */
$reviews  = vtd_read('reviews');
$pending  = array_values(array_filter($reviews, static fn($r) => empty($r['approved'])));
$approved = array_values(array_filter($reviews, static fn($r) => !empty($r['approved'])));
usort($pending, static fn($a, $b) => ((int) ($b['ts'] ?? 0)) <=> ((int) ($a['ts'] ?? 0)));
usort($approved, static fn($a, $b) => ((int) ($b['ts'] ?? 0)) <=> ((int) ($a['ts'] ?? 0)));

render_head('Админка · отзывы');
echo '<header class="top"><h1>Отзывы</h1>',
    '<form method="post"><input type="hidden" name="csrf" value="', h($csrf), '"><button class="btn btn--ghost" name="action" value="logout">Выйти</button></form></header>';

echo '<nav class="tabs">';
foreach (['pending' => 'На проверке (' . count($pending) . ')', 'approved' => 'Опубликованные (' . count($approved) . ')', 'diag' => 'Диагностика', 'settings' => 'Пароль'] as $key => $label) {
    echo '<a class="tab', $tab === $key ? ' is-active' : '', '" href="?tab=', $key, '">', h($label), '</a>';
}
echo '</nav>';
render_flash($flash);

if ($tab === 'pending' || $tab === 'approved') {
    $list = $tab === 'pending' ? $pending : $approved;
    if (!$list) {
        echo '<p class="muted">', $tab === 'pending' ? 'Очередь пуста.' : 'Опубликованных отзывов нет.', '</p>';
    }
    foreach ($list as $r) {
        render_review($r, $tab, $csrf);
    }
}

if ($tab === 'settings') {
    echo '<h2>Смена пароля</h2>';
    if (adm_hash_in_config()) {
        echo '<p class="muted">Пароль задан константой VTD_ADMIN_PASSWORD_HASH в api/config.php. Чтобы сменить его, обновите хеш там.</p>';
    } else {
        echo '<form method="post" class="form"><input type="hidden" name="csrf" value="', h($csrf), '"><input type="hidden" name="action" value="password">',
            '<label>Текущий пароль<input type="password" name="current" required autocomplete="current-password"></label>',
            '<label>Новый пароль (минимум ', ADM_PASS_MIN, ' символов)<input type="password" name="p1" required minlength="', ADM_PASS_MIN, '" autocomplete="new-password"></label>',
            '<label>Ещё раз<input type="password" name="p2" required minlength="', ADM_PASS_MIN, '" autocomplete="new-password"></label>',
            '<button class="btn btn--primary">Сохранить</button></form>';
    }
}

if ($tab === 'diag') {
    $scheme   = vtd_is_https() ? 'https' : 'http';
    $host     = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
    $origin   = $scheme . '://' . $host;
    $dataDir  = vtd_data_dir();
    $outside  = vtd_data_outside_webroot();
    $software = (string) ($_SERVER['SERVER_SOFTWARE'] ?? 'неизвестно');
    $sessPath = session_save_path() ?: sys_get_temp_dir();
    $rate     = vtd_read('rate_limit');

    $ok  = static fn(bool $b, string $yes, string $no) => $b ? '<span class="ok">' . h($yes) . '</span>' : '<span class="bad">' . h($no) . '</span>';
    $row = static function (string $k, string $v): void {
        echo '<tr><th>', h($k), '</th><td>', $v, '</td></tr>';
    };

    echo '<h2>Сервер</h2><table class="diag">';
    $row('PHP', h(PHP_VERSION) . ' ' . $ok(version_compare(PHP_VERSION, '7.4.0', '>='), 'ок', 'нужен PHP 7.4 или новее'));
    $row('Расширение mbstring', $ok(extension_loaded('mbstring'), 'есть', 'нет, бэкенд работать не будет'));
    $row('Веб-сервер (как видит PHP)', h($software) . '<div class="muted small">Apache в этой строке означает, что PHP выполняет Apache и .htaccess действует для запросов к PHP. Статику (html, css, картинки, json) при этом всё равно может отдавать nginx, минуя .htaccess.</div>');
    $row('HTTPS', $ok(vtd_is_https(), 'да', 'нет: cookie админки без флага Secure'));
    $row('Папка сессий', h($sessPath) . ' ' . $ok(is_writable($sessPath), 'доступна на запись', 'недоступна на запись'));
    echo '</table>';

    echo '<h2>Данные</h2><table class="diag">';
    $row('Папка данных', h($dataDir));
    $row('Вне webroot', $ok($outside, 'да, веб-сервер её не отдаёт', 'нет, лежит внутри сайта. Чтобы вынести: создайте папку vtd-data рядом с папкой сайта (' . dirname(vtd_webroot()) . '/vtd-data) с правами на запись, файлы перенесутся автоматически при первом обращении'));
    $row('Запись в папку', $ok(is_writable($dataDir), 'ок', 'нет прав на запись, отзывы не сохраняются'));
    $row('Секрет', vtd_secret_source() === 'config' ? 'задан в api/config.php' : 'сгенерирован автоматически, хранится в папке данных');
    $row('Отзывов', count($reviews) . ' всего, ' . count($pending) . ' на проверке, ' . count($approved) . ' опубликовано');
    $row('Записей rate-limit', (string) count($rate));
    echo '</table>';

    echo '<h2>IP клиента</h2><table class="diag">';
    $row('REMOTE_ADDR', h((string) ($_SERVER['REMOTE_ADDR'] ?? '')));
    $row('X-Forwarded-For', h((string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '')) ?: '<span class="muted">нет</span>');
    $row('X-Real-IP', h((string) ($_SERVER['HTTP_X_REAL_IP'] ?? '')) ?: '<span class="muted">нет</span>');
    $row('Определённый IP', '<strong>' . h(vtd_client_ip()) . '</strong><div class="muted small">Должен совпадать с вашим реальным адресом (например, по 2ip.ru). Если здесь 127.0.0.1 или адрес хостинга, лимит «один отзыв в сутки» будет общим для всех: тогда впишите адрес прокси в VTD_TRUSTED_PROXIES в api/config.php.</div>');
    echo '</table>';

    echo '<h2>Проверка вручную</h2><p class="muted">Откройте адреса в браузере или через curl -I и сравните с ожидаемым результатом.</p><table class="diag">';
    if (!$outside) {
        $row(h($origin . '/data/.htaccess'), 'ожидается 403 или 404. Если файл показывается, .htaccess не действует');
        $row(h($origin . '/data/reviews.json.php'), 'ожидается 404 с пустым телом. Если виден JSON или текст с «&lt;?php», PHP в этой папке не выполняется');
    }
    $row(h($origin . '/api/config.example.php'), 'ожидается пустая страница. Если виден исходный код, PHP на сервере не работает: срочно');
    $row(h($origin . '/index.html'), 'в заголовках ответа должны быть Content-Security-Policy и X-Content-Type-Options. Если их нет, статику отдаёт nginx: добавьте те же заголовки в его настройки через панель хостинга');
    $row('Кто отдаёт статику', 'curl -sI ' . h($origin) . '/assets/css/style.css | grep -i ^server — «nginx» значит статика идёт мимо Apache и .htaccess');
    echo '</table>';
}

render_foot();
