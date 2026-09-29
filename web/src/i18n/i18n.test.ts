import { describe, expect, it } from "vitest";
import { en } from "./en.ts";
import { uk } from "./uk.ts";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  it("Ukrainian has every English key and nothing extra", () => {
    expect(Object.keys(uk).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps the same placeholders in every message", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(uk[key]), key).toEqual(placeholders(en[key]));
    }
  });
});
