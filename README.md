# bx-passkeys

WebAuthn passkeys for BoxLang: let people register a passkey and sign in with it, no password. It uses only JDK crypto (`java.security`), with no third-party jars.

- Attestation `"none"`: it trusts the key the authenticator hands over and doesn't check where the authenticator came from. That's what nearly every site wants.
- ES256 (P-256), Ed25519 and RS256: the three algorithms browsers actually use.
- It reads the new key from the browser's `getPublicKey()` (SPKI) or, when that's missing, from the COSE key inside `attestationObject`. A small CBOR decoder is built in.
- Each challenge is kept in a session struct that you pass in. It works once and expires after `challengeSeconds`.
- Passkeys live in a **credential store** you choose. A table-backed store and an in-memory store come with the module.
- Framework-agnostic: there are no routes. You call four methods from your own handlers.

Requires BoxLang **1.19+**.

## Install

```bash
install-bx-module bx-passkeys        # into BoxLang HOME
install-bx-module bx-passkeys --local  # into ./boxlang_modules
box install bx-passkeys              # with CommandBox
```

To try a local checkout before it's on ForgeBox (`install-bx-module` only installs from ForgeBox), copy the module's files into your project's `boxlang_modules`:

```bash
mkdir -p boxlang_modules/bx-passkeys && cp -R /path/to/bx-passkeys/{ModuleConfig.bx,box.json,bifs,models,client,sql} boxlang_modules/bx-passkeys/
```

`box install /path/to/bx-passkeys` also works, but it installs into BoxLang HOME. Run it on a checkout without the `boxlang_modules/` test link (`rm -rf boxlang_modules`), or the copy follows the link back into itself.

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
| `origins` | `[]` | The exact origins sign-ins may come from, e.g. `[ "https://example.com" ]`. When it's empty, the module allows `https` on the rpId or any of its subdomains, and plain `http` only on `localhost`. |
| `challengeSeconds` | `300` | How long a challenge stays good. This is also the browser's timeout. |
| `algorithms` | `[ -7, -8, -257 ]` | COSE algorithm ids to accept, in order of preference. |
| `userVerification` | `"preferred"` | Set it to `"required"` to refuse an authenticator that didn't check a PIN or biometric. |
| `residentKey` | `"required"` | Discoverable credentials, so people can sign in without typing a username. |
| `maxPerUser` | `0` | The most passkeys one user may have. `0` means no limit. |
| `sessionKey` | `"passkeyChallenge"` | The key in your session struct where the pending challenge is kept. |
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

`user.id` is your app's id for the user, sent to the authenticator as UTF-8 bytes (at most 64). Don't put names or emails in it.

### Signing in

```js
// POST /sign-in/passkey/options
return passkeyRelyingParty().signInOptions( session )

// POST /sign-in/passkey   body = what signWithPasskey() returned
try {
	result = passkeyRelyingParty().verify( session, requestBody )
	// result = { userId, credentialId, userVerified, signCount, credential }
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
box install && boxlang setup-tests.bxs && boxlang examples/flow.bxs
```

## Credential stores

A store implements `bxModules.bxPasskeys.models.CredentialStore`:

```js
function findByCredentialId( required string credentialId )   // struct or null
array function listForUser( required string userId )          // newest first
void function add( required struct credential )
void function updateUsage( required string credentialId, required numeric signCount, required date lastUsedAt )
boolean function remove( required string credentialId )
```

A credential is `{ credentialId, userId, publicKey, algorithm, signCount, transports, name, createdAt, lastUsedAt }`. `credentialId` and `publicKey` (SPKI) are base64url strings.

- **`TableCredentialStore( { datasource, table } )`** uses one table with plain parameterized SQL. Create the table from `sql/mssql.sql`, `sql/mysql.sql` or `sql/postgres.sql`.
- **`MemoryCredentialStore()`** holds passkeys in memory, for tests and demos.

To list or remove a user's passkeys in your account settings, call the store directly: `rp.getStore().listForUser( user.id )`.

## What it checks

On **registration**:

- The challenge is the one in the session, for registration, still in date, and for the same user.
- `clientDataJSON` has type `webauthn.create`, an allowed origin, and isn't from a cross-origin frame.
- `authenticatorData` carries the SHA-256 of the rpId, the user-present flag (and the user-verified flag when that's required), and attested credential data.
- The credential id matches the one in `authenticatorData`.
- The key is one of the accepted algorithms and can be read. When both SPKI and a COSE key are sent, they must match.
- The passkey isn't already registered to another user.

On **sign-in**, the same challenge, origin, rpId and flag checks apply, plus:

- The credential is on file.
- It belongs to the expected user, if one was given, and matches `userHandle`, if the browser sent one.
- The signature over `authenticatorData ‖ SHA-256(clientDataJSON)` verifies.
- The signature counter doesn't go backwards. A counter that goes backwards suggests a cloned key; most passkeys always send 0.

Every refusal throws `Passkeys.Invalid` with a message you can show the user. A bad setting throws `Passkeys.Configuration`.

The module doesn't do attestation verification, authenticator metadata (MDS) or any extensions.

## Development

```bash
box install                 # TestBox
boxlang setup-tests.bxs     # once: links boxlang_modules/bxPasskeys to this folder
boxlang run-tests.bxs
```

The table-store spec uses an in-memory Derby database, so it needs the `bx-derby` module (`install-bx-module bx-derby`).

## License

MIT
