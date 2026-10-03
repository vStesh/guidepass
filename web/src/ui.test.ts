import { describe, expect, it } from "vitest";
import { checkPassword, defaultPasswordPolicy } from "./password.ts";
import { slugify } from "./components/ui.tsx";

describe("slugify", () => {
  it("transliterates Ukrainian", () => {
    expect(slugify("Адмінка")).toBe("adminka");
    expect(slugify("Мобільний застосунок")).toBe("mobilnyi-zastosunok");
    expect(slugify("Acme Mobile v2")).toBe("acme-mobile-v2");
  });

  it("respects a maximum length without a trailing dash", () => {
    const key = slugify("Мобільний застосунок для батьків", 26);
    expect(key.length).toBeLessThanOrEqual(26);
    expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("checkPassword", () => {
  const failed = (password: string, policy = defaultPasswordPolicy) =>
    checkPassword(password, policy).filter((r) => !r.ok).map((r) => r.rule);

  it("needs only length by default", () => {
    expect(failed("short")).toEqual(["length"]);
    expect(failed("long enough")).toEqual([]);
  });

  it("lists every rule an instance turns on", () => {
    const strict = { minLength: 10, lowercase: true, uppercase: true, numbers: true, symbols: true };
    expect(failed("abc", strict)).toEqual(["length", "uppercase", "numbers", "symbols"]);
    expect(failed("Пароль-2026x", strict)).toEqual([]);
    expect(failed("Two words 9x", strict)).toEqual([]);
  });
});

