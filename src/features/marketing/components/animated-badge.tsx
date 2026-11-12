"use client"

import { motion } from "framer-motion"
import { Sparkles } from "lucide-react"

export function AnimatedBadge() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3.5 py-1.5 text-xs font-medium text-brand-300 shadow-glow-sm backdrop-blur-md"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
      </span>
      <span className="flex items-center gap-1.5 font-semibold text-foreground">
        RoleSpec OS v2.0
      </span>
      <span className="text-muted-foreground/50">|</span>
      <span className="flex items-center gap-1 text-brand-300">
        <Sparkles className="h-3 w-3 text-brand-400" />
        Private AI Career Studio
      </span>
    </motion.div>
  )
}
