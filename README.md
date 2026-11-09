# bx-passkeys

WebAuthn passkeys for BoxLang: let people register a passkey and sign in with it, no password. Every browser answer is verified by [webauthn4j](https://github.com/webauthn4j/webauthn4j), the WebAuthn library behind Spring Security's and Keycloak's passkey support. The module adds what webauthn4j leaves to you: one-time challenges, the options the browser needs, a credential store, and a sign counter that can't be raced.

- Attestation `"none"`: it trusts the key the authenticator hands over and doesn't check where the authenticator came from. That's what nearly every site wants. Attestation statements that do arrive are still checked for consistency.
- ES256 (P-256), Ed25519 and RS256: the three algorithms browsers actually use.
- It reports whether a passkey is backup eligible and backed up (synced), so you can tell a synced passkey from a device-bound one.
- Each challenge is kept in a session struct that you pass in. It works once and expires after `challengeSeconds`.
- Passkeys live in a **credential store** you choose. A table-backed store and an in-memory store come with the module.
- Framework-agnostic: there are no routes. You call four methods from your own handlers.

Requires BoxLang **1.19+** (Java 21). The module ships its jars in `libs/`: webauthn4j-core 0.32 and Jackson 3, whose `tools.jackson` packages don't clash with the Jackson 2 inside BoxLang. See [Dependencies](#dependencies).

## Install

```bash
install-bx-module bx-passkeys        # into BoxLang HOME
install-bx-module bx-passkeys --local  # into ./boxlang_modules
box install bx-passkeys              # with CommandBox
```

To try a local checkout before it's on ForgeBox (`install-bx-module` only installs from ForgeBox), copy the module's files into your project's `boxlang_modules`:

```bash
mkdir -p boxlang_modules/bx-passkeys && cp -R /path/to/bx-passkeys/{ModuleConfig.bx,box.json,bifs,libs,models,client,sql} boxlang_modules/bx-passkeys/
```

A copy in BoxLang HOME (`~/.boxlang/modules`) wins over one in `./boxlang_modules`, so remove an older install there first.

## Settings

Set these in `boxlang.json`:

```json
"modules": {
	"bxPasskeys": {
		"settings": {
			"rpId": "example.com",
			"rpName": "Example",
			"store": { "datasource": "app", "table": "passkey_credentials" }
		}
	}
}
```

Or pass them straight in: `passkeyRelyingParty( { rpId: "example.com" } )`.

| Setting | Default | Meaning |
|---|---|---|
| `rpId` | `"localhost"` | Your site's domain. Passkeys are bound to it, so they also work on its subdomains. |
| `rpName` | the rpId | The name shown in the browser's passkey sheet. |
| `origins` | `[]` | The exact origins sign-ins may come from, e.g. `[ "https://example.com" ]`. When it's empty, the module allows `https` on the rpId itself (any port), and plain `http` only on `localhost`. |
| `allowSubdomains` | `false` | With `origins` empty, also allow `https` on any subdomain of the rpId. Leave it off if anyone else can serve pages on a subdomain (user content, previews): such a page could relay sign-ins. |
| `challengeSeconds` | `300` | How long a challenge stays good. This is also the browser's timeout. |
| `algorithms` | `[ -7, -8, -257 ]` | COSE algorithm ids to accept, in order of preference. |
| `userVerification` | `"preferred"` | Set it to `"required"` to refuse an authenticator that didn't check a PIN or biometric. |
| `residentKey` | `"required"` | Discoverable credentials, so people can sign in without typing a username. |
| `maxPerUser` | `0` | The most passkeys one user may have. `0` means no limit. |
| `sessionKey` | `"passkeyChallenge"` | The key in your session struct where pending challenges are kept, one for registration and one for sign-in. |
| `store` | `{ table, datasource }` | Settings for the default `TableCredentialStore`. |

## Usage

`passkeyRelyingParty( overrides = {}, store )` returns a `RelyingParty` built from the module settings. Without a `store`, it uses a `TableCredentialStore`. You can also build one yourself with `new bxModules.bxPasskeys.models.RelyingParty( settings, store )`.

Every method that takes `sessionData` reads or writes your session struct. In a web app that's `session`. With BoxExpress it's `req.session`.

### Registering a passkey (the user is already signed in)

```js
// POST /passkeys/options
rp = passkeyRelyingParty()
return rp.registrationOptions( { id: user.id, name: user.email, displayName: user.name }, session )

// POST /passkeys        body = what createPasskey() returned
try {
	credential = rp.register( { id: user.id }, session, requestBody )
	return { id: credential.credentialId, name: credential.name }
} catch ( "Passkeys.Invalid" e ) {
	// 400, e.message is safe to show
}
```

`register()` returns the stored credential plus `backupEligible` and `backedUp`.

`user.id` is your app's id for the user, sent to the authenticator as UTF-8 bytes (at most 64). Don't put names or emails in it.

### Signing in

```js
// POST /sign-in/passkey/options
return passkeyRelyingParty().signInOptions( session )

// POST /sign-in/passkey   body = what signWithPasskey() returned
try {
	result = passkeyRelyingParty().verify( session, requestBody )
	// result = { userId, credentialId, userVerified, backupEligible, backedUp, signCount, credential }
	// sign result.userId in; rotate the session id
} catch ( "Passkeys.Invalid" e ) {
	// 401
}
```

To re-confirm a user who is already signed in (before a sensitive action, say), pass their id: `signInOptions( session, user.id )`. Only that user's passkeys are offered, and `verify()` refuses anyone else's.

### In the browser

`client/passkeys.js` is a small ES module, with types in `client/passkeys.d.ts`. Copy it into your front end:

```js
import { createPasskey, signWithPasskey, passkeysSupported } from './passkeys.js'

const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json())

// add a passkey
const registration = await createPasskey(await post('/passkeys/options'))
if (registration) await post('/passkeys', registration)

// sign in
const assertion = await signWithPasskey(await post('/sign-in/passkey/options'))
if (assertion) await post('/sign-in/passkey', assertion)
```

Both functions return `null` when the person closes the browser's sheet.

### Runnable example

`examples/flow.bxs` registers a passkey, signs in with it and shows a replay being refused, with the test authenticator standing in for the browser:

```bash
box install && boxlang setup-tests.bxs && boxlang --bx-home .tmp/bxhome examples/flow.bxs
```

## Credential stores

A store implements `bxModules.bxPasskeys.models.CredentialStore`:

```js
function findByCredentialId( required string credentialId )   // struct or null
array function listForUser( required string userId )          // newest first
void function add( required struct credential )
boolean function updateUsage( required string credentialId, required numeric signCount, required date lastUsedAt )
boolean function remove( required string credentialId )
```

A credential is `{ credentialId, userId, publicKey, algorithm, signCount, transports, name, createdAt, lastUsedAt }`. `credentialId` and `publicKey` (SPKI) are base64url strings. Compare `credentialId` and `userId` case-sensitively.

`updateUsage` must check and write in one step: save only while the new `signCount` is above the stored one (or both are 0), and return whether it saved. That's what keeps two sign-ins racing with the same counter from both getting through.

- **`TableCredentialStore( { datasource, table } )`** uses one table with plain parameterized SQL. Create the table from `sql/mssql.sql`, `sql/mysql.sql` or `sql/postgres.sql`. The scripts give `credential_id` and `user_id` binary collations, so they compare case-sensitively; keep that if you write your own.
- **`MemoryCredentialStore()`** holds passkeys in memory, for tests and demos.

To list or remove a user's passkeys in your account settings, call the store directly: `rp.getStore().listForUser( user.id )`.

## What it checks

webauthn4j verifies, on **registration**:

- `clientDataJSON` has type `webauthn.create`, the challenge, an allowed origin, and isn't from a cross-origin frame.
- `attestationObject` parses, its `authenticatorData` carries the SHA-256 of the rpId, the user-present flag (and the user-verified flag when that's required), backup flags that make sense together (backed up only if backup eligible), and attested credential data with a key of one of the accepted `algorithms`.
- The attestation statement is consistent with its format (`none`, `packed`, `tpm`, `android-key` and the rest). It isn't checked against trust roots.

On **sign-in** it verifies the same client data, rpId and flag checks, plus the signature over `authenticatorData ‖ SHA-256(clientDataJSON)` with the stored key, and that the signature counter moves forward.

The module itself checks:

- The challenge is the one in the session, for this purpose (registration or sign-in), still in date, and for the same user. Taking it is locked per session, so one challenge can't be used twice at once.
- On registration, the credential id is the one in `authenticatorData` and at most 1023 bytes; it's stored in canonical base64url, whatever padding the browser sent. When the browser also sends an SPKI key, it must be the same key. The user is still under `maxPerUser`, and the passkey isn't already registered to another user.
- On sign-in, the credential is on file, belongs to the expected user (if one was given), matches `userHandle` (if the browser sent one), and its algorithm is still accepted.
- The store saves the new counter only while it's still ahead (or both are 0), so two sign-ins racing with one counter can't both succeed. A counter that stays put, goes backwards or drops to 0 suggests a cloned key.

Every refusal throws `Passkeys.Invalid` with a message you can show the user. A bad setting throws `Passkeys.Configuration`. Any other error (a database outage, say) is rethrown as it is.

The module doesn't verify attestation trust chains or authenticator metadata (MDS), and doesn't process extensions. The table doesn't store the backup-eligible flag, so a passkey whose flag changes between registration and sign-in isn't flagged.

## Going to production

- Set `rpId` to your registrable domain and list `origins` exactly, e.g. `[ "https://example.com" ]`. Passkeys can't move to another rpId later, so pick it once.
- Serve over HTTPS. Browsers allow WebAuthn on plain `http` only for `localhost`.
- Use `TableCredentialStore` (or your own store) on a real database, with the table from `sql/`. Keep the binary collations on `credential_id` and `user_id`.
- Rotate the session id after a passkey sign-in (`sessionRotate()`), as after any sign-in.
- Rate-limit the options and verify endpoints like any sign-in endpoint.
- Keep a second way in (email link, recovery codes) until people have more than one passkey.
- Upgrading from 0.2: stored credentials keep working, the table is unchanged.

## Dependencies

`libs/` holds these jars from Maven Central, fetched and checked against Central's SHA-1 by `scripts/fetch-libs.sh`:

| Jar | Version | License |
|---|---|---|
| `com.webauthn4j:webauthn4j-core` | 0.32.0.RELEASE | Apache 2.0 |
| `tools.jackson.core:jackson-databind` | 3.2.4 | Apache 2.0 |
| `tools.jackson.core:jackson-core` | 3.2.4 | Apache 2.0 |
| `tools.jackson.dataformat:jackson-dataformat-cbor` | 3.2.4 | Apache 2.0 |
| `com.fasterxml.jackson.core:jackson-annotations` | 2.22 | Apache 2.0 |

webauthn4j logs through SLF4J, which BoxLang already provides. To update, change the versions in `scripts/fetch-libs.sh`, run it, run the specs, and commit `libs/`.

## Development

```bash
box install                 # TestBox, bx-derby and bx-compat-cfml
bash scripts/test.sh        # sets up the test homes on first run, then runs the specs in each
```

The specs run in two BoxLang homes of their own: `.tmp/bxhome` (this checkout and bx-derby) and `.tmp/bxhome-compat` (the same plus bx-compat-cfml, which changes how nulls behave). A bx-passkeys installed in `~/.boxlang/modules` can't stand in for the code under test. The table-store spec uses an in-memory Derby database.

## License

MIT
