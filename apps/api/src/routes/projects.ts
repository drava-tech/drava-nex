import { Hono } from "hono";
import { listProjectVerticals } from "@platform/db";

// GET /api/projects — public "verticals" list (shape kept: { verticals }).
export const projectsRouter = new Hono();

projectsRouter.get("/", async (c) => {
  return c.json({ verticals: await listProjectVerticals() });
});
