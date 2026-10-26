-- Perf indexes for OS list routes (additive only; CONCURRENTLY avoided inside migrations for simplicity)
CREATE INDEX IF NOT EXISTS "resumes_userId_updatedAt_idx" ON "resumes"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "resumes_userId_createdAt_idx" ON "resumes"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "resume_exports_userId_createdAt_idx" ON "resume_exports"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "resume_exports_resumeId_createdAt_idx" ON "resume_exports"("resumeId", "createdAt");
CREATE INDEX IF NOT EXISTS "job_applications_userId_updatedAt_idx" ON "job_applications"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "job_applications_userId_followUpAt_idx" ON "job_applications"("userId", "followUpAt");
CREATE INDEX IF NOT EXISTS "job_applications_userId_status_updatedAt_idx" ON "job_applications"("userId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "jobs_userId_updatedAt_idx" ON "jobs"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "jobs_userId_source_idx" ON "jobs"("userId", "source");
CREATE INDEX IF NOT EXISTS "todos_userId_dueDate_idx" ON "todos"("userId", "dueDate");
CREATE INDEX IF NOT EXISTS "todos_userId_updatedAt_idx" ON "todos"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "notes_userId_createdAt_idx" ON "notes"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "notes_userId_updatedAt_idx" ON "notes"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "activity_events_userId_type_createdAt_idx" ON "activity_events"("userId", "type", "createdAt");
