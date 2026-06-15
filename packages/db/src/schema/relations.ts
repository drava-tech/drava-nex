import { relations } from "drizzle-orm";
import { user, session } from "./auth.js";
import { project } from "./projects.js";

// ─── Auth Relations ───────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  createdProjects: many(project, { relationName: "projectCreatedBy" }),
  updatedProjects: many(project, { relationName: "projectUpdatedBy" }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

// ─── Project Relations ────────────────────────────────────────────────────────

export const projectRelations = relations(project, ({ one }) => ({
  createdBy: one(user, {
    fields: [project.createdByUserId],
    references: [user.id],
    relationName: "projectCreatedBy",
  }),
  updatedBy: one(user, {
    fields: [project.updatedByUserId],
    references: [user.id],
    relationName: "projectUpdatedBy",
  }),
}));
