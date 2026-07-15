// Visitor domain — shared zod schemas + inferred types.
// Visitors are enrolled anonymously by the face-vision service; the CMS fills
// in name/email later. Role is fixed at "guest" and never accepted from input.

import { z } from "zod";

export const listVisitorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});
export type ListVisitorsQuery = z.infer<typeof listVisitorsQuerySchema>;

// Both fields optional so partial edits work; blank strings are allowed —
// clearing a name back to anonymous is a valid operation.
export const updateVisitorSchema = z
  .object({
    name: z.string().trim().max(200).optional(),
    email: z.union([z.string().trim().email().max(320), z.literal("")]).optional(),
  })
  .refine((v) => v.name !== undefined || v.email !== undefined, {
    message: "Provide at least one of name or email.",
  });
export type UpdateVisitorInput = z.infer<typeof updateVisitorSchema>;

/** Shape the API returns for a visitor row (image served separately). */
export interface VisitorListItem {
  uuid: string;
  name: string;
  email: string;
  role: string;
  hasImage: boolean;
  firstSeen: string;
  lastSeen: string;
}
