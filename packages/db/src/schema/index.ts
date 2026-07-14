// ─── Auth Tables (Better Auth) ────────────────────────────────────────────────
export { user, session, account, verification, userRoleEnum } from "./auth.js";

// ─── API Keys (machine clients: Unreal Engine, IoT) ───────────────────────────
export { apiKey } from "./api-keys.js";

// ─── Devices (lights, scenes, speakers — Unreal Engine / IoT control) ─────────
export { device } from "./devices.js";

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

// ─── Visitors (face-recognition entrance tracking) ────────────────────────────
export { visitor } from "./visitors.js";

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
export type { ApiKey, NewApiKey } from "./api-keys.js";
export type { Device, NewDevice } from "./devices.js";
export type { Experience, NewExperience } from "./projects.js";
export type { ExperienceType, NewExperienceType } from "./experience-types.js";
export type { Screen, NewScreen } from "./screens.js";
export type { MediaAsset, NewMediaAsset } from "./media.js";
export type { Visitor, NewVisitor } from "./visitors.js";
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
