import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { Hono } from "hono";
import { evidenceTypes, type EvidenceStorage } from "./storage.ts";

/**
 * Local development only: screenshots in a folder, "uploaded" and served by the
 * local API under `/api/local-evidence`, the way S3 would with signed forms and links.
 */
export function localEvidenceStorage(root: string): { storage: EvidenceStorage; routes: Hono } {
  const types = new Map<string, string>();
  const path = (key: string) => {
    const base = normalize(root) + sep;
    const full = normalize(join(root, key));
    if (!full.startsWith(base)) throw new Error("Bad key");
    return full;
  };

  const storage: EvidenceStorage = {
    async presignUpload(key, contentType) {
      return { url: "/api/local-evidence", fields: { key, "Content-Type": contentType } };
    },
    async head(key) {
      try {
        const info = await stat(path(key));
        return { size: info.size, contentType: types.get(key) ?? "" };
      } catch {
        return null;
      }
    },
    async viewUrl(key) {
      return `/api/local-evidence/${key}`;
    },
    async remove(key) {
      await rm(path(key), { force: true });
    },
  };

  const routes = new Hono()
    .post("/local-evidence", async (c) => {
      const form = await c.req.formData();
      const key = String(form.get("key"));
      const file = form.get("file");
      const type = String(form.get("Content-Type"));
      if (!(file instanceof File) || !(evidenceTypes as readonly string[]).includes(type)) return c.body(null, 400);
      await mkdir(dirname(path(key)), { recursive: true });
      await writeFile(path(key), Buffer.from(await file.arrayBuffer()));
      types.set(key, type);
      return c.body(null, 204);
    })
    .get("/local-evidence/*", async (c) => {
      const key = c.req.path.replace(/^.*\/local-evidence\//, "");
      try {
        return c.body(await readFile(path(key)), 200, { "content-type": types.get(key) ?? "image/jpeg" });
      } catch {
        return c.body(null, 404);
      }
    });

  return { storage, routes };
}
