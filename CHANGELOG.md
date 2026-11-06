# Changelog

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
