/**
 * Decorative hero backdrop: layered ambient glow blobs plus a masked grid.
 * Pure CSS (server-rendered), motion gated by prefers-reduced-motion in
 * globals.css. Must be clipped by a `relative overflow-hidden` parent.
 */
export function HeroAmbient() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="hero-grid absolute inset-0" />
      <div className="hero-blob hero-blob-brand -top-20 left-1/2 h-[26rem] w-[26rem] -translate-x-1/2 sm:h-[36rem] sm:w-[36rem]" />
      <div className="hero-blob hero-blob-indigo -left-24 top-24 h-72 w-72 sm:h-[28rem] sm:w-[28rem]" />
      <div className="hero-blob hero-blob-pink -right-24 bottom-0 h-64 w-64 sm:h-80 sm:w-80" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background" />
    </div>
  )
}
