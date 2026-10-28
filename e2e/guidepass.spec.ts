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

test("a tester runs the guide on a phone, with a screenshot as proof of a fail @phone", async ({ page }, testInfo) => {
  await signIn(page, tester);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

  // The tester saves their phone once in the profile (one per project: they share the instance)...
  const deviceName = `Test Pixel (${testInfo.project.name})`;
  await page.goto("/profile");
  const devices = page.locator("#devices");
  await devices.getByLabel("Name").fill(deviceName);
  await devices.getByLabel("Platform").selectOption("android");
  await devices.getByLabel("Model").fill("Pixel 7");
  await devices.getByLabel("OS version").fill("Android 15");
  await devices.getByRole("button", { name: "Add device" }).click();
  await expect(devices.locator(".list-item").filter({ hasText: deviceName })).toContainText("Pixel 7 · Android 15");

  // ...and picks it with one tap when starting a run.
  await page.goto("/");
  await page.getByRole("link", { name: /Build 179/ }).click();
  await page.getByRole("button", { name: deviceName }).click();
  await expect(page.getByLabel("Platform")).toHaveValue("android");
  await expect(page.getByLabel("Device")).toHaveValue("Pixel 7 · Android 15");
  await expect(page.getByRole("button", { name: deviceName })).toHaveAttribute("aria-pressed", "true");
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

test("the owner starts a second team and switches between the two", async ({ page }) => {
  await signIn(page, owner);
  await page.goto("/team");
  await page.getByLabel("New team").fill("School+");
  await page.getByRole("button", { name: "Create team" }).click();

  // The app reloads in the new team: its own, empty list of apps.
  const switcher = page.getByLabel("Team", { exact: true });
  await expect(switcher).toHaveValue(/.+/);
  await expect(switcher.locator("option:checked")).toHaveText("School+");
  await page.goto("/apps");
  await expect(page.getByText("Add the first app your team tests.")).toBeVisible();
  await expect(page.getByText("Acme mobile")).toHaveCount(0);

  await switcher.selectOption({ label: "Acme" });
  await expect(page.getByRole("link", { name: /Build 179/ })).toBeVisible();
  await page.goto("/apps");
  await expect(page.getByText("Acme mobile")).toBeVisible();

  // A link from Slack or an agent carries its team and opens the page there.
  const { teams } = await ok(await (await apiAs(owner)).get("me"));
  const school = teams.find((t: { name: string }) => t.name === "School+");
  await page.goto(`/apps?team=${school.id}`);
  await expect(switcher.locator("option:checked")).toHaveText("School+");
  await expect(page.getByText("Add the first app your team tests.")).toBeVisible();
  await expect(page).toHaveURL(/\/apps$/);
});

test("the owner archives an app the team no longer tests, then restores it", async ({ page }) => {
  const old = await ok(
    await (await apiAs(owner)).post("apps", { data: { slug: "old-app", name: "Old app", platforms: ["web"] } }),
  );
  await signIn(page, owner);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`/apps/${old.app.id}`);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText(/This app is archived/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload a guide" })).toHaveCount(0);

  await page.goto("/apps");
  await expect(page.locator("main > ul.list")).not.toContainText("Old app");
  await page.getByText("Archived apps (1)").click();
  await page.getByRole("link", { name: /Old app/ }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText(/This app is archived/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload a guide" })).toBeVisible();
});
