CREATE TABLE passkey_credentials (
	credential_id VARCHAR(1400) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
	user_id       VARCHAR(255)  NOT NULL,
	public_key    TEXT          NOT NULL,
	algorithm     INT           NOT NULL,
	sign_count    BIGINT        NOT NULL DEFAULT 0,
	transports    VARCHAR(255)  NULL,
	name          VARCHAR(100)  NOT NULL,
	created_at    DATETIME      NOT NULL,
	last_used_at  DATETIME      NULL,
	KEY ix_passkey_credentials_user ( user_id )
);
