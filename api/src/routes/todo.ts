import { Hono } from "hono";
import { requireMembership, type AppEnv } from "../context.ts";
import { myTodo } from "../services/todo.ts";

export const todoRoutes = new Hono<AppEnv>();

/** What the signed-in person has to test in this team: unfinished runs, then guides they haven't started. */
todoRoutes.get("/todo", async (c) => {
  const { teamId } = await requireMembership(c);
  return c.json(await myTodo(c.var.db, teamId, c.var.user.id));
});
