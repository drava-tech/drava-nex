// ─── Auth Tables (Better Auth) ────────────────────────────────────────────────
export { user, session, account, verification, userRoleEnum } from "./auth.js";

// ─── CMS Tables ───────────────────────────────────────────────────────────────
export { experience } from "./projects.js";

// ─── Relations ────────────────────────────────────────────────────────────────
export { userRelations, sessionRelations, experienceRelations } from "./relations.js";

// ─── Inferred Types ───────────────────────────────────────────────────────────
export type { User, NewUser, Session, Account } from "./auth.js";
export type { Experience, NewExperience } from "./projects.js";
