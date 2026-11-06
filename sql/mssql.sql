CREATE TABLE passkey_credentials (
	credential_id VARCHAR(1400) NOT NULL PRIMARY KEY NONCLUSTERED,
	user_id       VARCHAR(255)  NOT NULL,
	public_key    VARCHAR(2048) NOT NULL,
	algorithm     INT           NOT NULL,
	sign_count    BIGINT        NOT NULL DEFAULT 0,
	transports    VARCHAR(255)  NULL,
	name          NVARCHAR(100) NOT NULL,
	created_at    DATETIME2     NOT NULL,
	last_used_at  DATETIME2     NULL
);
CREATE INDEX ix_passkey_credentials_user ON passkey_credentials ( user_id );
