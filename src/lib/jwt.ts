/**
 * Decode a JWT payload without verifying the signature. Returns null for
 * anything that is not a three-part token with a JSON payload.
 */
export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !parts[1]) return null
    // JWTs are base64url-encoded; atob() throws on the `-`/`_` alphabet.
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * True when the token's `exp` claim is within 60 seconds of expiry. Tokens
 * without a decodable `exp` claim are treated as not expired.
 */
export function isJwtExpired(token: string): boolean {
  const payload = decodeJwt(token)
  const exp = typeof payload?.exp === 'number' ? payload.exp : undefined
  return typeof exp === 'number' && Date.now() >= exp * 1000 - 60_000
}
