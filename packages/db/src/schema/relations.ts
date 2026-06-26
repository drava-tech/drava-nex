import { relations } from "drizzle-orm";
import { user, session } from "./auth.js";
import { experience } from "./projects.js";
import { experienceType, experienceToType } from "./experience-types.js";
import { screen } from "./screens.js";
import { mediaAsset } from "./media.js";

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

export const experienceRelations = relations(experience, ({ one, many }) => ({
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
  types: many(experienceToType),
}));

// ─── Experience Type Relations ────────────────────────────────────────────────

export const experienceTypeRelations = relations(experienceType, ({ many }) => ({
  experiences: many(experienceToType),
}));

export const experienceToTypeRelations = relations(experienceToType, ({ one }) => ({
  experience: one(experience, {
    fields: [experienceToType.experienceId],
    references: [experience.id],
  }),
  type: one(experienceType, {
    fields: [experienceToType.typeId],
    references: [experienceType.id],
  }),
}));

// ─── Screen Relations ─────────────────────────────────────────────────────────

export const screenRelations = relations(screen, ({ one }) => ({
  currentExperience: one(experience, {
    fields: [screen.currentExperienceId],
    references: [experience.id],
  }),
  currentMedia: one(mediaAsset, {
    fields: [screen.currentMediaAssetId],
    references: [mediaAsset.id],
  }),
}));

// ─── Media Asset Relations ────────────────────────────────────────────────────

export const mediaAssetRelations = relations(mediaAsset, ({ one }) => ({
  uploadedBy: one(user, {
    fields: [mediaAsset.uploadedByUserId],
    references: [user.id],
  }),
}));
