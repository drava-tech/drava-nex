// ─── Auth Tables (Better Auth) ────────────────────────────────────────────────
export { user, session, account, verification, userRoleEnum } from "./auth.js";

// ─── CMS Tables ───────────────────────────────────────────────────────────────
export { project, projectStatusEnum } from "./projects.js";

// ─── Relations ────────────────────────────────────────────────────────────────
export { userRelations, sessionRelations, projectRelations } from "./relations.js";

// ─── Inferred Types ───────────────────────────────────────────────────────────
export type { User, NewUser, Session, Account } from "./auth.js";
export type { Project, NewProject } from "./projects.js";
