import React, { useEffect, useRef } from "react"

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  alpha: number
  targetAlpha: number
  hue: number
}

interface HiggsfieldAuraProps {
  isReducedMotion: boolean
}

export function HiggsfieldAura({ isReducedMotion }: HiggsfieldAuraProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || isReducedMotion) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animationFrameId: number
    let width = (canvas.width = canvas.parentElement?.clientWidth ?? window.innerWidth)
    let height = (canvas.height = canvas.parentElement?.clientHeight ?? window.innerHeight)

    const mouse = { x: width / 2, y: height / 3, isHovered: false }

    const handleResize = () => {
      if (!canvas || !canvas.parentElement) return
      width = canvas.width = canvas.parentElement.clientWidth
      height = canvas.height = canvas.parentElement.clientHeight
    }
    window.addEventListener("resize", handleResize)

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.y = e.clientY - rect.top
      mouse.isHovered = true
    }

    const handleMouseLeave = () => {
      mouse.isHovered = false
    }

    canvas.parentElement?.addEventListener("mousemove", handleMouseMove)
    canvas.parentElement?.addEventListener("mouseleave", handleMouseLeave)

    const particleCount = Math.min(Math.floor((width * height) / 18000), 65)
    const particles: Particle[] = []

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        radius: Math.random() * 1.8 + 1.2,
        alpha: Math.random() * 0.5 + 0.2,
        targetAlpha: Math.random() * 0.7 + 0.2,
        hue: Math.random() > 0.4 ? 275 : 190, // Violet or Cyan
      })
    }

    const render = () => {
      ctx.clearRect(0, 0, width, height)

      // Ambient nebula glow around pointer
      if (mouse.isHovered) {
        const radGrad = ctx.createRadialGradient(
          mouse.x,
          mouse.y,
          0,
          mouse.x,
          mouse.y,
          320
        )
        radGrad.addColorStop(0, "rgba(168, 85, 247, 0.16)")
        radGrad.addColorStop(0.5, "rgba(34, 211, 238, 0.05)")
        radGrad.addColorStop(1, "rgba(0, 0, 0, 0)")
        ctx.fillStyle = radGrad
        ctx.fillRect(0, 0, width, height)
      }

      // Update & Draw Particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]

        p.x += p.vx
        p.y += p.vy

        // Wrap boundaries
        if (p.x < 0) p.x = width
        else if (p.x > width) p.x = 0
        if (p.y < 0) p.y = height
        else if (p.y > height) p.y = 0

        // Gentle interactive pull to pointer
        if (mouse.isHovered) {
          const dx = mouse.x - p.x
          const dy = mouse.y - p.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 180 && dist > 10) {
            const force = (180 - dist) / 180
            p.x += (dx / dist) * force * 0.35
            p.y += (dy / dist) * force * 0.35
          }
        }

        // Pulse alpha
        p.alpha += (p.targetAlpha - p.alpha) * 0.02
        if (Math.abs(p.targetAlpha - p.alpha) < 0.05) {
          p.targetAlpha = Math.random() * 0.7 + 0.2
        }

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${p.hue}, 85%, 65%, ${p.alpha})`
        ctx.shadowBlur = 10
        ctx.shadowColor = `hsla(${p.hue}, 90%, 60%, 0.8)`
        ctx.fill()
        ctx.shadowBlur = 0

        // Connect nearby particles with filaments
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j]
          const dx = p.x - p2.x
          const dy = p.y - p2.y
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist < 130) {
            const lineAlpha = (1 - dist / 130) * 0.22 * Math.min(p.alpha, p2.alpha)
            ctx.beginPath()
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.strokeStyle = `hsla(${p.hue}, 75%, 60%, ${lineAlpha})`
            ctx.lineWidth = 0.8
            ctx.stroke()
          }
        }
      }

      animationFrameId = requestAnimationFrame(render)
    }

    render()

    return () => {
      window.removeEventListener("resize", handleResize)
      canvas.parentElement?.removeEventListener("mousemove", handleMouseMove)
      canvas.parentElement?.removeEventListener("mouseleave", handleMouseLeave)
      cancelAnimationFrame(animationFrameId)
    }
  }, [isReducedMotion])

  if (isReducedMotion) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_50%_20%,rgba(168,85,247,0.12),transparent_70%)]"
      />
    )
  }

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="higgsfield-canvas absolute inset-0 h-full w-full opacity-75 mix-blend-screen"
      />
      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-b from-transparent via-[#07070a]/80 to-[#07070a]" />
    </div>
  )
}
