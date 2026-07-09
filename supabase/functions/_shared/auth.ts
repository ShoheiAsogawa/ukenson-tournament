const encoder = new TextEncoder()

export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  const length = Math.max(left.length, right.length)
  let mismatch = left.length === right.length ? 0 : 1
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return mismatch === 0
}

function toBase64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function hmacSign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return toBase64Url(signature)
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export async function createSessionToken(adminPin: string): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS
  const payload = `v1.${exp}`
  const signature = await hmacSign(adminPin, payload)
  return `${payload}.${signature}`
}

export async function verifySessionToken(adminPin: string, token: string): Promise<boolean> {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return false
  const exp = Number(parts[1])
  if (!Number.isFinite(exp) || Date.now() > exp) return false
  const payload = `${parts[0]}.${parts[1]}`
  const expected = await hmacSign(adminPin, payload)
  return timingSafeEqual(parts[2], expected)
}

export async function authorizeAdmin(
  adminPin: string,
  { pin, sessionToken }: { pin?: unknown; sessionToken?: unknown },
): Promise<boolean> {
  if (sessionToken && (await verifySessionToken(adminPin, String(sessionToken)))) return true
  if (pin != null && timingSafeEqual(String(pin), adminPin)) return true
  return false
}

type RateBucket = { count: number; resetAt: number }

const rateBuckets = new Map<string, RateBucket>()

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const current = rateBuckets.get(key)
  if (!current || now >= current.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (current.count >= limit) return false
  current.count += 1
  return true
}

export function clientKey(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function validateTournamentPayload(payload: unknown): string | null {
  if (!isPlainObject(payload)) return 'payload_not_object'
  if (!Array.isArray(payload.players)) return 'players_not_array'
  if (payload.players.length > 128) return 'players_too_many'
  if (!isPlainObject(payload.results)) return 'results_not_object'
  if (Object.keys(payload.results).length > 512) return 'results_too_many'
  if (payload.tableAssignments != null && !isPlainObject(payload.tableAssignments)) {
    return 'table_assignments_not_object'
  }
  if (payload.tableCount != null) {
    const tableCount = Number(payload.tableCount)
    if (!Number.isInteger(tableCount) || tableCount < 1 || tableCount > 32) return 'bad_table_count'
  }
  return null
}
