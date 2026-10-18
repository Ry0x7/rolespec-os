-- Promotes the per-user canonical-URL dedupe key from an index to a real
-- constraint. Until now "have I already saved this posting?" was answered by a
-- pre-write `findFirst` in three separate call sites, which two concurrent
-- saves of the same tab could both pass.
--
-- Postgres treats NULLs as distinct, so this constrains nothing for postings
-- without a resolvable URL — manual entries and imports stay unaffected.
-- Verified before writing: 41 job rows, all with a NULL "canonicalUrl", and no
-- duplicate ("userId", "canonicalUrl") pair in either table.

-- DropIndex
DROP INDEX "jobs_userId_canonicalUrl_idx";

-- CreateIndex
CREATE UNIQUE INDEX "jobs_userId_canonicalUrl_key" ON "jobs"("userId", "canonicalUrl");
