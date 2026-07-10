import { useEffect, useRef } from 'react'

const CONFETTI_COLORS = ['#ffd56a', '#fff3bd', '#1ad7ff', '#56a8ff', '#ff4f5f', '#ff8b45', '#ffffff']
const MAX_PARTICLES = 480

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function drawStar(context, radius) {
  context.beginPath()
  for (let point = 0; point < 10; point += 1) {
    const angle = -Math.PI / 2 + (point * Math.PI) / 5
    const length = point % 2 === 0 ? radius : radius * 0.42
    const x = Math.cos(angle) * length
    const y = Math.sin(angle) * length
    if (point === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
  context.fill()
}

function createParticle(origin, direction, power, width, height) {
  const angle = direction === 'left'
    ? randomBetween(-1.24, -0.7)
    : randomBetween(-2.44, -1.9)
  const speed = randomBetween(9, 19) * power
  const isStar = Math.random() < 0.11

  return {
    x: direction === 'left' ? Math.max(18, width * 0.06) : Math.min(width - 18, width * 0.94),
    y: Math.min(height - 20, origin.y),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    gravity: randomBetween(0.19, 0.31),
    drag: randomBetween(0.982, 0.992),
    rotation: randomBetween(0, Math.PI * 2),
    spin: randomBetween(-0.24, 0.24),
    width: isStar ? randomBetween(5, 8) : randomBetween(4, 8),
    height: isStar ? randomBetween(5, 8) : randomBetween(10, 20),
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    life: randomBetween(115, 185),
    maxLife: 185,
    wave: randomBetween(0, Math.PI * 2),
    isStar,
  }
}

export default function ChampionConfetti({ burst }) {
  const canvasRef = useRef(null)
  const frameRef = useRef(0)
  const drawFrameRef = useRef(null)
  const particlesRef = useRef([])
  const sizeRef = useRef({ width: 0, height: 0 })
  const reducedMotionRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return undefined

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotionPreference = () => {
      reducedMotionRef.current = media.matches
    }
    updateMotionPreference()

    const resize = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      sizeRef.current = { width, height }
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const render = () => {
      const { width, height } = sizeRef.current
      context.clearRect(0, 0, width, height)

      particlesRef.current = particlesRef.current.filter((particle) => {
        particle.vx *= particle.drag
        particle.vy = particle.vy * particle.drag + particle.gravity
        particle.x += particle.vx
        particle.y += particle.vy
        particle.rotation += particle.spin
        particle.wave += 0.08
        particle.life -= 1

        if (particle.life <= 0 || particle.y > height + 40) return false

        const alpha = Math.min(1, particle.life / 28)
        const flip = Math.max(0.16, Math.abs(Math.cos(particle.wave)))
        context.save()
        context.globalAlpha = alpha
        context.translate(particle.x, particle.y)
        context.rotate(particle.rotation)
        context.fillStyle = particle.color
        context.shadowColor = particle.color
        context.shadowBlur = particle.isStar ? 8 : 2
        if (particle.isStar) drawStar(context, particle.width)
        else context.fillRect(-particle.width / 2, -particle.height / 2, particle.width * flip, particle.height)
        context.restore()
        return true
      })

      if (particlesRef.current.length > 0) frameRef.current = window.requestAnimationFrame(render)
      else frameRef.current = 0
    }
    drawFrameRef.current = render

    resize()
    window.addEventListener('resize', resize)
    media.addEventListener?.('change', updateMotionPreference)

    return () => {
      window.removeEventListener('resize', resize)
      media.removeEventListener?.('change', updateMotionPreference)
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
      drawFrameRef.current = null
      particlesRef.current = []
    }
  }, [])

  useEffect(() => {
    if (!burst?.id) return
    const { width, height } = sizeRef.current
    if (!width || !height) return

    const mobile = width < 680
    const reduced = reducedMotionRef.current
    const baseAmount = reduced ? 18 : mobile ? 62 : 96
    const directions = burst.side === 'both' ? ['left', 'right'] : [burst.side]
    const particles = particlesRef.current

    for (const direction of directions) {
      for (let index = 0; index < baseAmount; index += 1) {
        particles.push(createParticle({ y: height * 0.94 }, direction, burst.power || 1, width, height))
      }
    }

    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES)
    if (!frameRef.current && drawFrameRef.current) {
      frameRef.current = window.requestAnimationFrame(drawFrameRef.current)
    }
  }, [burst])

  return <canvas ref={canvasRef} className="champion-confetti-canvas" aria-hidden="true" />
}
