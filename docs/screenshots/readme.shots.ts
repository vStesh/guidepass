import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { devices, expect, test, type Page } from "@playwright/test";
import { apiAs, ok, signIn } from "../../e2e/helpers.ts";

// Demo data and screenshots for the README (docs/images). Frames for the
// animated run go to docs/screenshots/frames; make-gif.py turns them into a GIF.

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const guide = read("./demo-guide.json");
const olderGuide = read("../../packages/schema/examples/build-179.json");
const image = (name: string) => fileURLToPath(new URL(`../images/${name}`, import.meta.url));
const frameDir = fileURLToPath(new URL("./frames/", import.meta.url));

const owner = "olena@example.com";
const taras = "taras@example.com";
const maria = "maria@example.com";
const iryna = "iryna@example.com";

type Result = { status: string; note?: string; evidence?: string; issueUrl?: string };

/** Scrolls an element to just below the sticky header, so it isn't covered. */
async function bringIntoView(page: Page, selector: ReturnType<Page["locator"]>) {
  await selector.evaluate((el) => {
    const header = document.querySelector(".topbar")?.getBoundingClientRect().height ?? 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - header - 12, behavior: "instant" });
  });
}

async function runGuide(email: string, guideId: string, run: Record<string, string>, results: Record<string, Result>, finish = true) {
  const api = await apiAs(email);
  const { run: created } = await ok(await api.post(`guides/${guideId}/runs`, { data: run }));
  for (const [key, result] of Object.entries(results)) await ok(await api.put(`runs/${created.id}/results/${key}`, { data: result }));
  if (finish) await ok(await api.patch(`runs/${created.id}`, { data: { finished: true } }));
}

test("README screenshots", async ({ browser }) => {
  test.setTimeout(180_000);
  mkdirSync(frameDir, { recursive: true });

  // The team, the app and the guides, the way an owner and an agent would set them up.
  const o = await apiAs(owner);
  await ok(await o.post("setup", { data: { teamName: "Acme" } }));
  await ok(await o.patch("me", { data: { name: "Olena" } }));
  const { app } = await ok(await o.post("apps", { data: { slug: "acme-mobile", name: "Acme mobile", platforms: ["ios", "android"] } }));
  const { area } = await ok(await o.post(`apps/${app.id}/areas`, { data: { slug: "comments", name: "Comments" } }));
  await ok(await o.post(`apps/${app.id}/guides`, { data: { slug: "build-179", areaId: area.id, content: olderGuide } }));
  const { guideId } = await ok(await o.post(`apps/${app.id}/guides`, { data: { slug: "build-182", areaId: area.id, content: guide } }));
  for (const [email, name] of [[taras, "Taras"], [maria, "Maria"], [iryna, "Iryna"]] as const) {
    await ok(await o.post("invitations", { data: { email, name } }));
    await ok(await (await apiAs(email)).get("me"));
  }

  // Results from three people on two platforms and two environments.
  await runGuide(taras, guideId, { environment: "dev", platform: "ios", device: "iPhone 15 Pro · iOS 18.1", build: "182" }, {
    "reply-to-comment": { status: "pass" },
    "reply-to-reply": { status: "pass" },
    "reply-notification": { status: "pass" },
    "deleted-comment": { status: "pass" },
    "pull-to-retry": { status: "pass" },
  });
  await runGuide(maria, guideId, { environment: "dev", platform: "android", device: "Pixel 8 · Android 15", build: "182" }, {
    "reply-to-comment": { status: "pass" },
    "reply-to-reply": { status: "pass" },
    "reply-notification": { status: "blocked", note: "Pushes are off on the dev backend for Android this week." },
    "deleted-comment": { status: "pass" },
    "android-keyboard": {
      status: "fail",
      note: "After the back gesture the banner slides under the keyboard and the input loses focus.",
      evidence: "Screen recording: https://example.com/recordings/182-keyboard.mp4",
      issueUrl: "https://github.com/acme/mobile/issues/431",
    },
    "pull-to-retry": { status: "pass" },
  });
  await runGuide(owner, guideId, { environment: "stg", platform: "ios", device: "iPhone 13 · iOS 17.6", build: "182" }, {
    "reply-to-comment": { status: "pass" },
    "old-backend-flat-list": { status: "pass" },
    "pull-to-retry": { status: "skip", note: "No airplane mode on this test phone." },
  }, false);
  await ok(await (await apiAs(iryna)).post("devices", { data: { name: "My iPhone", platform: "ios", model: "iPhone 16", os: "iOS 18.2" } }));

  // Desktop: the guide with everyone's results.
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
  const page = await desktop.newPage();
  await signIn(page, owner);
  await page.getByRole("link", { name: /Build 182/ }).click();
  await page.locator("button.cell").filter({ hasText: "Failed" }).first().click();
  await expect(page.locator(".results")).toContainText("Maria");
  // Element screenshots of a long page stitch the sticky header in; the owner's
  // own start form isn't the point of this picture.
  await page.addStyleTag({ content: ".topbar { position: static !important; } form.start-run { display: none !important; }" });
  await page.locator("main").screenshot({ path: image("guide-results.png") });
  await desktop.close();

  // Phone: a tester starts a run with a saved device and marks scenarios.
  const phone = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2, colorScheme: "light" });
  const p = await phone.newPage();
  let frame = 0;
  const shot = (pg: Page) => pg.screenshot({ path: `${frameDir}${String(++frame).padStart(2, "0")}.png` });
  await signIn(p, iryna);
  await p.getByRole("link", { name: /Build 182/ }).click();
  await shot(p);
  const form = p.locator("form.start-run");
  await bringIntoView(p, form);
  await p.getByRole("button", { name: "My iPhone" }).click();
  await p.getByLabel("Build tested").fill("182");
  await bringIntoView(p, form);
  await shot(p);
  await p.getByRole("button", { name: "Start", exact: true }).click();
  await expect(p).toHaveURL(/\/runs\//);
  await shot(p);

  const card = (title: string) => p.locator(".run-card").filter({ hasText: title });
  for (const title of ["Reply to a comment", "Reply to a reply"]) {
    await bringIntoView(p, card(title));
    await card(title).getByRole("button", { name: "Pass" }).click();
    await expect(card(title)).toHaveClass(/run-card-pass/);
    await shot(p);
  }
  const push = card("Push about a reply");
  await bringIntoView(p, push);
  await push.getByLabel("Note").fill("No push after 2 minutes; the in-app badge shows the reply.");
  await push.getByText("Proof and issue").click();
  await push.getByLabel("Proof", { exact: true }).fill("Settings → Notifications → Acme: allowed. Device time 14:02, reply sent 14:00.");
  await push.getByRole("button", { name: "Fail" }).click();
  await expect(push).toHaveClass(/run-card-fail/);
  await bringIntoView(p, push);
  await shot(p);
  await phone.close();
});
