// ─── Auth Tables (Better Auth) ────────────────────────────────────────────────
export { user, session, account, verification, userRoleEnum } from "./auth.js";

// ─── CMS Tables ───────────────────────────────────────────────────────────────
export { experience } from "./projects.js";
export { experienceType, experienceToType } from "./experience-types.js";
export { screen } from "./screens.js";
export { mediaAsset } from "./media.js";
export {
  product,
  productFeature,
  productSpecification,
  productMedia,
  productStatusEnum,
  productMediaPurposeEnum,
} from "./products.js";

// ─── Relations ────────────────────────────────────────────────────────────────
export {
  userRelations,
  sessionRelations,
  experienceRelations,
  experienceTypeRelations,
  experienceToTypeRelations,
  screenRelations,
  mediaAssetRelations,
  productRelations,
  productFeatureRelations,
  productSpecificationRelations,
  productMediaRelations,
} from "./relations.js";

// ─── Inferred Types ───────────────────────────────────────────────────────────
export type { User, NewUser, Session, Account } from "./auth.js";
export type { Experience, NewExperience } from "./projects.js";
export type { ExperienceType, NewExperienceType } from "./experience-types.js";
export type { Screen, NewScreen } from "./screens.js";
export type { MediaAsset, NewMediaAsset } from "./media.js";
export type {
  Product,
  NewProduct,
  ProductFeature,
  NewProductFeature,
  ProductSpecification,
  NewProductSpecification,
  ProductMedia,
  NewProductMedia,
} from "./products.js";
