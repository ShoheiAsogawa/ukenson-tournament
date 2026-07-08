import templateSrc from '../assets/brand/sns-result-template.png'

const CARD_WIDTH = 1080
const CARD_HEIGHT = 1920

const FONT_JP = '"Noto Sans JP", "Yu Gothic", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif'

// Overlay coordinates measured on the 1080x1920 template
// (src/assets/brand/sns-result-template.png).
const LAYOUT = {
  panels: {
    blue: { cx: 270, nameBaseline: 930, maxWidth: 360 },
    red: { cx: 815, nameBaseline: 930, maxWidth: 360 },
    crownCy: 800,
    labelBaseline: 1060,
  },
  laurel: { cx: 540, labelBaseline: 1345, nameBaseline: 1428, maxWidth: 400 },
  matchBox: { textX: 232, labelBaseline: 1584, valueBaseline: 1640, maxWidth: 240 },
  roundBox: { textX: 646, labelBaseline: 1584, valueBaseline: 1640, maxWidth: 310 },
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

async function ensureFonts() {
  if (!document.fonts?.load) return
  try {
    await Promise.all([
      document.fonts.load(`900 72px ${FONT_JP}`),
      document.fonts.load(`700 30px ${FONT_JP}`),
    ])
  } catch {
    // fall back to system fonts
  }
}

// Shrink the font size until the text fits maxWidth.
function fitFontSize(ctx, text, maxWidth, baseSize, weight = 900) {
  let size = baseSize
  while (size > 18) {
    ctx.font = `${weight} ${size}px ${FONT_JP}`
    if (ctx.measureText(text).width <= maxWidth) return size
    size -= 2
  }
  return size
}

function drawGlowText(ctx, text, x, baseline, { size, weight = 900, fill = '#ffffff', glow, blur = 22, align = 'center' }) {
  ctx.save()
  ctx.textAlign = align
  ctx.font = `${weight} ${size}px ${FONT_JP}`
  if (glow) {
    ctx.shadowColor = glow
    ctx.shadowBlur = blur
  }
  ctx.fillStyle = fill
  ctx.fillText(text, x, baseline)
  if (glow) ctx.fillText(text, x, baseline) // second pass strengthens the glow
  ctx.restore()
}

function drawCrown(ctx, cx, cy, s = 1) {
  ctx.save()
  const gradient = ctx.createLinearGradient(cx, cy - 42 * s, cx, cy + 36 * s)
  gradient.addColorStop(0, '#ffedb3')
  gradient.addColorStop(0.55, '#ffc84f')
  gradient.addColorStop(1, '#d98f16')
  ctx.fillStyle = gradient
  ctx.shadowColor = 'rgba(255,196,77,0.95)'
  ctx.shadowBlur = 26 * s

  ctx.beginPath()
  ctx.moveTo(cx - 46 * s, cy + 22 * s)
  ctx.lineTo(cx - 52 * s, cy - 26 * s)
  ctx.lineTo(cx - 24 * s, cy + 2 * s)
  ctx.lineTo(cx, cy - 40 * s)
  ctx.lineTo(cx + 24 * s, cy + 2 * s)
  ctx.lineTo(cx + 52 * s, cy - 26 * s)
  ctx.lineTo(cx + 46 * s, cy + 22 * s)
  ctx.closePath()
  ctx.fill()

  ctx.fillRect(cx - 46 * s, cy + 28 * s, 92 * s, 10 * s)

  for (const [tx, ty] of [[-52, -26], [0, -40], [52, -26]]) {
    ctx.beginPath()
    ctx.arc(cx + tx * s, cy + (ty - 7) * s, 6 * s, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export async function renderShareCard({ match }) {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')

  await ensureFonts()
  const template = await loadImage(templateSrc)
  ctx.drawImage(template, 0, 0, CARD_WIDTH, CARD_HEIGHT)

  const blueName = match.playerA?.name || 'PLAYER 1'
  const redName = match.playerB?.name || 'PLAYER 2'
  const winnerIsBlue = match.winnerId === match.playerA?.id
  const winner = winnerIsBlue ? match.playerA : match.playerB
  const winnerName = winner?.name || 'WINNER'

  // Player names inside the blue / red frames.
  const { panels } = LAYOUT
  const blueSize = fitFontSize(ctx, blueName, panels.blue.maxWidth, 68)
  drawGlowText(ctx, blueName, panels.blue.cx, panels.blue.nameBaseline, {
    size: blueSize,
    glow: 'rgba(60,180,255,0.95)',
    blur: 26,
  })
  const redSize = fitFontSize(ctx, redName, panels.red.maxWidth, 68)
  drawGlowText(ctx, redName, panels.red.cx, panels.red.nameBaseline, {
    size: redSize,
    glow: 'rgba(255,70,80,0.95)',
    blur: 26,
  })

  // Scores under each name.
  const blueScore = match.scoreA === '' ? null : match.scoreA
  const redScore = match.scoreB === '' ? null : match.scoreB
  if (blueScore !== null && redScore !== null) {
    drawGlowText(ctx, String(blueScore), panels.blue.cx, panels.labelBaseline, {
      size: 84,
      fill: winnerIsBlue ? '#ffffff' : 'rgba(255,255,255,0.55)',
      glow: winnerIsBlue ? 'rgba(60,180,255,0.9)' : null,
    })
    drawGlowText(ctx, String(redScore), panels.red.cx, panels.labelBaseline, {
      size: 84,
      fill: winnerIsBlue ? 'rgba(255,255,255,0.55)' : '#ffffff',
      glow: winnerIsBlue ? null : 'rgba(255,70,80,0.9)',
    })
  }

  // Crown above the winner's name.
  const crownCx = winnerIsBlue ? panels.blue.cx : panels.red.cx
  drawCrown(ctx, crownCx, panels.crownCy, 1)

  // Winner callout between the gold laurels.
  const { laurel } = LAYOUT
  drawGlowText(ctx, '勝  者', laurel.cx, laurel.labelBaseline, {
    size: 34,
    weight: 800,
    fill: '#ffd97a',
    glow: 'rgba(255,196,77,0.8)',
    blur: 18,
  })
  const laurelSize = fitFontSize(ctx, winnerName, laurel.maxWidth, 64)
  drawGlowText(ctx, winnerName, laurel.cx, laurel.nameBaseline, {
    size: laurelSize,
    fill: '#ffe9b0',
    glow: 'rgba(255,196,77,0.95)',
    blur: 28,
  })

  // Bottom-left box (target icon): match number.
  const { matchBox } = LAYOUT
  drawGlowText(ctx, '試合番号', matchBox.textX, matchBox.labelBaseline, {
    size: 26,
    weight: 700,
    fill: 'rgba(190,225,255,0.85)',
    align: 'left',
  })
  const matchText = match.label || 'MATCH'
  const matchSize = fitFontSize(ctx, matchText, matchBox.maxWidth, 46)
  drawGlowText(ctx, matchText, matchBox.textX, matchBox.valueBaseline, {
    size: matchSize,
    glow: 'rgba(60,180,255,0.8)',
    blur: 16,
    align: 'left',
  })

  // Bottom-right box (trophy icon): round name.
  const { roundBox } = LAYOUT
  drawGlowText(ctx, 'ラウンド', roundBox.textX, roundBox.labelBaseline, {
    size: 26,
    weight: 700,
    fill: 'rgba(255,215,215,0.85)',
    align: 'left',
  })
  const rawTitle = match.roundTitle || match.name || 'ROUND'
  const roundText =
    match.side === 'finals' || rawTitle.includes('側')
      ? rawTitle
      : match.side === 'winners'
        ? `勝者側 ${rawTitle}`
        : match.side === 'losers'
          ? `敗者側 ${rawTitle}`
          : rawTitle
  const roundSize = fitFontSize(ctx, roundText, roundBox.maxWidth, 40)
  drawGlowText(ctx, roundText, roundBox.textX, roundBox.valueBaseline, {
    size: roundSize,
    glow: 'rgba(255,70,80,0.8)',
    blur: 16,
    align: 'left',
  })

  return canvas.toDataURL('image/png')
}

export async function downloadShareCard(dataUrl, filename) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  link.click()
}

async function shareShareCardFile(dataUrl, filename, title) {
  try {
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    const file = new File([blob], filename, { type: 'image/png' })
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title })
      return true
    }
  } catch {
    return false
  }
  return false
}

export async function shareOrDownloadShareCard(dataUrl, filename, title) {
  if (await shareShareCardFile(dataUrl, filename, title)) return 'shared'
  await downloadShareCard(dataUrl, filename)
  return 'downloaded'
}

export async function saveShareCardForDevice(dataUrl, filename, title) {
  if (await shareShareCardFile(dataUrl, filename, title)) return 'shared'
  await downloadShareCard(dataUrl, filename)
  return 'downloaded'
}

export function shareCardFilename(match) {
  const safe = (value) =>
    String(value || 'match')
      .replace(/[^\w぀-ヿ㐀-鿿-]+/g, '-')
      .slice(0, 40)
  return `ukenson-${safe(match.label)}-${safe(match.playerA?.name)}-vs-${safe(match.playerB?.name)}.png`
}
