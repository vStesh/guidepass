import { crc32, deflateSync } from "node:zlib";
import { expect, request, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

export const API = "http://127.0.0.1:8797/api";
export const owner = "owner@example.com";
export const tester = "tester@example.com";

/** The local API trusts `x-local-user`, so tests can prepare data the way an agent or owner would. */
export async function apiAs(email: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL: `${API}/`, extraHTTPHeaders: { "x-local-user": email } });
}

export async function ok(response: APIResponse) {
  expect(response.ok(), `${response.url()} → ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

/** Local sign-in: any email, no password (the web app runs without /config.json). */
export async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** A real PNG (solid colour, like a big phone screenshot) the browser can decode and compress. */
export function screenshotPng(width = 1200, height = 2400) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([0x3b, 0x82, 0xf6], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return { name: "screenshot.png", mimeType: "image/png", buffer: png };
}
