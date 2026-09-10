-- Auth-table indexes. Both tables are read on the critical path of every
-- request that resolves a session, but `session` had only its token unique
-- index and `account` had no indexes at all.
--
-- CONCURRENTLY is deliberately NOT used: these tables are tiny (one row per
-- login), so the exclusive lock is momentary, and drizzle runs migrations
-- inside a transaction, which CONCURRENTLY cannot be used in.

-- Better Auth resolves a user's sessions by user_id; the FK cascade from
-- "user" needs it too. Previously a sequential scan.
CREATE INDEX IF NOT EXISTS "session_user_id_idx"
	ON "session" USING btree ("user_id");--> statement-breakpoint

-- Backs getUserStats' "active users" dashboard tile:
--   SELECT count(DISTINCT user_id) FROM session WHERE expires_at > now()
-- expires_at leads so the range is a direct ordered scan; user_id rides along
-- so the count can be satisfied without touching the heap.
CREATE INDEX IF NOT EXISTS "session_expires_at_user_id_idx"
	ON "session" USING btree ("expires_at","user_id");--> statement-breakpoint

-- Better Auth reads a user's accounts by user_id on every email/password
-- sign-in (the password hash lives there), and the FK cascade uses it.
CREATE INDEX IF NOT EXISTS "account_user_id_idx"
	ON "account" USING btree ("user_id");
