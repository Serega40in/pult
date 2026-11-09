<?php
declare(strict_types=1);

/**
 * Copy this file to config.php on the server and fill in the values.
 * Never commit config.php or put database credentials/device tokens in Git.
 */
return [
    'database' => [
        'dsn' => 'mysql:host=localhost;dbname=CHANGE_ME;charset=utf8mb4',
        'username' => 'CHANGE_ME',
        'password' => 'CHANGE_ME',
    ],

    // Generate a unique random value with at least 32 bytes of entropy.
    // Used only to pair a new device. Rotate it after pairing if desired.
    'pairing_secret' => 'REPLACE_WITH_A_LONG_RANDOM_SECRET',

    // Add the exact extension origin shown on chrome://extensions.
    // Example: chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef
    'allowed_origins' => [
        'chrome-extension://REPLACE_WITH_EXTENSION_ID',
    ],

    'max_request_bytes' => 131072,
    'max_result_bytes' => 131072,
    'lease_seconds' => 90,
];
