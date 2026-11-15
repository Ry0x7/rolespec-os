"use client"

import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/shared/lib/utils"

interface DropdownMenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  /** Closes the menu and restores focus to the trigger. */
  closeMenu: () => void
  menuId: string
  triggerId: string
  triggerRef: React.RefObject<HTMLButtonElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null)

function useDropdownMenu(component: string) {
  const ctx = useContext(DropdownMenuContext)
  if (!ctx) {
    throw new Error(`${component} must be used within <DropdownMenu>`)
  }
  return ctx
}

function getItems(container: HTMLElement | null) {
  if (!container) return []
  return Array.from(
    container.querySelectorAll<HTMLElement>('[role="menuitem"]')
  ).filter((el) => !el.hasAttribute("data-disabled"))
}

interface DropdownMenuProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

function DropdownMenu({ className, children, ...props }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const menuId = `${id}-menu`
  const triggerId = `${id}-trigger`
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  const closeMenu = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (contentRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation()
        closeMenu()
      }
    }

    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("touchstart", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("touchstart", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open, closeMenu])

  const value = useMemo(
    () => ({
      open,
      setOpen,
      closeMenu,
      menuId,
      triggerId,
      triggerRef,
      contentRef,
    }),
    [open, closeMenu, menuId, triggerId]
  )

  return (
    <DropdownMenuContext.Provider value={value}>
      <div className={cn("relative inline-block", className)} {...props}>
        {children}
      </div>
    </DropdownMenuContext.Provider>
  )
}

type DropdownMenuTriggerProps = ButtonHTMLAttributes<HTMLButtonElement>

function DropdownMenuTrigger({
  className,
  onClick,
  onKeyDown,
  children,
  ...props
}: DropdownMenuTriggerProps) {
  const { open, setOpen, menuId, triggerId, triggerRef, contentRef } =
    useDropdownMenu("DropdownMenuTrigger")

  const focusItem = useCallback(
    (index: number) => {
      window.requestAnimationFrame(() => {
        const items = getItems(contentRef.current)
        const target = index === -1 ? items[items.length - 1] : items[index]
        target?.focus()
      })
    },
    [contentRef]
  )

  return (
    <button
      ref={triggerRef}
      id={triggerId}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      className={className}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        setOpen(!open)
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          setOpen(true)
          focusItem(event.key === "ArrowDown" ? 0 : -1)
        }
      }}
      {...props}
    >
      {children}
    </button>
  )
}

const dropdownMenuContentVariants = cva(
  "absolute z-[var(--z-dropdown)] mt-2 min-w-44 overflow-hidden rounded-lg border border-border bg-card p-1 shadow-lg",
  {
    variants: {
      align: {
        start: "left-0",
        end: "right-0",
      },
      side: {
        bottom: "top-full",
        top: "bottom-full mt-0 mb-2",
      },
    },
    defaultVariants: {
      align: "end",
      side: "bottom",
    },
  }
)

interface DropdownMenuContentProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof dropdownMenuContentVariants> {
  /** Accessible name for the menu. */
  label?: string
}

function DropdownMenuContent({
  className,
  align,
  side,
  label,
  onKeyDown,
  children,
  ...props
}: DropdownMenuContentProps) {
  const { open, setOpen, menuId, triggerId, contentRef } =
    useDropdownMenu("DropdownMenuContent")

  useEffect(() => {
    if (!open) return
    const items = getItems(contentRef.current)
    items[0]?.focus()
  }, [open, contentRef])

  if (!open) return null

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event)
    if (event.defaultPrevented) return

    const items = getItems(contentRef.current)
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLElement)

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        items[(current + 1) % items.length]?.focus()
        break
      case "ArrowUp":
        event.preventDefault()
        items[(current - 1 + items.length) % items.length]?.focus()
        break
      case "Home":
        event.preventDefault()
        items[0]?.focus()
        break
      case "End":
        event.preventDefault()
        items[items.length - 1]?.focus()
        break
      case "Tab":
        setOpen(false)
        break
      default:
        break
    }
  }

  return (
    <div
      ref={contentRef}
      id={menuId}
      role="menu"
      aria-label={label}
      aria-labelledby={label ? undefined : triggerId}
      onKeyDown={handleKeyDown}
      className={cn(dropdownMenuContentVariants({ align, side, className }))}
      {...props}
    >
      {children}
    </div>
  )
}

const dropdownMenuItemVariants = cva(
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  {
    variants: {
      variant: {
        default:
          "text-muted-foreground hover:bg-muted hover:text-foreground focus:bg-muted focus:text-foreground active:bg-input",
        destructive:
          "text-red-400 hover:bg-red-500/10 focus:bg-red-500/10 active:bg-red-500/15",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

interface DropdownMenuItemProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof dropdownMenuItemVariants> {
  /** Merge menu-item props onto a single child element (e.g. a Link). */
  asChild?: boolean
  /** Keep the menu open after activation. */
  closeOnSelect?: boolean
}

function DropdownMenuItem({
  className,
  variant,
  asChild,
  closeOnSelect = true,
  disabled,
  onClick,
  children,
  ...props
}: DropdownMenuItemProps) {
  const { closeMenu } = useDropdownMenu("DropdownMenuItem")

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    ;(onClick as ((e: React.MouseEvent<HTMLElement>) => void) | undefined)?.(
      event
    )
    if (event.defaultPrevented) return
    if (closeOnSelect) closeMenu()
  }

  const shared = {
    role: "menuitem" as const,
    tabIndex: -1,
    className: cn(dropdownMenuItemVariants({ variant, className })),
    onClick: handleClick,
    ...(disabled ? { "data-disabled": "" } : {}),
  }

  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>
    return cloneElement(child, { ...props, ...shared })
  }

  return (
    <button type="button" disabled={disabled} {...props} {...shared}>
      {children}
    </button>
  )
}

function DropdownMenuLabel({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  dropdownMenuContentVariants,
  dropdownMenuItemVariants,
}
