"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { User } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { updateProfile } from "../actions/profile.actions"

type ProfileFormProps = {
  name: string
  email: string
  image: string
}

export function ProfileForm({ name, email, image }: ProfileFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [nameValue, setNameValue] = useState(name)
  const [imageValue, setImageValue] = useState(image)
  const [imageFailed, setImageFailed] = useState(false)

  const showPreview = imageValue.trim().length > 0 && !imageFailed

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateProfile(nameValue.trim(), imageValue.trim())
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Profile updated")
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="image">Avatar URL</Label>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
            {showPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageValue}
                alt="Avatar preview"
                className="h-full w-full object-cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <User className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <Input
            id="image"
            name="image"
            type="url"
            className="min-w-0 flex-1"
            placeholder="https://example.com/avatar.png"
            value={imageValue}
            disabled={isPending}
            onChange={(e) => {
              setImageValue(e.target.value)
              setImageFailed(false)
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={100}
          placeholder="Your name"
          value={nameValue}
          disabled={isPending}
          onChange={(e) => setNameValue(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" value={email} readOnly disabled />
        <p className="text-xs text-muted-foreground">
          Your email address cannot be changed.
        </p>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save changes"}
      </Button>
    </form>
  )
}
