/**
 * The browser half of bx-passkeys: the server's options in, navigator.credentials
 * out, every binary field base64url both ways. Written out rather than with
 * PublicKeyCredential.parse*FromJSON and toJSON(), which older Safari and Firefox lack.
 */

export function passkeysSupported() {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials
}

function toBase64url(buffer) {
  let text = ''
  for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(value) {
  const text = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4))
  return Uint8Array.from(text, (c) => c.charCodeAt(0))
}

function descriptors(list = []) {
  return list.map((c) => ({ type: c.type, id: fromBase64url(c.id), transports: c.transports }))
}

/** The kind of device the passkey was made on, as a default name for it. */
export function deviceName() {
  const agent = navigator.userAgent
  if (/iPhone/.test(agent)) return 'iPhone'
  if (/iPad/.test(agent)) return 'iPad'
  if (/Android/.test(agent)) return 'Android'
  if (/Mac OS X/.test(agent)) return 'Mac'
  if (/Windows/.test(agent)) return 'Windows'
  if (/Linux/.test(agent)) return 'Linux'
  return 'Passkey'
}

/** Makes a passkey from RelyingParty.registrationOptions(); null when the person cancels. */
export async function createPasskey(options, name = deviceName()) {
  const credential = await navigator.credentials
    .create({
      publicKey: {
        ...options,
        challenge: fromBase64url(options.challenge),
        user: { ...options.user, id: fromBase64url(options.user.id) },
        excludeCredentials: descriptors(options.excludeCredentials),
      },
    })
    .catch(cancelled)
  if (!credential) return null
  const response = credential.response
  const answer = {
    id: credential.id,
    clientDataJSON: toBase64url(response.clientDataJSON),
    attestationObject: toBase64url(response.attestationObject),
    transports: response.getTransports?.() ?? [],
    name,
  }
  // Older browsers lack these; the server then reads the key from attestationObject.
  const publicKey = response.getPublicKey?.()
  if (publicKey) {
    answer.publicKey = toBase64url(publicKey)
    answer.publicKeyAlgorithm = response.getPublicKeyAlgorithm()
  }
  if (response.getAuthenticatorData) answer.authenticatorData = toBase64url(response.getAuthenticatorData())
  return answer
}

/** Signs RelyingParty.signInOptions()' challenge; null when the person cancels. */
export async function signWithPasskey(options, extra = {}) {
  const credential = await navigator.credentials
    .get({
      ...extra,
      publicKey: { ...options, challenge: fromBase64url(options.challenge), allowCredentials: descriptors(options.allowCredentials) },
    })
    .catch(cancelled)
  if (!credential) return null
  const response = credential.response
  const answer = {
    id: credential.id,
    clientDataJSON: toBase64url(response.clientDataJSON),
    authenticatorData: toBase64url(response.authenticatorData),
    signature: toBase64url(response.signature),
  }
  if (response.userHandle) answer.userHandle = toBase64url(response.userHandle)
  return answer
}

/** Closing the browser's sheet is a choice, not an error; a device that already holds one of the passkeys says so. */
function cancelled(error) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return null
  if (error instanceof DOMException && error.name === 'AbortError') return null
  if (error instanceof DOMException && error.name === 'InvalidStateError') throw new Error('This device already has a passkey for your account.')
  throw error
}
