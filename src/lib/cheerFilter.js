const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/
const ZERO_WIDTH_STRIP = /[\u200B-\u200D\uFEFF]/g

export const BLOCKED_PATTERNS = [
  'しね',
  '死ね',
  '殺す',
  'ころせ',
  '殺せ',
  'きえろ',
  '消えろ',
  'かえれ',
  '帰れ',
  'きもい',
  'きしょい',
  'うざい',
  'ぶす',
  'でぶ',
  'はげ',
  'ちんこ',
  'ちんぽ',
  'まんこ',
  'せっくす',
  'ふぁっく',
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'faggot',
  'kys',
  'killyourself',
  'http://',
  'https://',
  'www.',
]

function foldKatakana(value) {
  return value.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

function buildNormalizedIndex(value) {
  const map = []
  let normalized = ''

  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index)
    const charLength = codePoint > 0xffff ? 2 : 1
    let chunk = String.fromCodePoint(codePoint).normalize('NFKC').toLowerCase()

    // Avoid RegExp#test with /g — lastIndex makes every other match flip-flop.
    if (ZERO_WIDTH_RE.test(chunk)) {
      index += charLength
      continue
    }
    if (/^\s$/.test(chunk)) {
      index += charLength
      continue
    }

    chunk = foldKatakana(chunk)
    for (let chunkIndex = 0; chunkIndex < chunk.length; ) {
      const chunkCodePoint = chunk.codePointAt(chunkIndex)
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

export function maskBlockedWords(value) {
  const text = String(value ?? '').replace(ZERO_WIDTH_STRIP, '')
  const { normalized, map } = buildNormalizedIndex(text)
  const maskIndices = new Set()

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
    const codePoint = text.codePointAt(index)
    const charLength = codePoint > 0xffff ? 2 : 1
    masked += maskIndices.has(index) ? '*' : text.slice(index, index + charLength)
    index += charLength
  }
  return masked
}
