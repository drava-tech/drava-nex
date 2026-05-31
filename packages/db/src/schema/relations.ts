import { relations } from "drizzle-orm";
import { templates } from "./templates.js";
import { experiences } from "./experiences.js";
import { contents } from "./contents.js";
import { assets } from "./assets.js";
import { screens } from "./screens.js";
import { screenAssignments } from "./screenAssignments.js";

// ─── Templates ────────────────────────────────────────────────────────────────

export const templatesRelations = relations(templates, ({ many }) => ({
  experiences: many(experiences),
}));

// ─── Experiences ──────────────────────────────────────────────────────────────

export const experiencesRelations = relations(experiences, ({ one, many }) => ({
  template: one(templates, {
    fields: [experiences.templateId],
    references: [templates.id],
  }),
  contents: many(contents),
  screenAssignments: many(screenAssignments),
}));

// ─── Contents ─────────────────────────────────────────────────────────────────

export const contentsRelations = relations(contents, ({ one, many }) => ({
  experience: one(experiences, {
    fields: [contents.experienceId],
    references: [experiences.id],
  }),
  assets: many(assets),
  screenAssignments: many(screenAssignments),
}));

// ─── Assets ───────────────────────────────────────────────────────────────────

export const assetsRelations = relations(assets, ({ one }) => ({
  content: one(contents, {
    fields: [assets.contentId],
    references: [contents.id],
  }),
}));

// ─── Screens ──────────────────────────────────────────────────────────────────

export const screensRelations = relations(screens, ({ many }) => ({
  screenAssignments: many(screenAssignments),
}));

// ─── Screen Assignments ───────────────────────────────────────────────────────

export const screenAssignmentsRelations = relations(
  screenAssignments,
  ({ one }) => ({
    screen: one(screens, {
      fields: [screenAssignments.screenId],
      references: [screens.id],
    }),
    experience: one(experiences, {
      fields: [screenAssignments.experienceId],
      references: [experiences.id],
    }),
    content: one(contents, {
      fields: [screenAssignments.contentId],
      references: [contents.id],
    }),
  })
);

// Note: `devices` and `rules` are standalone tables — no relations needed.
