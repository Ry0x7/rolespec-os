"use client"

import { motion } from "framer-motion"
import { Sparkles } from "lucide-react"

export function AnimatedBadge() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground"
    >
      <span className="h-2 w-2 rounded-full bg-success" />
      <span className="flex items-center gap-1.5 font-semibold text-foreground">
        RoleSpec OS v2.0
      </span>
      <span className="text-border">|</span>
      <span className="flex items-center gap-1">
        <Sparkles className="h-3 w-3 text-brand-400" />
        Private AI Career Studio
      </span>
    </motion.div>
  )
}
