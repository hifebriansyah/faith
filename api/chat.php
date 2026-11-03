<?php
// The same job as POST /api/chat in server.js, for Apache: ask islam-gpt.org the question and relay the answer stream as SSE.
$base = getenv('ISLAM_BASE_URL') ?: 'https://www.islam-gpt.org';
$deviceId = getenv('ISLAM_DEVICE_ID') ?: 'EXAMPLEDEVICEID000000000';

$question = trim((string) (json_decode(file_get_contents('php://input'), true)['question'] ?? ''));
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || $question === '') {
    http_response_code(400);
    header('Content-Type: application/json');
    exit('{"error":"question is required"}');
}

while (ob_get_level()) ob_end_flush();
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no');
set_time_limit(0);
ignore_user_abort(false);

function send(array $ev): void {
    echo 'data: ' . json_encode($ev, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
    flush();
}

$ch = curl_init("$base/api/questions");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode(['deviceId' => $deviceId, 'question' => $question]),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 30,
]);
$res = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$shareId = $code === 200 ? (json_decode((string) $res, true)['shareId'] ?? null) : null;
if (!$shareId) {
    send(['type' => 'error', 'message' => "POST /api/questions: HTTP $code"]);
    exit;
}

// the upstream already sends "data: {...}\n\n" events: pass the bytes straight through
$ch = curl_init("$base/api/stream/$shareId");
curl_setopt_array($ch, [
    CURLOPT_HTTPHEADER => ['Accept: text/event-stream'],
    CURLOPT_WRITEFUNCTION => function ($ch, $chunk) {
        echo $chunk;
        flush();
        return connection_aborted() ? 0 : strlen($chunk);
    },
    CURLOPT_TIMEOUT => 300,
]);
curl_exec($ch);
if (curl_errno($ch) && !connection_aborted()) send(['type' => 'error', 'message' => curl_error($ch)]);
curl_close($ch);
