UPDATE "media_asset" SET "source" = 'upload' WHERE "source" IS NULL AND "url" LIKE '/media/%';
UPDATE "media_asset" SET "source" = 'link' WHERE "source" IS NULL AND "url" NOT LIKE '/media/%';
UPDATE "media_asset" SET "source" = 'email' WHERE "source" = 'gmail';
