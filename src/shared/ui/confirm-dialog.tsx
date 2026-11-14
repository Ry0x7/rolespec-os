"use client"

import type { ReactNode } from "react"
import { Button } from "@/shared/ui/button"
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "@/shared/ui/dialog"

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: ReactNode
  /** Defaults to "Confirm". */
  confirmLabel?: string
  cancelLabel?: string
  /** Renders the confirm button in the destructive style. */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The in-app replacement for `window.confirm`: same blocking question, but on
 * the app's own dialog so it is themed, focus-trapped and dismissible.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="max-w-sm"
      aria-label={title}
    >
      <DialogHeader>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </DialogHeader>
      <DialogBody>
        <p className="text-sm text-muted-foreground">{description}</p>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={destructive ? "destructive" : "default"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
