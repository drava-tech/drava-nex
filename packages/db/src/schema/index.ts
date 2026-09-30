// ─── Auth Tables (Better Auth) ────────────────────────────────────────────────
export { user, session, account, verification, userRoleEnum } from "./auth.js";

// ─── Devices (lights, scenes, speakers — Unreal Engine / IoT control) ─────────
export { device } from "./devices.js";

// ─── CMS Tables ───────────────────────────────────────────────────────────────
export { experience } from "./projects.js";
export { experienceType, experienceToType } from "./experience-types.js";
export { screen } from "./screens.js";
export { mediaAsset } from "./media.js";
export { gmailIngestedMessage } from "./gmail-ingest.js";
export {
  product,
  productFeature,
  productSpecification,
  productMedia,
  productStatusEnum,
  productMediaPurposeEnum,
} from "./products.js";

export {
  portfolioVertical,
  portfolioCategory,
  portfolioCategoryImage,
  portfolioCategoryVideo,
  portfolioProject,
  portfolioProjectImage,
  portfolioProjectVideo,
  portfolioSettings,
  company,
  portfolioCategoryTypeEnum,
  portfolioGalleryKindEnum,
} from "./portfolio.js";

export { whiteboardDocument } from "./whiteboards.js";

// ─── Visitors (face-recognition entrance tracking) ────────────────────────────
export { visitor } from "./visitors.js";

// ─── Door Events (Yale lock webhook history) ──────────────────────────────────
export { doorEvent } from "./door-events.js";

// ─── Screen Content Push History ───────────────────────────────────────────────
export { screenContentPush } from "./screen-content-pushes.js";
export { screenStatusSample } from "./screen-status-samples.js";

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
  portfolioVerticalRelations,
  portfolioCategoryRelations,
  portfolioCategoryImageRelations,
  portfolioCategoryVideoRelations,
  portfolioProjectRelations,
  portfolioProjectImageRelations,
  portfolioProjectVideoRelations,
  companyRelations,
  portfolioSettingsRelations,
} from "./relations.js";

// ─── Inferred Types ───────────────────────────────────────────────────────────
export type { User, NewUser, Session, Account } from "./auth.js";
export type { Device, NewDevice } from "./devices.js";
export type { Experience, NewExperience } from "./projects.js";
export type { WhiteboardDocument, NewWhiteboardDocument } from "./whiteboards.js";
export type { ExperienceType, NewExperienceType } from "./experience-types.js";
export type { Screen, NewScreen } from "./screens.js";
export type { MediaAsset, NewMediaAsset } from "./media.js";
export type { GmailIngestedMessage, NewGmailIngestedMessage } from "./gmail-ingest.js";
export type { Visitor, NewVisitor } from "./visitors.js";
export type { DoorEvent, NewDoorEvent } from "./door-events.js";
export type { ScreenContentPush, NewScreenContentPush } from "./screen-content-pushes.js";
export type { ScreenStatusSample, NewScreenStatusSample } from "./screen-status-samples.js";
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
export type {
  PortfolioVertical,
  NewPortfolioVertical,
  PortfolioCategory,
  NewPortfolioCategory,
  PortfolioCategoryImage,
  NewPortfolioCategoryImage,
  PortfolioCategoryVideo,
  NewPortfolioCategoryVideo,
  PortfolioProject,
  NewPortfolioProject,
  PortfolioProjectImage,
  NewPortfolioProjectImage,
  PortfolioProjectVideo,
  NewPortfolioProjectVideo,
  PortfolioSettings,
  NewPortfolioSettings,
  Company,
  NewCompany,
} from "./portfolio.js";
export { ambientMode } from "./ambient-mode.js";
export type { AmbientMode, NewAmbientMode } from "./ambient-mode.js";

