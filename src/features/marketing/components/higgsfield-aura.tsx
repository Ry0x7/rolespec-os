"use client"

import { useEffect, useRef } from "react"
import { useMotionMode } from "@/shared/hooks/use-motion-mode"

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

/**
 * Higgsfield-style generative ambient canvas:
 * Floating organic neural particles interconnected by glowing radiant energy filaments
 * with gentle mouse interaction and ambient color drift.
 * Automatically respects user-toggled motion preference and prefers-reduced-motion.
 */
export function HiggsfieldAura() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const { isReducedMotion } = useMotionMode()

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

    // Generate balanced network of particles
    const particleCount = Math.min(Math.floor((width * height) / 22000), 55)
    const particles: Particle[] = []

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        radius: Math.random() * 2 + 1.2,
        alpha: Math.random() * 0.5 + 0.2,
        targetAlpha: Math.random() * 0.6 + 0.2,
        hue: Math.random() > 0.6 ? 275 : Math.random() > 0.3 ? 255 : 295, // Violet, indigo, and fuchsia
      })
    }

    let time = 0

    const render = () => {
      time += 0.015
      ctx.clearRect(0, 0, width, height)

      // Background ambient radial gradient pulse
      const ambientX = width * 0.5 + Math.sin(time * 0.4) * 60
      const ambientY = height * 0.3 + Math.cos(time * 0.3) * 40
      const bgGlow = ctx.createRadialGradient(
        ambientX,
        ambientY,
        20,
        ambientX,
        ambientY,
        Math.max(width, height) * 0.55
      )
      bgGlow.addColorStop(0, "rgba(124, 58, 237, 0.12)")
      bgGlow.addColorStop(0.4, "rgba(99, 102, 241, 0.06)")
      bgGlow.addColorStop(1, "rgba(0, 0, 0, 0)")
      ctx.fillStyle = bgGlow
      ctx.fillRect(0, 0, width, height)

      // Draw filaments between nearby particles
      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i]!

        // Move
        p1.x += p1.vx
        p1.y += p1.vy

        // Bounce gently at edges
        if (p1.x < 0 || p1.x > width) p1.vx *= -1
        if (p1.y < 0 || p1.y > height) p1.vy *= -1

        // Mouse attraction when hovered
        if (mouse.isHovered) {
          const dx = mouse.x - p1.x
          const dy = mouse.y - p1.y
          const dist = Math.hypot(dx, dy)
          if (dist < 180 && dist > 10) {
            const force = (180 - dist) / 180 * 0.015
            p1.x += (dx / dist) * force * 15
            p1.y += (dy / dist) * force * 15
          }
        }

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j]!
          const dx = p1.x - p2.x
          const dy = p1.y - p2.y
          const dist = Math.hypot(dx, dy)

          if (dist < 125) {
            const lineAlpha = (1 - dist / 125) * 0.22 * Math.min(p1.alpha, p2.alpha)
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.strokeStyle = `hsla(${p1.hue}, 80%, 70%, ${lineAlpha})`
            ctx.lineWidth = 0.8
            ctx.stroke()
          }
        }

        // Draw particle node
        ctx.beginPath()
        ctx.arc(p1.x, p1.y, p1.radius, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${p1.hue}, 85%, 72%, ${p1.alpha})`
        ctx.shadowBlur = 10
        ctx.shadowColor = `hsla(${p1.hue}, 90%, 65%, 0.5)`
        ctx.fill()
        ctx.shadowBlur = 0
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

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full opacity-80 mix-blend-screen"
      />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent via-background/80 to-background" />
    </div>
  )
}
