<?php
declare(strict_types=1);

/**
 * PULT PHP API v1
 * Deploy this directory under an HTTPS-enabled path, e.g. https://example.com/pult-api/
 * Copy config.example.php to config.php and configure it before first use.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function ok(array $data = [], int $status = 200): never
{
    respond($status, [
        'ok' => true,
        'data' => $data,
        'request_id' => bin2hex(random_bytes(8)),
    ]);
}

function fail(int $status, string $code, string $message): never
{
    respond($status, [
        'ok' => false,
        'error' => ['code' => $code, 'message' => $message],
        'request_id' => bin2hex(random_bytes(8)),
    ]);
}

set_exception_handler(static function (Throwable $exception): void {
    error_log('PULT API unhandled exception: ' . $exception->getMessage());
    fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred in the PULT API.');
});

function requestMethod(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function requestPath(): string
{
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $scriptDirectory = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/index.php'));
    $scriptDirectory = rtrim($scriptDirectory, '/');
    if ($scriptDirectory !== '' && $scriptDirectory !== '/' && str_starts_with($path, $scriptDirectory)) {
        $path = substr($path, strlen($scriptDirectory));
    }
    return '/' . ltrim($path, '/');
}

function requestJson(int $maxBytes): array
{
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > $maxBytes) {
        fail(413, 'REQUEST_TOO_LARGE', 'JSON request exceeds the configured size limit.');
    }

    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > $maxBytes) {
        fail(413, 'REQUEST_TOO_LARGE', 'JSON request exceeds the configured size limit.');
    }
    if (trim($raw) === '') {
        return [];
    }

    try {
        $value = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        fail(400, 'INVALID_JSON', 'Request body must contain valid JSON.');
    }
    if (!is_array($value)) {
        fail(400, 'INVALID_JSON', 'Top-level JSON value must be an object.');
    }
    return $value;
}

function bearerToken(): string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($header === '' && function_exists('getallheaders')) {
        $headers = getallheaders();
        $header = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    }
    if (!preg_match('/^Bearer\\s+([a-f0-9]{64})$/i', trim($header), $matches)) {
        fail(401, 'UNAUTHORIZED', 'A valid PULT device token is required.');
    }
    return strtolower($matches[1]);
}

function db(array $config): PDO
{
    $database = $config['database'] ?? [];
    if (empty($database['dsn']) || empty($database['username'])) {
        fail(503, 'NOT_CONFIGURED', 'Database connection is not configured. Copy config.example.php to config.php and fill it in.');
    }
    try {
        return new PDO(
            (string)$database['dsn'],
            (string)$database['username'],
            (string)($database['password'] ?? ''),
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    } catch (Throwable) {
        fail(503, 'DATABASE_UNAVAILABLE', 'PULT database is unavailable. Check the hosting database settings.');
    }
}

function authenticate(PDO $pdo): array
{
    $hash = hash('sha256', bearerToken());
    $statement = $pdo->prepare(
        'SELECT device_id, device_name FROM pult_devices WHERE token_hash = :token_hash AND revoked_at IS NULL LIMIT 1'
    );
    $statement->execute(['token_hash' => $hash]);
    $device = $statement->fetch();
    if (!$device) {
        fail(401, 'INVALID_DEVICE_TOKEN', 'Device token is invalid or has been revoked.');
    }

    $update = $pdo->prepare('UPDATE pult_devices SET last_seen_at = UTC_TIMESTAMP() WHERE device_id = :device_id');
    $update->execute(['device_id' => $device['device_id']]);
    return $device;
}

function event(PDO $pdo, ?string $deviceId, ?string $jobId, string $type, array $details = []): void
{
    $statement = $pdo->prepare(
        'INSERT INTO pult_events (event_id, device_id, job_id, event_type, details_json)
         VALUES (:event_id, :device_id, :job_id, :event_type, :details_json)'
    );
    $statement->execute([
        'event_id' => bin2hex(random_bytes(16)),
        'device_id' => $deviceId,
        'job_id' => $jobId,
        'event_type' => $type,
        'details_json' => $details ? json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
    ]);
}

function validatePlan(mixed $plan): array
{
    if (!is_array($plan) || !isset($plan['steps']) || !is_array($plan['steps'])) {
        fail(422, 'INVALID_PLAN', 'Plan must contain a steps array.');
    }
    if (count($plan['steps']) < 1 || count($plan['steps']) > 8) {
        fail(422, 'INVALID_PLAN', 'A plan must contain between 1 and 8 steps.');
    }

    $clean = [];
    foreach ($plan['steps'] as $index => $step) {
        $number = $index + 1;
        if (!is_array($step) || !isset($step['action']) || !is_string($step['action'])) {
            fail(422, 'INVALID_STEP', "Step {$number} is invalid.");
        }
        $action = $step['action'];
        switch ($action) {
            case 'navigate':
                $url = $step['url'] ?? null;
                if (!is_string($url) || strlen($url) > 2048 || !filter_var($url, FILTER_VALIDATE_URL)) {
                    fail(422, 'INVALID_URL', "Step {$number}: URL is invalid.");
                }
                $parts = parse_url($url);
                if (!$parts || !in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true) || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
                    fail(422, 'INVALID_URL', "Step {$number}: only ordinary HTTP/HTTPS URLs are allowed.");
                }
                $clean[] = ['action' => 'navigate', 'url' => $url];
                break;

            case 'read_page':
                $clean[] = ['action' => 'read_page'];
                break;

            case 'click':
                $selector = $step['selector'] ?? null;
                if (!is_string($selector) || trim($selector) === '' || strlen($selector) > 500) {
                    fail(422, 'INVALID_SELECTOR', "Step {$number}: selector must contain 1–500 characters.");
                }
                $clean[] = ['action' => 'click', 'selector' => $selector];
                break;

            case 'type':
                $selector = $step['selector'] ?? null;
                $text = $step['text'] ?? null;
                if (!is_string($selector) || trim($selector) === '' || strlen($selector) > 500 || !is_string($text) || mb_strlen($text, 'UTF-8') > 2000) {
                    fail(422, 'INVALID_INPUT', "Step {$number}: text input or selector is invalid.");
                }
                $clean[] = ['action' => 'type', 'selector' => $selector, 'text' => $text];
                break;

            case 'scroll':
                $y = $step['y'] ?? null;
                if (!is_int($y) || abs($y) > 2000) {
                    fail(422, 'INVALID_SCROLL', "Step {$number}: scroll must be an integer between -2000 and 2000.");
                }
                $clean[] = ['action' => 'scroll', 'y' => $y];
                break;

            case 'wait':
                $ms = $step['ms'] ?? null;
                if (!is_int($ms) || $ms < 0 || $ms > 3000) {
                    fail(422, 'INVALID_WAIT', "Step {$number}: wait must be between 0 and 3000 milliseconds.");
                }
                $clean[] = ['action' => 'wait', 'ms' => $ms];
                break;

            default:
                fail(422, 'UNSUPPORTED_ACTION', "Step {$number}: action '{$action}' is not supported.");
        }
    }
    return ['steps' => $clean];
}

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    fail(503, 'NOT_CONFIGURED', 'PULT API is not configured yet. Copy config.example.php to config.php.');
}
$config = require $configPath;
if (!is_array($config)) {
    fail(503, 'NOT_CONFIGURED', 'PULT config.php must return a configuration array.');
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = $config['allowed_origins'] ?? [];
if ($origin !== '') {
    if (!in_array($origin, $allowedOrigins, true)) {
        fail(403, 'ORIGIN_NOT_ALLOWED', 'This browser origin is not allowed by PULT.');
    }
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Max-Age: 600');
}
if (requestMethod() === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$path = requestPath();
$method = requestMethod();

if ($method === 'GET' && $path === '/v1/health') {
    $healthDb = db($config);
    $healthDb->query('SELECT 1');
    ok(['service' => 'PULT API', 'api_version' => '1', 'status' => 'ready', 'database' => 'ok']);
}

if ($method === 'POST' && $path === '/v1/devices/pair') {
    $secret = (string)($config['pairing_secret'] ?? '');
    if (strlen($secret) < 32 || str_starts_with($secret, 'REPLACE_')) {
        fail(503, 'PAIRING_NOT_CONFIGURED', 'Set a long random pairing_secret in config.php before pairing devices.');
    }
    $body = requestJson((int)($config['max_request_bytes'] ?? 131072));
    $provided = (string)($body['pairing_secret'] ?? '');
    if ($provided === '' || !hash_equals($secret, $provided)) {
        fail(401, 'PAIRING_FAILED', 'Pairing code is incorrect.');
    }

    $name = trim((string)($body['device_name'] ?? 'PULT Chrome'));
    if ($name === '' || mb_strlen($name, 'UTF-8') > 120) {
        fail(422, 'INVALID_DEVICE_NAME', 'Device name must contain 1–120 characters.');
    }
    $token = bin2hex(random_bytes(32));
    $deviceId = bin2hex(random_bytes(16));
    $capabilities = ['navigate', 'read_page', 'click', 'type', 'scroll', 'wait'];
    $statement = db($config)->prepare(
        'INSERT INTO pult_devices (device_id, device_name, token_hash, capabilities_json)
         VALUES (:device_id, :device_name, :token_hash, :capabilities_json)'
    );
    $statement->execute([
        'device_id' => $deviceId,
        'device_name' => $name,
        'token_hash' => hash('sha256', $token),
        'capabilities_json' => json_encode($capabilities),
    ]);
    ok([
        'device_id' => $deviceId,
        'device_name' => $name,
        'device_token' => $token,
        'capabilities' => $capabilities,
        'notice' => 'Save this token in the extension. It will not be shown again.',
    ], 201);
}

$pdo = db($config);
$device = authenticate($pdo);
$deviceId = (string)$device['device_id'];
$maxBytes = (int)($config['max_request_bytes'] ?? 131072);

if ($method === 'POST' && $path === '/v1/jobs') {
    $body = requestJson($maxBytes);
    $plan = validatePlan($body['plan'] ?? null);
    $clientName = trim((string)($body['client_name'] ?? 'pult-extension'));
    if ($clientName === '' || strlen($clientName) > 80) {
        fail(422, 'INVALID_CLIENT_NAME', 'Client name must contain 1–80 characters.');
    }

    $jobId = bin2hex(random_bytes(16));
    $statement = $pdo->prepare(
        'INSERT INTO pult_jobs (job_id, device_id, client_name, plan_json, status)
         VALUES (:job_id, :device_id, :client_name, :plan_json, "queued")'
    );
    $statement->execute([
        'job_id' => $jobId,
        'device_id' => $deviceId,
        'client_name' => $clientName,
        'plan_json' => json_encode($plan, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
    event($pdo, $deviceId, $jobId, 'job.created', ['steps' => count($plan['steps'])]);
    ok(['job_id' => $jobId, 'status' => 'queued', 'approval_required' => true], 201);
}

if ($method === 'POST' && $path === '/v1/jobs/claim') {
    $body = requestJson($maxBytes);
    $jobId = (string)($body['job_id'] ?? '');
    if (!preg_match('/^[a-f0-9]{32}$/', $jobId)) {
        fail(422, 'INVALID_JOB_ID', 'A valid job_id is required.');
    }

    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            'SELECT job_id, plan_json FROM pult_jobs
             WHERE job_id = :job_id AND device_id = :device_id AND status = "queued" AND approved_at IS NOT NULL
             LIMIT 1 FOR UPDATE'
        );
        $statement->execute(['job_id' => $jobId, 'device_id' => $deviceId]);
        $job = $statement->fetch();
        if (!$job) {
            $pdo->rollBack();
            fail(409, 'JOB_NOT_READY', 'Job is not queued, not approved, or belongs to another device.');
        }
        $leaseSeconds = max(30, min(300, (int)($config['lease_seconds'] ?? 90)));
        $update = $pdo->prepare(
            'UPDATE pult_jobs SET status = "claimed", claimed_at = UTC_TIMESTAMP(),
             lease_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL :lease_seconds SECOND)
             WHERE job_id = :job_id AND status = "queued"'
        );
        $update->bindValue(':lease_seconds', $leaseSeconds, PDO::PARAM_INT);
        $update->bindValue(':job_id', $jobId, PDO::PARAM_STR);
        $update->execute();
        $pdo->commit();
        event($pdo, $deviceId, $jobId, 'job.claimed', ['lease_seconds' => $leaseSeconds]);
        ok([
            'job_id' => $jobId,
            'status' => 'claimed',
            'lease_seconds' => $leaseSeconds,
            'plan' => json_decode((string)$job['plan_json'], true),
        ]);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

if ($method === 'POST' && preg_match('#^/v1/jobs/([a-f0-9]{32})/approve$#', $path, $matches)) {
    $jobId = $matches[1];
    $statement = $pdo->prepare(
        'UPDATE pult_jobs SET approved_at = UTC_TIMESTAMP()
         WHERE job_id = :job_id AND device_id = :device_id AND status = "queued" AND approved_at IS NULL'
    );
    $statement->execute(['job_id' => $jobId, 'device_id' => $deviceId]);
    if ($statement->rowCount() !== 1) {
        fail(409, 'JOB_CANNOT_BE_APPROVED', 'Job does not exist, was already approved, or is no longer queued.');
    }
    event($pdo, $deviceId, $jobId, 'job.approved');
    ok(['job_id' => $jobId, 'status' => 'queued', 'approved' => true]);
}

if ($method === 'POST' && preg_match('#^/v1/jobs/([a-f0-9]{32})/complete$#', $path, $matches)) {
    $jobId = $matches[1];
    $body = requestJson((int)($config['max_result_bytes'] ?? 65536));
    $result = $body['result'] ?? null;
    if (!is_array($result)) {
        fail(422, 'INVALID_RESULT', 'result must be a JSON object.');
    }
    $resultJson = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($resultJson === false || strlen($resultJson) > (int)($config['max_result_bytes'] ?? 65536)) {
        fail(413, 'RESULT_TOO_LARGE', 'Result exceeds the configured size limit.');
    }
    $success = !empty($result['ok']);
    $status = $success ? 'completed' : 'failed';

    $statement = $pdo->prepare(
        'UPDATE pult_jobs SET status = :status, result_json = :result_json, completed_at = UTC_TIMESTAMP(),
         lease_expires_at = NULL
         WHERE job_id = :job_id AND device_id = :device_id AND status = "claimed"
         AND lease_expires_at >= UTC_TIMESTAMP()'
    );
    $statement->execute([
        'status' => $status,
        'result_json' => $resultJson,
        'job_id' => $jobId,
        'device_id' => $deviceId,
    ]);
    if ($statement->rowCount() !== 1) {
        fail(409, 'JOB_LEASE_EXPIRED', 'Job is not claimed by this device or its execution lease expired.');
    }
    event($pdo, $deviceId, $jobId, 'job.' . $status);
    ok(['job_id' => $jobId, 'status' => $status]);
}

if ($method === 'GET' && preg_match('#^/v1/jobs/([a-f0-9]{32})$#', $path, $matches)) {
    $statement = $pdo->prepare(
        'SELECT job_id, client_name, status, created_at, claimed_at, completed_at, result_json, error_code
         FROM pult_jobs WHERE job_id = :job_id AND device_id = :device_id LIMIT 1'
    );
    $statement->execute(['job_id' => $matches[1], 'device_id' => $deviceId]);
    $job = $statement->fetch();
    if (!$job) {
        fail(404, 'JOB_NOT_FOUND', 'Job was not found for this device.');
    }
    if ($job['result_json'] !== null) {
        $job['result'] = json_decode((string)$job['result_json'], true);
    }
    unset($job['result_json']);
    ok(['job' => $job]);
}

fail(404, 'NOT_FOUND', 'PULT API endpoint was not found.');
