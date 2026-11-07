---
title: "Passwordless sign-in for BoxLang with bx-passkeys"
author: Robert Zehnder
date: 2026-11-06
tags: [boxlang, webauthn, passkeys, security]
---

# Passwordless sign-in for BoxLang with bx-passkeys

Passwords are the weakest part of most sign-in systems. People reuse them, phishing pages collect them, and every site that stores password hashes has a breach to worry about. Passkeys fix that. A passkey is a key pair that lives on the user's phone, laptop or security key. Your server keeps only the public half. Signing in means the device signs a fresh challenge from your server, after the user unlocks it with a fingerprint, face or PIN. Nothing reusable crosses the wire, and a phishing site can't ask for the passkey because the browser only uses it on the domain it was made for.

The standard behind passkeys is WebAuthn. It's well supported in browsers now, but the server side is fiddly: CBOR decoding, COSE keys, authenticator data flags, signature counters, origin checks and single-use challenges. **bx-passkeys** handles all of that for BoxLang. It uses only the JDK's own crypto (`java.security`), with no third-party jars, and it doesn't tie you to a framework. There are no routes. You call four methods from whatever handlers you already have.

This post walks through adding passkeys to a BoxLang web app, step by step. By the end you'll have:

- A button that adds a passkey to a signed-in account
- A "Sign in with a passkey" button that needs no username
- A page that lists a user's passkeys and lets them remove one

Every code sample here comes from a small demo app that I ran on the BoxLang MiniServer while writing this.

## How it works

There are two ceremonies, and each is a pair of requests.

**Registration** (the user is already signed in some other way):

1. The browser asks your server for *creation options*. The server makes a random challenge, saves it in the session and sends it back with your site's details.
2. The browser hands the options to `navigator.credentials.create()`. The device makes a new key pair, and the browser posts the public key and a signed bundle back to your server.
3. The server checks the answer against the saved challenge and stores the public key.

**Sign-in**:

1. The browser asks for *request options*: another challenge.
2. `navigator.credentials.get()` lets the user pick a passkey, and the device signs the challenge.
3. The server finds the stored public key, checks the signature and signs the user in.

bx-passkeys gives you one method for each server step: `registrationOptions()`, `register()`, `signInOptions()` and `verify()`. It also ships a small browser module, `passkeys.js`, that converts the options and answers between JSON and the binary types WebAuthn uses.

## Step 1: Install the module

You need BoxLang 1.19 or later. Install from ForgeBox with any of these:

```bash
install-bx-module bx-passkeys --local
```

```bash
install-bx-module bx-passkeys
```

```bash
box install bx-passkeys
```

The first installs into your project's `boxlang_modules` folder. The second installs into your BoxLang home, so every app on the machine gets it. The third uses CommandBox.

The module registers one BIF, `passkeyRelyingParty()`, and a set of classes under `bxModules.bxPasskeys.models`.

## Step 2: Create the credential table

Passkeys are stored in a *credential store*. The module comes with two: `TableCredentialStore` for a database table, and `MemoryCredentialStore` for tests and demos.

For a real app, create the table. The module ships scripts for MSSQL, MySQL and PostgreSQL in its `sql/` folder. Here's the MSSQL one:

```sql
CREATE TABLE passkey_credentials (
	credential_id VARCHAR(1400) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY NONCLUSTERED,
	user_id       VARCHAR(255)  COLLATE Latin1_General_100_BIN2 NOT NULL,
	public_key    VARCHAR(2048) NOT NULL,
	algorithm     INT           NOT NULL,
	sign_count    BIGINT        NOT NULL DEFAULT 0,
	transports    VARCHAR(255)  NULL,
	name          NVARCHAR(100) NOT NULL,
	created_at    DATETIME2     NOT NULL,
	last_used_at  DATETIME2     NULL
);
CREATE INDEX ix_passkey_credentials_user ON passkey_credentials ( user_id );
```

The binary collation on `credential_id` and `user_id` matters. Credential ids are base64url strings, where `a` and `A` are different characters. With SQL Server's default case-insensitive collation, two different ids could match each other. If you write your own table, keep the columns case-sensitive.

## Step 3: Configure the relying party

In WebAuthn your site is the *relying party*. Its id (`rpId`) is your domain, and every passkey is bound to it. A passkey made for `example.com` won't work anywhere else, which is what makes passkeys phishing-proof.

Create the relying party once when the app starts and keep it in the application scope. It holds only settings and the store, so it's safe to share between requests.

```js
// Application.bx
class {

	this.name              = "PasskeyDemo"
	this.sessionManagement = true
	this.sessionTimeout    = createTimespan( 0, 0, 30, 0 )

	this.datasources = {
		app : {
			driver   : "mssql",
			host     : "localhost",
			port     : 1433,
			database : "demo",
			username : "demo",
			password : server.system.environment.DB_PASSWORD
		}
	}

	function onApplicationStart() {
		application.passkeys = passkeyRelyingParty( {
			rpId    : "example.com",
			rpName  : "Example",
			origins : [ "https://example.com" ],
			store   : { datasource: "app", table: "passkey_credentials" }
		} )
		return true
	}

}
```

The MSSQL driver comes from the `bx-mssql` module. Use whichever database module you already have.

With no `store` argument, `passkeyRelyingParty()` builds a `TableCredentialStore` from the `store` setting. You can also put the settings in `boxlang.json` and call `passkeyRelyingParty()` with no arguments:

```json
"modules": {
	"bxPasskeys": {
		"settings": {
			"rpId": "example.com",
			"rpName": "Example",
			"origins": [ "https://example.com" ],
			"store": { "datasource": "app", "table": "passkey_credentials" }
		}
	}
}
```

The settings you're most likely to touch:

| Setting | Default | What it does |
|---|---|---|
| `rpId` | `"localhost"` | Your domain. |
| `rpName` | the rpId | The name shown in the browser's passkey sheet. |
| `origins` | `[]` | The exact origins sign-ins may come from. When it's empty, `https` on the rpId (any port) is allowed, plus plain `http` on `localhost`. |
| `userVerification` | `"preferred"` | Set it to `"required"` to refuse an authenticator that didn't check a PIN or biometric. |
| `maxPerUser` | `0` | The most passkeys one account may hold. `0` means no limit. |
| `challengeSeconds` | `300` | How long a challenge stays good. |

### Trying it locally

You don't need a database to try it out. Point the relying party at `localhost` and use the in-memory store:

```js
application.passkeys = passkeyRelyingParty(
	{ rpId: "localhost", rpName: "Passkey Demo", origins: [ "http://localhost:8080" ] },
	new bxModules.bxPasskeys.models.MemoryCredentialStore()
)
```

Browsers allow WebAuthn on `http://localhost` without TLS. Anywhere else you need HTTPS.

## Step 4: A couple of JSON helpers

The browser and the server talk JSON in both directions. The endpoints below are `.bxs` scripts, and each one includes these two helpers:

```js
// api/_json.bxs
function readJson() {
	var raw = toString( getHTTPRequestData().content )
	return isJSON( raw ) ? jsonDeserialize( raw ) : {}
}

function sendJson( required data, numeric status = 200 ) {
	bx:header statuscode=status;
	bx:content type="application/json" reset=true;
	writeOutput( jsonSerialize( data ) )
	abort;
}
```

If you use a framework like ColdBox or BoxExpress, use its request body and JSON response helpers instead. The passkey calls stay the same.

The examples assume your existing sign-in leaves the user in `session.user`, with an `id`, an `email` and a `name`.

## Step 5: Let a signed-in user add a passkey

Users add passkeys from their account settings, after they've signed in the usual way. That takes two endpoints.

The first returns creation options:

```js
// api/register-options.bxs
include "_json.bxs";
if ( isNull( session.user ) ) sendJson( { error: "Sign in first" }, 401 );
try {
	options = application.passkeys.registrationOptions(
		{ id: session.user.id, name: session.user.email, displayName: session.user.name },
		session
	)
	sendJson( options )
} catch ( "Passkeys.Invalid" e ) {
	sendJson( { error: e.message }, 400 )
}
```

`registrationOptions()` takes the user and your session struct. It saves the challenge in the session and returns a struct the browser can use as is. It also lists the user's existing passkeys under `excludeCredentials`, so the browser won't make a second one on the same device.

The user's `id` is your app's id for the user, such as a primary key. It's handed to the authenticator and stored on the device, so don't use an email address or a name. Those go in `name` and `displayName`, which are only shown in the passkey sheet. The id can be at most 64 bytes.

The second endpoint takes the browser's answer and saves the passkey:

```js
// api/register.bxs
include "_json.bxs";
if ( isNull( session.user ) ) sendJson( { error: "Sign in first" }, 401 );
try {
	credential = application.passkeys.register( { id: session.user.id }, session, readJson() )
	sendJson( { id: credential.credentialId, name: credential.name } )
} catch ( "Passkeys.Invalid" e ) {
	sendJson( { error: e.message }, 400 )
}
```

`register()` takes the challenge out of the session, so it works only once, and checks the answer before saving anything:

- The challenge matches, hasn't expired and was made for this same user.
- The answer came from an allowed origin and not from a cross-origin frame.
- The authenticator data is for your rpId and has the user-present flag.
- The public key uses one of the accepted algorithms (ES256, Ed25519 or RS256) and can be read.
- The passkey isn't already registered to someone else.

If any check fails, it throws `Passkeys.Invalid` with a message that's safe to show the user. A good answer returns the saved credential struct.

## Step 6: Sign in with a passkey

Sign-in needs two more endpoints, and neither needs a signed-in user.

```js
// api/signin-options.bxs
include "_json.bxs";
sendJson( application.passkeys.signInOptions( session ) )
```

Called with just the session, `signInOptions()` returns an empty `allowCredentials` list. The browser then offers any passkey it holds for your site, so the user doesn't type a username at all. That works because the module asks for *discoverable* credentials by default (`residentKey: "required"`).

The second endpoint checks the signature:

```js
// api/signin.bxs
include "_json.bxs";
try {
	result = application.passkeys.verify( session, readJson() )
} catch ( "Passkeys.Invalid" e ) {
	sendJson( { error: e.message }, 401 )
}
sessionRotate()
session.user = loadUser( result.userId )
sendJson( { signedIn: true } )
```

`verify()` returns a struct with `userId`, `credentialId`, `userVerified`, `signCount` and the full `credential`. Look the user up by `result.userId` (`loadUser()` stands in for your own lookup) and sign them in.

Call `sessionRotate()` before you put the user in the session. It gives the signed-in session a new id, so an id someone learned before sign-in is useless afterwards.

`verify()` checks the challenge, origin and rpId the same way registration does. It also checks:

- The signature over the authenticator data and the client data, using the stored public key.
- The signature counter. Many authenticators count their signatures. If the count stays put or goes backwards, the passkey has probably been copied, and the sign-in is refused. Most synced passkeys always send 0, which is allowed.
- The counter is saved only if it's still ahead of the stored one, in one atomic step. Two sign-ins that race with the same counter can't both get through.

Each challenge works once. If someone captures a sign-in answer and replays it, `verify()` refuses it, because that challenge is already gone from the session.

### Re-confirming before a sensitive action

To make a signed-in user confirm it's really them, before they change their email for example, pass their id:

```js
options = application.passkeys.signInOptions( session, session.user.id )
```

Only that user's passkeys are offered, and `verify()` refuses anyone else's.

## Step 7: List and remove passkeys

People lose phones, so let them see and remove their passkeys. The relying party gives you the store with `getStore()`:

```js
// api/passkeys.bxs
include "_json.bxs";
if ( isNull( session.user ) ) sendJson( { error: "Sign in first" }, 401 );
store = application.passkeys.getStore()
if ( getHTTPRequestData().method == "DELETE" ) {
	input = readJson()
	owned = store.listForUser( session.user.id ).some( ( c ) => compare( c.credentialId, input.id ) == 0 )
	if ( !owned ) sendJson( { error: "Not found" }, 404 );
	store.remove( input.id )
}
sendJson( store.listForUser( session.user.id ).map( ( c ) => {
	return { id: c.credentialId, name: c.name, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt ?: "" }
} ) )
```

Check that the passkey belongs to the signed-in user before you remove it. `store.remove()` takes any credential id, so without that check one user could remove another user's passkey. Use `compare()`, not `==`: BoxLang's `==` ignores case, and credential ids are case-sensitive.

## Step 8: The browser side

Copy `client/passkeys.js` from the module into your front end. It exports four functions:

- `passkeysSupported()` tells you whether the browser can use passkeys.
- `createPasskey( options )` runs registration and returns the answer to post back.
- `signWithPasskey( options )` runs sign-in and returns the answer to post back.
- `deviceName()` guesses a name for the new passkey, such as "Mac" or "iPhone". `createPasskey()` uses it by default.

Both `createPasskey()` and `signWithPasskey()` return `null` when the user closes the browser's sheet, so you can just stop there.

Here's a complete page:

```html
<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>Passkey demo</title>
</head>
<body>
	<h1>Passkey demo</h1>

	<section id="signed-out">
		<button id="passkey-sign-in">Sign in with a passkey</button>
	</section>

	<section id="signed-in" hidden>
		<button id="add-passkey">Add a passkey</button>
		<ul id="passkeys"></ul>
	</section>

	<p id="message"></p>

	<script type="module">
		import { createPasskey, signWithPasskey, passkeysSupported } from '/js/passkeys.js'

		const message = document.querySelector('#message')

		async function api(path, body, method = 'POST') {
			const response = await fetch(`/api/${path}`, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
			})
			const data = await response.json()
			if (!response.ok) throw new Error(data.error ?? 'Something went wrong')
			return data
		}

		async function showPasskeys() {
			const list = await api('passkeys.bxs', null, 'GET')
			document.querySelector('#signed-out').hidden = true
			document.querySelector('#signed-in').hidden = false
			document.querySelector('#passkeys').replaceChildren(...list.map((p) => {
				const item = document.createElement('li')
				item.textContent = `${p.name}, last used ${p.lastUsedAt || 'never'} `
				const remove = document.createElement('button')
				remove.textContent = 'Remove'
				remove.onclick = async () => { await api('passkeys.bxs', { id: p.id }, 'DELETE'); showPasskeys() }
				item.append(remove)
				return item
			}))
		}

		if (!passkeysSupported()) {
			message.textContent = "This browser can't use passkeys."
		}

		document.querySelector('#add-passkey').onclick = async () => {
			try {
				const registration = await createPasskey(await api('register-options.bxs'))
				if (!registration) return
				await api('register.bxs', registration)
				message.textContent = 'Passkey added.'
				showPasskeys()
			} catch (error) {
				message.textContent = error.message
			}
		}

		document.querySelector('#passkey-sign-in').onclick = async () => {
			try {
				const assertion = await signWithPasskey(await api('signin-options.bxs'))
				if (!assertion) return
				await api('signin.bxs', assertion)
				message.textContent = 'Signed in with a passkey.'
				showPasskeys()
			} catch (error) {
				message.textContent = error.message
			}
		}
	</script>
</body>
</html>
```

### Passkeys in the username field

Browsers can also offer passkeys in the autofill dropdown of a username field, without the user clicking a separate button. Add `webauthn` to the field's `autocomplete` attribute and start a *conditional* request when the page loads:

```html
<input name="email" type="email" autocomplete="username webauthn">
```

```js
const assertion = await signWithPasskey(await api('signin-options.bxs'), { mediation: 'conditional' })
if (assertion) await api('signin.bxs', assertion)
```

The second argument to `signWithPasskey()` is merged into the `navigator.credentials.get()` call. You can also pass an `AbortController`'s `signal` there, to cancel the pending request when the user signs in with a password instead.

## Step 9: Test it without a browser

WebAuthn is hard to test by hand, because every run needs a real authenticator. The module's test suite includes a `FakeAuthenticator` that makes real key pairs and signs the way a browser would. The module's `examples/flow.bxs` uses it to run the whole flow in one script:

```js
rp = passkeyRelyingParty( { rpId: "localhost", rpName: "Example" }, new bxModules.bxPasskeys.models.MemoryCredentialStore() )
browser = new tests.helpers.FakeAuthenticator( origin = "http://localhost:8080" )
user = { id: "1001", name: "alice@example.com", displayName: "Alice" }

// 1. Signed in some other way, Alice adds a passkey.
sessionData = {}
creationOptions = rp.registrationOptions( user, sessionData )
saved = rp.register( user, sessionData, browser.create( creationOptions ) )
println( "Added #saved.name# (#saved.credentialId#) for user #saved.userId#" )

// 2. Later, a fresh session signs in with it, no username needed.
sessionData = {}
requestOptions = rp.signInOptions( sessionData )
result = rp.verify( sessionData, browser.get( requestOptions ) )
println( "Signed in as user #result.userId#, verified: #result.userVerified#" )

// 3. A replayed answer is refused: the challenge was used up.
try {
	rp.verify( sessionData, browser.get( requestOptions ) )
} catch ( "Passkeys.Invalid" e ) {
	println( "Replay refused: #e.message#" )
}
```

Any struct works as `sessionData`, so you don't need a web server for this. The same approach works for testing your own handlers: copy `FakeAuthenticator.bx` into your test helpers and use its `create()` and `get()` in place of the browser.

When I pointed the fake authenticator at the demo endpoints over HTTP, the full run looked like this:

```text
POST register-options.bxs -> 200 OK
POST register.bxs         -> 200 OK {"id":"83VVjFfsU8zZmbDqPSWW8g","name":"Test key"}
POST signin-options.bxs   -> 200 OK
POST signin.bxs           -> 200 OK {"userId":"FF8D9819FC0E12BF","userVerified":true,"signedIn":true}
POST signin.bxs           -> 401    {"error":"That answer was already used, or never asked for. Try again."}
```

The second `signin.bxs` replays the first answer, and the server refuses it.

## Bring your own store

If your users already live somewhere, such as a table with its own naming conventions or a service behind an API, write your own store. It's a class that implements `bxModules.bxPasskeys.models.CredentialStore`:

```js
class implements="bxModules.bxPasskeys.models.CredentialStore" {

	function findByCredentialId( required string credentialId ) {}    // a credential struct, or null
	array function listForUser( required string userId ) {}           // newest first
	void function add( required struct credential ) {}
	boolean function updateUsage( required string credentialId, required numeric signCount, required date lastUsedAt ) {}
	boolean function remove( required string credentialId ) {}

}
```

Then pass it in: `passkeyRelyingParty( {}, new MyStore() )`.

A credential is a struct of `credentialId`, `userId`, `publicKey`, `algorithm`, `signCount`, `transports`, `name`, `createdAt` and `lastUsedAt`.

`updateUsage()` needs care. It must check and write in one step: save only while the new `signCount` is greater than the stored one (or both are 0), and return whether it saved. In SQL that's a guarded update. Here's what `TableCredentialStore` does:

```js
boolean function updateUsage( required string credentialId, required numeric signCount, required date lastUsedAt ) {
	var result = {}
	var params = [
		{ value: arguments.signCount, sqltype: "bigint" },
		{ value: arguments.lastUsedAt, sqltype: "timestamp" },
		{ value: arguments.credentialId, sqltype: "varchar" }
	]
	var guard = "sign_count = 0"
	if ( arguments.signCount > 0 ) {
		guard = "sign_count < ?"
		params.append( { value: arguments.signCount, sqltype: "bigint" } )
	}
	queryExecute(
		"UPDATE passkey_credentials SET sign_count = ?, last_used_at = ? WHERE credential_id = ? AND #guard#",
		params,
		{ datasource: "app", result: "result" }
	)
	return result.recordCount > 0
}
```

The `WHERE` clause does the check, so two sign-ins racing with the same counter can't both succeed: the second update matches no rows and returns `false`.

## Going to production

A short checklist:

- **Use HTTPS**, and set `origins` to your real origins, such as `[ "https://example.com" ]`.
- **Don't turn on `allowSubdomains`** if anyone else can serve pages on a subdomain of yours, such as user content or preview deploys. Such a page could relay sign-ins.
- **Protect the endpoints from CSRF** the way you protect your other POST routes.
- **Rotate the session** after a passkey sign-in, as in step 6.
- **Keep a fallback.** Let people sign in another way, such as email or a password, so losing a device doesn't lock them out. Then they can add a passkey on the new one.
- **Set `userVerification: "required"`** if a passkey alone, with no password, guards anything sensitive.

## What bx-passkeys leaves out

The module uses attestation `"none"`. It trusts the public key the authenticator sends and doesn't check who made the authenticator. That's what nearly every website wants. If you need to allow only specific hardware keys, as some enterprises do, you'd need attestation verification and the FIDO metadata service, which the module doesn't do. It also doesn't handle WebAuthn extensions.

## Wrapping up

Passkeys get rid of passwords without making sign-in harder. Users get a fingerprint prompt in place of a password field, and you no longer store anything worth stealing. With bx-passkeys, the server side is four method calls and a table.

- ForgeBox: `bx-passkeys`
- Source and issues: [github.com/robertz/bx-passkeys](https://github.com/robertz/bx-passkeys)

It's MIT licensed. Issues and pull requests are welcome.
