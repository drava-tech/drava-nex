-- The Data Art Studio template is now Drava Mosaic (template key
-- 'data-art-studio' → 'drava-mosaic'). Move experiences already assigned to
-- it, and the slice of template_content kept under the old key, if any.
UPDATE "experience" SET "template_key" = 'drava-mosaic' WHERE "template_key" = 'data-art-studio';
--> statement-breakpoint
UPDATE "experience"
SET "template_content" = ("template_content" - 'data-art-studio')
	|| jsonb_build_object('drava-mosaic', "template_content" -> 'data-art-studio')
WHERE "template_content" ? 'data-art-studio';
