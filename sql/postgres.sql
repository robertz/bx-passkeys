CREATE TABLE passkey_credentials (
	credential_id VARCHAR(1400) NOT NULL PRIMARY KEY,
	user_id       VARCHAR(255)  NOT NULL,
	public_key    TEXT          NOT NULL,
	algorithm     INTEGER       NOT NULL,
	sign_count    BIGINT        NOT NULL DEFAULT 0,
	transports    VARCHAR(255),
	name          VARCHAR(100)  NOT NULL,
	created_at    TIMESTAMP     NOT NULL,
	last_used_at  TIMESTAMP
);
CREATE INDEX ix_passkey_credentials_user ON passkey_credentials ( user_id );
