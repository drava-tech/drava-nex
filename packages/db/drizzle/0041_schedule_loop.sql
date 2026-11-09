-- A schedule's queue repeats until its window ends (the default, and how
-- every existing schedule behaves), or plays once.
ALTER TABLE "schedule" ADD COLUMN IF NOT EXISTS "loop" boolean DEFAULT true NOT NULL;
