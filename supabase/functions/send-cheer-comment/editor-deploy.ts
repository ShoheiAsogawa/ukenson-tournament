// Supabase Dashboard > Edge Functions > Deploy a new function > Via Editor
// Function name: send-cheer-comment
// Verify JWT: OFF

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type RateBucket = { count: number; resetAt: number }
const rateBuckets = new Map<string, RateBucket>()

function rateLimit(key: string, limit: number, windowMs: number): boolean {
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

function clientKey(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

const MAX_COMMENT_CODEPOINTS = 20
const RETENTION_MS = 2 * 60 * 60 * 1000
const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/
const ZERO_WIDTH_STRIP = /[\u200B-\u200D\uFEFF]/g
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g
const BLOCKED_PATTERNS = [
  'しね', '死ね', '殺す', 'ころせ', '殺せ', 'きえろ', '消えろ', 'かえれ', '帰れ',
  'きもい', 'きしょい', 'うざい', 'ぶす', 'でぶ', 'はげ', 'ちんこ', 'ちんぽ', 'まんこ',
  'せっくす', 'ふぁっく', 'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot', 'kys',
  'killyourself', 'http://', 'https://', 'www.',
]

function foldKatakana(value: string): string {
  return value.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

function buildNormalizedIndex(value: string): { normalized: string; map: number[] } {
  const map: number[] = []
  let normalized = ''
  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index)!
    const charLength = codePoint > 0xffff ? 2 : 1
    let chunk = String.fromCodePoint(codePoint).normalize('NFKC').toLowerCase()
    if (ZERO_WIDTH_CHARS.test(chunk)) {
      index += charLength
      continue
    }
    if (/^\s$/.test(chunk)) {
      index += charLength
      continue
    }
    chunk = foldKatakana(chunk)
    for (let chunkIndex = 0; chunkIndex < chunk.length; ) {
      const chunkCodePoint = chunk.codePointAt(chunkIndex)!
      const chunkCharLength = chunkCodePoint > 0xffff ? 2 : 1
      const char = String.fromCodePoint(chunkCodePoint)
      if (!/\s/.test(char)) {
        normalized += char
        map.push(index)
      }
      chunkIndex += chunkCharLength
    }
    index += charLength
  }
  return { normalized, map }
}

function maskBlockedWords(value: string): string {
  const text = value.replace(ZERO_WIDTH_STRIP, '')
  const { normalized, map } = buildNormalizedIndex(text)
  const maskIndices = new Set<number>()
  for (const pattern of BLOCKED_PATTERNS) {
    let searchFrom = 0
    while (searchFrom < normalized.length) {
      const matchIndex = normalized.indexOf(pattern, searchFrom)
      if (matchIndex === -1) break
      for (let offset = 0; offset < pattern.length; offset += 1) {
        maskIndices.add(map[matchIndex + offset])
      }
      searchFrom = matchIndex + 1
    }
  }
  if (maskIndices.size === 0) return text
  let masked = ''
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)!
    const charLength = codePoint > 0xffff ? 2 : 1
    masked += maskIndices.has(index) ? '*' : text.slice(index, index + charLength)
    index += charLength
  }
  return masked
}

function sanitizeBody(value: unknown): string {
  return String(value ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(ZERO_WIDTH_STRIP, '')
    .replace(/\s+/g, ' ')
    .trim()
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)

  const requestClientKey = clientKey(request)
  if (!rateLimit(`cheer-venue:${requestClientKey}`, 900, 60_000)) {
    return jsonResponse({ ok: false, error: 'rate_limited' }, 429)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: 'server_not_configured' }, 500)
  }

  try {
    const requestBody = await request.json()
    const id = String(requestBody?.id || '')
    const rawBody = requestBody?.body
    if (typeof rawBody !== 'string' || rawBody.length > 400) {
      return jsonResponse({ ok: false, error: 'bad_request' }, 400)
    }
    const body = sanitizeBody(rawBody)
    const maskedBody = maskBlockedWords(body)
    const cheerClientId = String(requestBody?.clientId || '')

    if (
      !id ||
      id.length > 128 ||
      !body ||
      [...body].length > MAX_COMMENT_CODEPOINTS ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(cheerClientId)
    ) {
      return jsonResponse({ ok: false, error: 'bad_request' }, 400)
    }
    if (!rateLimit(`cheer-device:${requestClientKey}:${cheerClientId}`, 10, 60_000)) {
      return jsonResponse({ ok: false, error: 'rate_limited' }, 429)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: tournament, error: tournamentError } = await supabase
      .from('tournament_states')
      .select('payload')
      .eq('id', id)
      .maybeSingle()

    if (tournamentError) return jsonResponse({ ok: false, error: tournamentError.message }, 500)
    if (!tournament) return jsonResponse({ ok: false, error: 'tournament_not_found' }, 404)
    if (tournament.payload?.cheerCommentsEnabled === false) {
      return jsonResponse({ ok: false, error: 'comments_disabled' }, 403)
    }

    if (Math.random() < 0.1) {
      await supabase
        .from('cheer_comments')
        .delete()
        .eq('tournament_id', id)
        .lt('created_at', new Date(Date.now() - RETENTION_MS).toISOString())
    }

    const { data: inserted, error } = await supabase
      .from('cheer_comments')
      .insert({ tournament_id: id, body: maskedBody })
      .select('id, body, created_at')
      .single()

    if (error) return jsonResponse({ ok: false, error: error.message }, 500)
    return jsonResponse({
      ok: true,
      comment: { id: inserted.id, body: inserted.body, at: inserted.created_at },
    })
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400)
  }
})
