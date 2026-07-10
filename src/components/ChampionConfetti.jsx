import { useEffect, useRef } from 'react'

const CONFETTI_COLORS = ['#ffd56a', '#fff3bd', '#1ad7ff', '#56a8ff', '#ff4f5f', '#ff8b45', '#ffffff']
const MAX_PARTICLES = 120

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function createParticle(direction, width, height) {
  const angle = direction === 'left'
    ? randomBetween(-1.2, -0.72)
    : randomBetween(-2.42, -1.94)
  const speed = randomBetween(9, 16)

  return {
    x: direction === 'left' ? width * 0.04 : width * 0.96,
    y: height * 0.96,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    gravity: randomBetween(0.23, 0.31),
    drag: 0.988,
    rotation: randomBetween(0, Math.PI * 2),
    spin: randomBetween(-0.18, 0.18),
    width: randomBetween(4, 7),
    height: randomBetween(9, 16),
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    life: randomBetween(78, 112),
  }
}

export default function ChampionConfetti() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d', { alpha: true })
    if (!canvas || !context) return undefined

    const particles = []
    let frameId = 0
    let width = 0
    let height = 0

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width
      canvas.height = height
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }

    const render = () => {
      context.clearRect(0, 0, width, height)
      let activeCount = 0

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index]
        particle.vx *= particle.drag
        particle.vy = particle.vy * particle.drag + particle.gravity
        particle.x += particle.vx
        particle.y += particle.vy
        particle.rotation += particle.spin
        particle.life -= 1

        if (particle.life <= 0 || particle.y > height + 24) continue

        particles[activeCount] = particle
        activeCount += 1
        context.save()
        context.globalAlpha = Math.min(1, particle.life / 18)
        context.translate(particle.x, particle.y)
        context.rotate(particle.rotation)
        context.fillStyle = particle.color
        context.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height)
        context.restore()
      }

      particles.length = activeCount
      frameId = activeCount > 0 ? window.requestAnimationFrame(render) : 0
    }

    const launch = (direction = null, amount = null) => {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const amountPerSide = amount ?? (reducedMotion ? 8 : width < 680 ? 24 : 30)
      const directions = direction ? [direction] : ['left', 'right']
      for (const launchDirection of directions) {
        for (let index = 0; index < amountPerSide; index += 1) {
          particles.push(createParticle(launchDirection, width, height))
        }
      }
      if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES)
      if (!frameId) frameId = window.requestAnimationFrame(render)
    }

    const handlePointerDown = (event) => {
      if (event.target instanceof Element && event.target.closest('.champion-close')) return
      const direction = event.clientX < width / 2 ? 'left' : 'right'
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      launch(direction, reducedMotion ? 4 : width < 680 ? 12 : 16)
    }

    resize()
    window.addEventListener('resize', resize)
    canvas.parentElement?.addEventListener('pointerdown', handlePointerDown, { passive: true })
    const launchTimer = window.setTimeout(launch, 180)

    return () => {
      window.removeEventListener('resize', resize)
      canvas.parentElement?.removeEventListener('pointerdown', handlePointerDown)
      window.clearTimeout(launchTimer)
      if (frameId) window.cancelAnimationFrame(frameId)
    }
  }, [])

  return <canvas ref={canvasRef} className="champion-confetti-canvas" aria-hidden="true" />
}
