import { relations } from "drizzle-orm";
import { user, session } from "./auth.js";
import { experience } from "./projects.js";
import { screen } from "./screens.js";

// ─── Auth Relations ───────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  createdExperiences: many(experience, { relationName: "experienceCreatedBy" }),
  updatedExperiences: many(experience, { relationName: "experienceUpdatedBy" }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

// ─── Experience Relations ─────────────────────────────────────────────────────

export const experienceRelations = relations(experience, ({ one }) => ({
  createdBy: one(user, {
    fields: [experience.createdByUserId],
    references: [user.id],
    relationName: "experienceCreatedBy",
  }),
  updatedBy: one(user, {
    fields: [experience.updatedByUserId],
    references: [user.id],
    relationName: "experienceUpdatedBy",
  }),
}));

// ─── Screen Relations ─────────────────────────────────────────────────────────

export const screenRelations = relations(screen, ({ one }) => ({
  currentExperience: one(experience, {
    fields: [screen.currentExperienceId],
    references: [experience.id],
  }),
}));
