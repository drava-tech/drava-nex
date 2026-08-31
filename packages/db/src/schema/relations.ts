import { relations } from "drizzle-orm";
import { user, session } from "./auth.js";
import { experience } from "./projects.js";
import { experienceType, experienceToType } from "./experience-types.js";
import { screen } from "./screens.js";
import { mediaAsset } from "./media.js";
import {
  product,
  productFeature,
  productSpecification,
  productMedia,
} from "./products.js";
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
} from "./portfolio.js";

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
  portfolioVerticals: many(portfolioVertical),
  portfolioSettings: one(portfolioSettings),
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
    relationName: "screenCurrentMedia",
  }),
  defaultMedia: one(mediaAsset, {
    fields: [screen.defaultMediaAssetId],
    references: [mediaAsset.id],
    relationName: "screenDefaultMedia",
  }),
}));

// ─── Media Asset Relations ────────────────────────────────────────────────────

export const mediaAssetRelations = relations(mediaAsset, ({ one }) => ({
  uploadedBy: one(user, {
    fields: [mediaAsset.uploadedByUserId],
    references: [user.id],
  }),
}));

// ─── Product Relations ────────────────────────────────────────────────────────

export const productRelations = relations(product, ({ one, many }) => ({
  createdBy: one(user, {
    fields: [product.createdByUserId],
    references: [user.id],
  }),
  thumbnail: one(mediaAsset, {
    fields: [product.thumbnailMediaId],
    references: [mediaAsset.id],
    relationName: "productThumbnail",
  }),
  hero: one(mediaAsset, {
    fields: [product.heroMediaId],
    references: [mediaAsset.id],
    relationName: "productHero",
  }),
  demoVideo: one(mediaAsset, {
    fields: [product.demoVideoMediaId],
    references: [mediaAsset.id],
    relationName: "productDemoVideo",
  }),
  features: many(productFeature),
  specifications: many(productSpecification),
  media: many(productMedia),
}));

export const productFeatureRelations = relations(productFeature, ({ one }) => ({
  product: one(product, {
    fields: [productFeature.productId],
    references: [product.id],
  }),
}));

export const productSpecificationRelations = relations(
  productSpecification,
  ({ one }) => ({
    product: one(product, {
      fields: [productSpecification.productId],
      references: [product.id],
    }),
  })
);

export const productMediaRelations = relations(productMedia, ({ one }) => ({
  product: one(product, {
    fields: [productMedia.productId],
    references: [product.id],
  }),
  media: one(mediaAsset, {
    fields: [productMedia.mediaId],
    references: [mediaAsset.id],
  }),
}));

// ─── Portfolio Relations ───────────────────────────────────────────────────────

export const portfolioVerticalRelations = relations(portfolioVertical, ({ one, many }) => ({
  experience: one(experience, {
    fields: [portfolioVertical.experienceId],
    references: [experience.id],
  }),
  categories: many(portfolioCategory),
}));

export const portfolioCategoryRelations = relations(portfolioCategory, ({ one, many }) => ({
  vertical: one(portfolioVertical, {
    fields: [portfolioCategory.verticalId],
    references: [portfolioVertical.id],
  }),
  images: many(portfolioCategoryImage),
  videos: many(portfolioCategoryVideo),
  projects: many(portfolioProject),
}));

export const portfolioCategoryImageRelations = relations(portfolioCategoryImage, ({ one }) => ({
  category: one(portfolioCategory, {
    fields: [portfolioCategoryImage.categoryId],
    references: [portfolioCategory.id],
  }),
}));

export const portfolioCategoryVideoRelations = relations(portfolioCategoryVideo, ({ one }) => ({
  category: one(portfolioCategory, {
    fields: [portfolioCategoryVideo.categoryId],
    references: [portfolioCategory.id],
  }),
}));

export const portfolioProjectRelations = relations(portfolioProject, ({ one, many }) => ({
  category: one(portfolioCategory, {
    fields: [portfolioProject.categoryId],
    references: [portfolioCategory.id],
  }),
  company: one(company, {
    fields: [portfolioProject.companyId],
    references: [company.id],
  }),
  images: many(portfolioProjectImage),
  videos: many(portfolioProjectVideo),
}));

export const portfolioProjectImageRelations = relations(portfolioProjectImage, ({ one }) => ({
  project: one(portfolioProject, {
    fields: [portfolioProjectImage.projectId],
    references: [portfolioProject.id],
  }),
}));

export const portfolioProjectVideoRelations = relations(portfolioProjectVideo, ({ one }) => ({
  project: one(portfolioProject, {
    fields: [portfolioProjectVideo.projectId],
    references: [portfolioProject.id],
  }),
}));

export const companyRelations = relations(company, ({ many }) => ({
  projects: many(portfolioProject),
}));

export const portfolioSettingsRelations = relations(portfolioSettings, ({ one }) => ({
  experience: one(experience, {
    fields: [portfolioSettings.experienceId],
    references: [experience.id],
  }),
}));
