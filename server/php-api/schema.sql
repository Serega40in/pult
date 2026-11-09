-- PULT PHP API schema. Requires MySQL 5.7+ or MariaDB with InnoDB and JSON support.
-- Import this file into the database created for PULT in the hosting control panel.

CREATE TABLE IF NOT EXISTS pult_devices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id CHAR(32) NOT NULL,
    device_name VARCHAR(120) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    capabilities_json JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NULL,
    revoked_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pult_devices_device_id (device_id),
    UNIQUE KEY uq_pult_devices_token_hash (token_hash),
    KEY idx_pult_devices_active (revoked_at, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pult_jobs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    job_id CHAR(32) NOT NULL,
    device_id CHAR(32) NOT NULL,
    client_name VARCHAR(80) NOT NULL DEFAULT 'pult-extension',
    plan_json JSON NOT NULL,
    status ENUM('queued', 'claimed', 'completed', 'failed', 'expired') NOT NULL DEFAULT 'queued',
    approved_at DATETIME NULL,
    claimed_at DATETIME NULL,
    lease_expires_at DATETIME NULL,
    completed_at DATETIME NULL,
    result_json JSON NULL,
    error_code VARCHAR(80) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pult_jobs_job_id (job_id),
    KEY idx_pult_jobs_queue (device_id, status, approved_at, created_at),
    KEY idx_pult_jobs_lease (status, lease_expires_at),
    CONSTRAINT fk_pult_jobs_device
        FOREIGN KEY (device_id) REFERENCES pult_devices(device_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pult_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id CHAR(32) NOT NULL,
    device_id CHAR(32) NULL,
    job_id CHAR(32) NULL,
    event_type VARCHAR(80) NOT NULL,
    details_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pult_events_event_id (event_id),
    KEY idx_pult_events_job (job_id, created_at),
    KEY idx_pult_events_device (device_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
