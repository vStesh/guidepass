import { describe, expect, it } from "vitest";
import { slugify } from "./components/ui.tsx";

describe("slugify", () => {
  it("transliterates Ukrainian", () => {
    expect(slugify("Адмінка")).toBe("adminka");
    expect(slugify("Мобільний застосунок")).toBe("mobilnyi-zastosunok");
    expect(slugify("Svitlofour v2")).toBe("svitlofour-v2");
  });

  it("respects a maximum length without a trailing dash", () => {
    const key = slugify("Мобільний застосунок для батьків", 26);
    expect(key.length).toBeLessThanOrEqual(26);
    expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
