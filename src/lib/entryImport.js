const NAME_HEADERS = [
  'プレイヤーネーム',
  'プレイヤー名',
  '選手名',
  '参加名',
  'ハンドルネーム',
  'ニックネーム',
  '表示名',
  '名前',
  '氏名',
  'お名前',
  'name',
  'player',
  'gamertag',
]

const EXCLUDE_WORDS = ['キャンセル', '辞退', '不参加', '欠席', '取り消し']

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || ''
  const commaCount = (firstLine.match(/,/g) || []).length
  const tabCount = (firstLine.match(/\t/g) || []).length
  return tabCount > commaCount ? '\t' : ','
}

function parseRows(text, delimiter) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (char === '"' && quoted && nextChar === '"') {
      value += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === delimiter && !quoted) {
      row.push(value.trim())
      value = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && nextChar === '\n') index += 1
      row.push(value.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      value = ''
    } else {
      value += char
    }
  }

  row.push(value.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

function normalizeHeader(header) {
  return header.toLowerCase().replace(/\s+/g, '')
}

function findNameIndex(headers) {
  const normalizedHeaders = headers.map(normalizeHeader)
  const exactIndex = normalizedHeaders.findIndex((header) =>
    NAME_HEADERS.some((candidate) => header === normalizeHeader(candidate)),
  )
  if (exactIndex >= 0) return exactIndex

  const partialIndex = normalizedHeaders.findIndex((header) =>
    NAME_HEADERS.some((candidate) => header.includes(normalizeHeader(candidate))),
  )
  return partialIndex >= 0 ? partialIndex : 0
}

export function parseEntryText(text) {
  const cleanedText = text.trim()
  if (!cleanedText) return { entries: [], headers: [], nameIndex: 0 }

  const delimiter = detectDelimiter(cleanedText)
  const rows = parseRows(cleanedText, delimiter)
  if (!rows.length) return { entries: [], headers: [], nameIndex: 0 }

  const headers = rows[0]
  const nameIndex = findNameIndex(headers)
  const seen = new Set()
  const entries = rows
    .slice(1)
    .map((row, index) => {
      const name = (row[nameIndex] || '').trim()
      return {
        id: `entry-${index + 1}`,
        name,
        row,
      }
    })
    .filter((entry) => entry.name && !EXCLUDE_WORDS.some((word) => entry.row.join(' ').includes(word)))
    .filter((entry) => {
      const key = entry.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return { entries, headers, nameIndex }
}
