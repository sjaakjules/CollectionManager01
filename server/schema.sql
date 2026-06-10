CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  username VARCHAR(24) NOT NULL,
  username_norm VARCHAR(24) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY users_username_norm_unique (username_norm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY sessions_user_id_index (user_id),
  KEY sessions_expires_at_index (expires_at),
  CONSTRAINT sessions_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_data (
  user_id CHAR(36) PRIMARY KEY,
  data_json LONGTEXT NOT NULL CHECK (JSON_VALID(data_json)),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT user_data_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
