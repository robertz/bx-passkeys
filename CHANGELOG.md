# Changelog

**0.2.0**
- **Breaking:** with `origins` empty, only `https://<rpId>` is allowed now, not
  its subdomains. Set the new `allowSubdomains: true` (or list `origins`) to
  allow them.
- **Breaking:** `CredentialStore.updateUsage()` returns a boolean and must save
  only while the counter moves forward (or stays 0), in one step. Custom stores
  need updating.
- A cloned key that sent counter 0 got past the clone check and reset the
  stored counter to 0. Any counter that doesn't move forward is now refused.
- Two sign-ins racing with the same counter can't both succeed:
  `TableCredentialStore` updates with `sign_count < ?`, and the memory store
  checks under its lock.
- Taking a challenge is locked per session, so one assertion can't be used by
  two parallel requests.
- Registration and sign-in keep separate challenges, so starting a sign-in (in
  another tab, say) no longer cancels a registration in progress.
- Registration requires the COSE key in `authenticatorData`; a browser SPKI key
  is checked against it rather than trusted on its own.
- Credential ids over 1023 bytes are refused, ids are stored in canonical
  base64url, and transports are capped at 10 distinct entries.
- `maxPerUser` is checked at registration too.
- Sign-in refuses passkeys whose algorithm was taken out of `algorithms`.
- SQL scripts: binary collations on `credential_id` and `user_id` (MSSQL,
  MySQL); `name` is bound as `nvarchar` so non-ASCII names survive on MSSQL.
- `MemoryCredentialStore` matches user ids exactly and reads under its lock.
- Module defaults live only in `RelyingParty`; one `SecureRandom` and Base64
  coder are shared.

**0.1.0**
- First release, extracted from DismalThreads.
- WebAuthn registration and sign-in with attestation `"none"`, using only
  JDK crypto (`java.security`).
- ES256 (P-256), Ed25519 and RS256 keys, read from the browser's SPKI
  `getPublicKey()` or the COSE key in `attestationObject` (built-in CBOR
  decoder).
- Single-use, expiring challenges kept in a session struct you pass in.
- Pluggable credential stores: `TableCredentialStore` and
  `MemoryCredentialStore` ship with the module.
- `passkeyRelyingParty()` BIF and a browser client helper.
