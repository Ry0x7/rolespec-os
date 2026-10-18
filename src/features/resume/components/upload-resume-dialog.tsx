"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/shared/ui/button"
import { Dialog } from "@/shared/ui/dialog"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Upload, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"

// Mirrors the server list in `src/app/api/resume/parse/route.ts`. Legacy .doc
// is not here: the parser cannot read it.
const ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]
const MAX_BYTES = 5 * 1024 * 1024

export function UploadResumeDialog() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [targetRole, setTargetRole] = useState("")
  const [jobDescription, setJobDescription] = useState("")
  const [optimizeBullets, setOptimizeBullets] = useState(true)

  function handleClose() {
    if (isUploading) return
    setOpen(false)
    setError(null)
    setFile(null)
    setTargetRole("")
    setJobDescription("")
    setOptimizeBullets(true)
    setIsUploading(false)
  }

  function validateFile(f: File): string | null {
    if (!ALLOWED_TYPES.includes(f.type)) {
      return "Only PDF and DOCX files are supported"
    }
    if (f.size > MAX_BYTES) {
      return "File size must be 5 MB or less"
    }
    return null
  }

  function handleFileSelect(f: File) {
    const err = validateFile(f)
    if (err) {
      setError(err)
      setFile(null)
      return
    }
    setError(null)
    setFile(f)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (selected) handleFileSelect(selected)
    e.target.value = ""
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) handleFileSelect(dropped)
  }

  async function handleUpload() {
    if (!file) return
    setIsUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append("file", file)
      if (targetRole.trim()) formData.append("targetRole", targetRole.trim())
      if (jobDescription.trim())
        formData.append("jobDescription", jobDescription.trim())
      formData.append("optimizeBullets", optimizeBullets ? "true" : "false")

      const res = await fetch("/api/resume/parse", {
        method: "POST",
        body: formData,
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Upload failed")
        setIsUploading(false)
        return
      }

      toast.success("Resume parsed successfully!")
      handleClose()
      router.push(`/resumes/${data.resumeId}`)
    } catch {
      setError("Something went wrong. Please try again.")
      setIsUploading(false)
    }
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Upload Resume
      </Button>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="max-w-lg"
      aria-labelledby="upload-resume-dialog-title"
    >
      <div className="flex items-center gap-3 mb-5">
        <h2 id="upload-resume-dialog-title" className="text-lg font-semibold">
          Upload Resume
        </h2>
      </div>

        <div className="space-y-4">
          {/* Dropzone */}
          <div
            className={[
              "relative flex flex-col items-center justify-center rounded-md border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
              dragOver
                ? "border-brand-500 bg-brand-500/10"
                : "border-border hover:border-border/80 hover:bg-muted/50",
              file ? "border-brand-700/60 bg-brand-700/5" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => !isUploading && fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              onChange={handleInputChange}
              disabled={isUploading}
            />

            {file ? (
              <>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-700/20 mb-3">
                  <FileText className="h-5 w-5 text-brand-400" />
                </div>
                <p className="text-sm font-medium">{file.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(0)} KB
                </p>
                <button
                  type="button"
                  className="mt-2 text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFile(null)
                    setError(null)
                  }}
                  disabled={isUploading}
                >
                  Choose a different file
                </button>
              </>
            ) : (
              <>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted mb-3">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">
                  Drop your resume here, or{" "}
                  <span className="text-brand-400">browse</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF or DOCX up to 5 MB
                </p>
              </>
            )}
          </div>

          {/* Target Role */}
          <div className="space-y-1.5">
            <Label htmlFor="upload-role">Target Role</Label>
            <Input
              id="upload-role"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              placeholder="e.g. High School Teacher"
              disabled={isUploading}
            />
          </div>

          {/* Job Description */}
          <div className="space-y-1.5">
            <Label htmlFor="upload-jd">Job Description (needed for ATS analysis)</Label>
            <textarea
              id="upload-jd"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the job listing here for keyword matching and targeted analysis..."
              disabled={isUploading}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm min-h-[100px] resize-y text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-[11px] text-muted-foreground">
              We&apos;ll analyze your resume against this job description for
              ATS optimization.
            </p>
          </div>

          {/* Bullet polish — the second AI call of an upload */}
          <label className="flex items-start gap-2 text-sm">
            <input
              id="upload-optimize"
              type="checkbox"
              checked={optimizeBullets}
              onChange={(e) => setOptimizeBullets(e.target.checked)}
              disabled={isUploading}
              className="mt-0.5 size-4 rounded border-border accent-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span>
              Polish bullets with AI (1 extra AI call)
              <span className="block text-[11px] text-muted-foreground">
                Rewrites about half your experience bullets on import. Turn off to
                import exactly what your file says.
              </span>
            </span>
          </label>

          {error && <p className="text-sm text-error">{error}</p>}

          {isUploading && (
            <p className="text-sm text-muted-foreground animate-pulse">
              Parsing your resume with AI... this may take a moment
            </p>
          )}

          <div className="flex gap-3 justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!file || isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Parsing...
                </>
              ) : (
                "Upload & Analyze"
              )}
            </Button>
          </div>
        </div>
    </Dialog>
  )
}
