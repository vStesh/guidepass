import root from "../../package.json" with { type: "json" };

/** This instance's Guidepass version, from the repository's package.json at build time. */
export const VERSION: string = root.version;

/**
 * Compares two `x.y.z` versions (an optional leading `v` is ignored; anything after
 * `-` makes it a pre-release, which sorts before the release). Negative when `a` is older.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre] = v.replace(/^v/, "").split("-", 2);
    return { parts: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (diff) return diff;
  }
  if (x.pre && !y.pre) return -1;
  if (!x.pre && y.pre) return 1;
  return (x.pre ?? "").localeCompare(y.pre ?? "");
}
