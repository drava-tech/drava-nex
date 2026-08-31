import { sql, eq } from "drizzle-orm";
import { db } from "./client.js";
import { experience } from "./schema/projects.js";
import {
  portfolioVertical,
  portfolioCategory,
  portfolioCategoryImage,
  portfolioCategoryVideo,
  portfolioProject,
  portfolioProjectImage,
  portfolioProjectVideo,
  portfolioSettings,
  company,
} from "./schema/portfolio.js";

/**
 * One-off backfill: reads every `experience.template_content.portfolio` JSONB
 * blob and inserts the equivalent rows into the new relational portfolio
 * tables (see 0027_portfolio_relational.sql). Does not touch/delete the
 * source JSONB — this is purely additive and safely re-inspectable.
 *
 * Run: `pnpm --filter @platform/db db:migrate-portfolio [--dry-run] [--force]`
 */

// ─── Minimal re-implementation of packages/ui/src/templates/portfolio/content.ts
// helpers — @platform/db has no dependency on @platform/ui, so these are kept
// here rather than imported. Must stay behaviorally equivalent.

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanUrls(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : []).filter(
    (u): u is string => typeof u === "string" && u.length > 0
  );
}

const DEFAULT_TITLE_FONT_SIZE = 50;
const DEFAULT_DESCRIPTION_FONT_SIZE = 22;
const DEFAULT_BUTTON_FONT_SIZE = 20;
const DEFAULT_CARD_PADDING = 44;
const DEFAULT_GALLERY_TITLE_FONT_SIZE = 64;
const DEFAULT_GALLERY_SUBTITLE_FONT_SIZE = 24;
const DEFAULT_GALLERY_DESCRIPTION_FONT_SIZE = 20;
const DEFAULT_GALLERY_GAP = 26;
const DEFAULT_GALLERY_PADDING = 78;
const DEFAULT_GALLERY_BACKGROUND_COLOR = "#e8e8f7";
const DEFAULT_GALLERY_TEXT_COLOR = "#111114";
const DEFAULT_GALLERY_EXPANDED_PCT = 70;
const DEFAULT_GALLERY_BLUR_PX = 12;

// ─── Source JSONB shapes (loose — mirrors content.ts's TS interfaces) ─────────

interface RawProject {
  company?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  images?: string[];
  videoUrl?: string;
}
interface RawSection {
  name?: string;
  type?: "images" | "videos" | "gallery";
  images?: string[];
  videos?: string[];
  title?: string;
  subtitle?: string;
  description?: string;
  projects?: RawProject[];
}
interface RawCard {
  title?: string;
  imageUrl?: string;
  videoUrl?: string;
  description?: string;
  button1?: string;
  button2?: string;
  sections?: RawSection[];
}
interface RawPortfolioContent {
  gallery?: {
    titleFontSize?: number;
    subtitleFontSize?: number;
    descriptionFontSize?: number;
    gap?: number;
    padding?: number;
    backgroundColor?: string;
    textColor?: string;
    expandedPct?: number;
    blurPx?: number;
  };
  overview?: {
    cards?: RawCard[];
    titleFontSize?: number;
    descriptionFontSize?: number;
    buttonFontSize?: number;
    cardPadding?: number;
  };
}

// ─── CLI flags ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

// ─── Company dedupe — one map for the whole script run, not per-experience ───

const companyIdBySlug = new Map<string, string>();

async function resolveCompanyId(rawName: string | undefined): Promise<string | null> {
  const name = (rawName ?? "").trim();
  if (!name) return null;
  const slug = slugify(name);
  if (!slug) return null;

  const cached = companyIdBySlug.get(slug);
  if (cached) return cached;

  if (dryRun) {
    // No inserts in dry-run — synthesize a stable placeholder id for counting only.
    const placeholder = `dry-run:${slug}`;
    companyIdBySlug.set(slug, placeholder);
    return placeholder;
  }

  const [existing] = await db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.slug, slug))
    .limit(1);
  if (existing) {
    companyIdBySlug.set(slug, existing.id);
    return existing.id;
  }

  const [created] = await db.insert(company).values({ name, slug }).returning({ id: company.id });
  if (!created) throw new Error(`Failed to create company "${name}"`);
  companyIdBySlug.set(slug, created.id);
  return created.id;
}

// ─── Counters ───────────────────────────────────────────────────────────────

const counts = {
  experiences: 0,
  verticals: 0,
  categories: 0,
  categoryImages: 0,
  categoryVideos: 0,
  projects: 0,
  projectImages: 0,
  projectVideos: 0,
  companiesCreated: 0,
  companiesReused: 0,
  settings: 0,
};

async function migrateExperience(experienceId: string, content: RawPortfolioContent): Promise<void> {
  const overview = content.overview ?? {};
  const galleryStyle = content.gallery ?? {};
  const cards = Array.isArray(overview.cards) ? overview.cards : [];

  const run = async (tx: typeof db) => {
    // Settings (one row per experience)
    counts.settings++;
    if (!dryRun) {
      await tx.insert(portfolioSettings).values({
        experienceId,
        overviewTitleFontSize: overview.titleFontSize ?? DEFAULT_TITLE_FONT_SIZE,
        overviewDescriptionFontSize: overview.descriptionFontSize ?? DEFAULT_DESCRIPTION_FONT_SIZE,
        overviewButtonFontSize: overview.buttonFontSize ?? DEFAULT_BUTTON_FONT_SIZE,
        overviewCardPadding: overview.cardPadding ?? DEFAULT_CARD_PADDING,
        galleryTitleFontSize: galleryStyle.titleFontSize ?? DEFAULT_GALLERY_TITLE_FONT_SIZE,
        gallerySubtitleFontSize: galleryStyle.subtitleFontSize ?? DEFAULT_GALLERY_SUBTITLE_FONT_SIZE,
        galleryDescriptionFontSize:
          galleryStyle.descriptionFontSize ?? DEFAULT_GALLERY_DESCRIPTION_FONT_SIZE,
        galleryGap: galleryStyle.gap ?? DEFAULT_GALLERY_GAP,
        galleryPadding: galleryStyle.padding ?? DEFAULT_GALLERY_PADDING,
        galleryBackgroundColor: galleryStyle.backgroundColor ?? DEFAULT_GALLERY_BACKGROUND_COLOR,
        galleryTextColor: galleryStyle.textColor ?? DEFAULT_GALLERY_TEXT_COLOR,
        galleryExpandedPct: galleryStyle.expandedPct ?? DEFAULT_GALLERY_EXPANDED_PCT,
        galleryBlurPx: galleryStyle.blurPx ?? DEFAULT_GALLERY_BLUR_PX,
      });
    }

    for (let cardIndex = 0; cardIndex < Math.min(cards.length, 3); cardIndex++) {
      const card = cards[cardIndex]!;
      counts.verticals++;
      let verticalId = `dry-run-vertical-${cardIndex}`;
      if (!dryRun) {
        const [insertedVertical] = await tx
          .insert(portfolioVertical)
          .values({
            experienceId,
            slotIndex: cardIndex,
            title: card.title ?? "",
            imageUrl: card.imageUrl ?? "",
            videoUrl: card.videoUrl || null,
            description: card.description ?? null,
            button1: card.button1 || "Watch Video",
            button2: card.button2 || "Projects",
          })
          .returning({ id: portfolioVertical.id });
        if (!insertedVertical) throw new Error("Failed to create portfolio_vertical");
        verticalId = insertedVertical.id;
      }

      const sections = Array.isArray(card.sections) ? card.sections : [];
      for (let sectionIndex = 0; sectionIndex < Math.min(sections.length, 2); sectionIndex++) {
        const section = sections[sectionIndex]!;
        const type: "images" | "videos" | "gallery" =
          section.type === "videos" ? "videos" : section.type === "gallery" ? "gallery" : "images";
        counts.categories++;
        let categoryId = `dry-run-category-${cardIndex}-${sectionIndex}`;
        if (!dryRun) {
          const [insertedCategory] = await tx
            .insert(portfolioCategory)
            .values({
              verticalId,
              slotIndex: sectionIndex,
              name: (section.name ?? "").trim() || `Category ${sectionIndex + 1}`,
              type,
              title: section.title ?? null,
              subtitle: section.subtitle ?? null,
              description: section.description ?? null,
            })
            .returning({ id: portfolioCategory.id });
          if (!insertedCategory) throw new Error("Failed to create portfolio_category");
          categoryId = insertedCategory.id;
        }

        if (type !== "gallery") {
          const images = cleanUrls(section.images);
          for (let i = 0; i < images.length; i++) {
            counts.categoryImages++;
            if (!dryRun) {
              await tx.insert(portfolioCategoryImage).values({ categoryId, url: images[i]!, sortOrder: i });
            }
          }
          const videos = cleanUrls(section.videos);
          for (let i = 0; i < videos.length; i++) {
            counts.categoryVideos++;
            if (!dryRun) {
              await tx.insert(portfolioCategoryVideo).values({ categoryId, url: videos[i]!, sortOrder: i });
            }
          }
          continue;
        }

        // type === "gallery"
        let rawProjects = Array.isArray(section.projects) ? section.projects : [];
        if (rawProjects.length === 0) {
          // Legacy fallback: migrate the section's own flat fields into one project.
          rawProjects = [
            {
              company: "",
              title: section.title,
              subtitle: section.subtitle,
              description: section.description,
              images: section.images,
            },
          ];
        }

        for (let projectIndex = 0; projectIndex < rawProjects.length; projectIndex++) {
          const proj = rawProjects[projectIndex]!;
          const slug = slugify(proj.company ?? "");
          const hadCompanyBefore = slug ? companyIdBySlug.has(slug) : false;
          const companyId = await resolveCompanyId(proj.company);
          if (companyId) {
            if (hadCompanyBefore) counts.companiesReused++;
            else counts.companiesCreated++;
          }

          counts.projects++;
          let projectId = `dry-run-project-${cardIndex}-${sectionIndex}-${projectIndex}`;
          if (!dryRun) {
            const [insertedProject] = await tx
              .insert(portfolioProject)
              .values({
                categoryId,
                companyId,
                title: proj.title ?? null,
                subtitle: proj.subtitle ?? null,
                description: proj.description ?? null,
                sortOrder: projectIndex,
              })
              .returning({ id: portfolioProject.id });
            if (!insertedProject) throw new Error("Failed to create portfolio_project");
            projectId = insertedProject.id;
          }

          const images = cleanUrls(proj.images);
          for (let i = 0; i < images.length; i++) {
            counts.projectImages++;
            if (!dryRun) {
              await tx.insert(portfolioProjectImage).values({ projectId, url: images[i]!, sortOrder: i });
            }
          }

          if (proj.videoUrl) {
            counts.projectVideos++;
            if (!dryRun) {
              await tx.insert(portfolioProjectVideo).values({ projectId, url: proj.videoUrl, sortOrder: 0 });
            }
          }
        }
      }
    }
  };

  if (dryRun) {
    await run(db);
  } else {
    await db.transaction(async (tx) => run(tx as unknown as typeof db));
  }
}

async function main(): Promise<void> {
  if (!dryRun && !force) {
    const countRows = (await db.execute(
      sql`SELECT count(*)::int as existing FROM "portfolio_vertical"`
    )).rows as unknown as { existing: number }[];
    const existing = countRows[0]?.existing ?? 0;
    if (existing > 0) {
      console.error(
        `Refusing to run: portfolio_vertical already has ${existing} row(s). Pass --force to run anyway.`
      );
      process.exit(1);
    }
  }

  const rows = await db
    .select({ id: experience.id, templateContent: experience.templateContent })
    .from(experience)
    .where(eq(experience.templateKey, "portfolio"));

  console.log(`Found ${rows.length} experience(s) with templateKey = 'portfolio'.`);
  if (dryRun) console.log("--dry-run: no writes will be made.\n");

  for (const row of rows) {
    const content = (row.templateContent as Record<string, unknown> | null)?.["portfolio"] as
      | RawPortfolioContent
      | undefined;
    if (!content) {
      console.log(`  • ${row.id}: no portfolio content — skipped`);
      continue;
    }
    counts.experiences++;
    await migrateExperience(row.id, content);
    console.log(`  • ${row.id}: migrated`);
  }

  console.log("\nSummary:");
  console.log(`  experiences processed: ${counts.experiences}`);
  console.log(`  verticals inserted:    ${counts.verticals}`);
  console.log(`  categories inserted:   ${counts.categories}`);
  console.log(`  category images:       ${counts.categoryImages}`);
  console.log(`  category videos:       ${counts.categoryVideos}`);
  console.log(`  projects inserted:     ${counts.projects}`);
  console.log(`  project images:        ${counts.projectImages}`);
  console.log(`  project videos:        ${counts.projectVideos}`);
  console.log(`  settings rows:         ${counts.settings}`);
  console.log(`  companies created:     ${counts.companiesCreated}`);
  console.log(`  companies reused:      ${counts.companiesReused} (proof of global dedupe)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
