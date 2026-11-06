export interface CredentialDescriptor {
  type: 'public-key'
  id: string
  transports: AuthenticatorTransport[]
}

export interface CreationOptions {
  challenge: string
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: { type: 'public-key'; alg: number }[]
  timeout: number
  attestation: AttestationConveyancePreference
  authenticatorSelection: AuthenticatorSelectionCriteria
  excludeCredentials: CredentialDescriptor[]
}

export interface RequestOptions {
  challenge: string
  rpId: string
  timeout: number
  userVerification: UserVerificationRequirement
  allowCredentials: CredentialDescriptor[]
}

export interface Registration {
  id: string
  clientDataJSON: string
  attestationObject: string
  authenticatorData?: string
  publicKey?: string
  publicKeyAlgorithm?: number
  transports: string[]
  name: string
}

export interface Assertion {
  id: string
  clientDataJSON: string
  authenticatorData: string
  signature: string
  userHandle?: string
}

export function passkeysSupported(): boolean
export function deviceName(): string
export function createPasskey(options: CreationOptions, name?: string): Promise<Registration | null>
/** `extra` is merged into the credentials.get() call, e.g. { mediation: 'conditional', signal }. */
export function signWithPasskey(options: RequestOptions, extra?: Omit<CredentialRequestOptions, 'publicKey'>): Promise<Assertion | null>
