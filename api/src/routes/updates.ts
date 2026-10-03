import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import { getUpdateStatus } from "../services/updates.ts";
import { validate } from "../validate.ts";
import { VERSION } from "../version.ts";

export const updateRoutes = new Hono<AppEnv>();

/** This instance's version. */
updateRoutes.get("/version", async (c) => {
  await requireMembership(c);
  return c.json({ version: VERSION });
});

/** Whether a newer release exists, for owners, who update the instance. */
updateRoutes.get(
  "/updates",
  validate("query", z.object({ refresh: z.enum(["1"]).optional() })),
  async (c) => {
    await requireMembership(c, "owner");
    return c.json(
      await getUpdateStatus(c.var.db, {
        repository: c.var.updates.repository,
        fetch: c.var.updates.fetch,
        refresh: c.req.valid("query").refresh === "1",
      }),
    );
  },
);
