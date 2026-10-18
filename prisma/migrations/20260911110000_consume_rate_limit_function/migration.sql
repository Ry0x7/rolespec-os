-- Single-round-trip check-and-record for the sliding-window rate limiter.
--
-- Why a function and not a CTE: the guarantee `consumeRateLimit` needs is that a
-- caller waiting on `pg_advisory_xact_lock` sees the rows the previous holder
-- committed. A single SQL statement takes its snapshot BEFORE the lock is
-- acquired, so a CTE that locks and then counts still counts against the stale
-- snapshot — measured against Neon, 5 concurrent callers with max=3 let 4 and
-- then 5 through. A VOLATILE plpgsql function takes a fresh snapshot for each
-- statement in its body, so the count after the lock sees the committed rows.
-- Same one round trip (~52ms), correct under contention.
--
-- Called outside an explicit transaction, so the implicit single-statement
-- transaction scopes the advisory lock: Postgres releases it when the statement
-- ends. `lock_timeout` bounds the wait the way the old interactive transaction's
-- `maxWait` did; on timeout the caller errors and the TypeScript side fails open.
--
-- `p_since` / `p_now` come from the application clock (as before) and are passed
-- as UTC timestamps so behaviour does not depend on the session's TimeZone.

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_key text,
  p_bucket text,
  p_identifier text,
  p_since timestamp(3),
  p_now timestamp(3),
  p_max integer
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
AS $fn$
DECLARE
  v_recent integer;
BEGIN
  SET LOCAL lock_timeout = '10s';
  PERFORM pg_advisory_xact_lock(hashtext('rate-limit'), hashtext(p_key));

  SELECT count(*) INTO v_recent
  FROM public."rate_limit_attempts"
  WHERE "bucket" = p_bucket
    AND "identifier" = p_identifier
    AND "createdAt" >= p_since;

  IF v_recent >= p_max THEN
    RETURN false;
  END IF;

  INSERT INTO public."rate_limit_attempts" ("id", "bucket", "identifier", "createdAt")
  VALUES (gen_random_uuid()::text, p_bucket, p_identifier, p_now);

  RETURN true;
END;
$fn$;
