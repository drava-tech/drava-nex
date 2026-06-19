-- rename table
ALTER TABLE "project" RENAME TO "experience";

-- rename FK constraints
ALTER TABLE "experience" RENAME CONSTRAINT "project_created_by_user_id_user_id_fk"
  TO "experience_created_by_user_id_user_id_fk";
ALTER TABLE "experience" RENAME CONSTRAINT "project_updated_by_user_id_user_id_fk"
  TO "experience_updated_by_user_id_user_id_fk";

-- rename indexes
ALTER INDEX "project_slug_unique_idx" RENAME TO "experience_slug_unique_idx";
ALTER INDEX "project_created_by_idx"  RENAME TO "experience_created_by_idx";
ALTER INDEX "project_deleted_at_idx"  RENAME TO "experience_deleted_at_idx";

-- add position column
ALTER TABLE "experience" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;
