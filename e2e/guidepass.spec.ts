import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { apiAs, ok, owner, screenshotPng, signIn, tester } from "./helpers.ts";

const example = JSON.parse(readFileSync(new URL("../packages/schema/examples/build-179.json", import.meta.url), "utf8"));

// One instance for the whole file: the owner sets it up, a tester runs a guide,
// the owner reads the results. Each test builds on the one before.
test.describe.configure({ mode: "serial" });

let guideId: string;

test("the owner sets up the team, names themselves and uploads a guide", async ({ page }) => {
  await signIn(page, owner);
  await page.getByLabel("Team name").fill("Acme");
  await page.getByRole("button", { name: "Create team" }).click();

  // People without a name are asked for one.
  await expect(page.getByText("What's your name?")).toBeVisible();
  await page.getByLabel("Name").first().fill("Olena");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("What's your name?")).toBeHidden();
  await expect(page.locator(".footer")).toContainText(/Guidepass \d+\.\d+\.\d+/);

  // An app and a guide, uploaded through the web app with the dry-run check first.
  const app = await ok(
    await (await apiAs(owner)).post("apps", { data: { slug: "acme-mobile", name: "Acme mobile", platforms: ["ios", "android"] } }),
  );
  await page.goto(`/apps/${app.app.id}`);
  await page.getByRole("button", { name: "Upload a guide" }).click();
  await page.getByLabel("Guide id").fill("build-179");
  await page.getByLabel("Guide JSON").fill(JSON.stringify(example));
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByRole("link", { name: /Build 179/ })).toBeVisible();
  guideId = (await ok(await (await apiAs(owner)).get("guides"))).guides[0].id;

  // Invite a tester; they join on first sign-in.
  await ok(await (await apiAs(owner)).post("invitations", { data: { email: tester, name: "Taras", role: "tester" } }));
});

test("a tester runs the guide on a phone, with a screenshot as proof of a fail @phone", async ({ page }) => {
  await signIn(page, tester);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.getByRole("link", { name: /Build 179/ }).click();

  await page.getByLabel("Platform").selectOption("android");
  await page.getByLabel("Device").fill("Pixel 7");
  await page.getByLabel("Build tested").fill("181");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\//);
  await expect(page.getByText("build 181")).toBeVisible();

  const reply = page.locator(".run-card").filter({ hasText: "Reply to a comment" });
  // A fail without proof is refused before anything is sent.
  await reply.getByRole("button", { name: "Fail" }).click();
  await expect(reply.getByText(/A fail needs proof/)).toBeVisible();

  // A screenshot from the gallery: compressed in the browser, uploaded, shown.
  await reply.locator('input[type="file"]').setInputFiles(screenshotPng());
  await expect(reply.getByRole("img", { name: "Screenshot 1" })).toBeVisible();
  await reply.getByRole("button", { name: "Fail" }).click();
  await expect(reply).toHaveClass(/run-card-fail/);

  const keyboard = page.locator(".run-card").filter({ hasText: "Android: banner and keyboard" });
  await keyboard.getByRole("button", { name: "Pass" }).click();
  await expect(keyboard).toHaveClass(/run-card-pass/);

  await page.getByRole("button", { name: "Finish run" }).click();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
});

test("the owner sees the tester's result with its screenshot", async ({ page }) => {
  await signIn(page, owner);
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await page.goto(`/guides/${guideId}`);

  await expect(page.getByText("Taras").first()).toBeVisible();
  await page.locator("button.cell").filter({ hasText: "Failed" }).first().click();
  const details = page.locator(".results");
  await expect(details).toContainText("Taras");
  await expect(details).toContainText("build 181");
  await expect(details.getByRole("img", { name: "Screenshot 1" })).toBeVisible();

  // The image really is there, scaled down to at most 1600 px.
  const size = await details.getByRole("img", { name: "Screenshot 1" }).evaluate((img: HTMLImageElement) =>
    img.decode().then(() => Math.max(img.naturalWidth, img.naturalHeight)),
  );
  expect(size).toBeLessThanOrEqual(1600);
});
