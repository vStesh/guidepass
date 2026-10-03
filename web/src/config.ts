import type { PasswordPolicy } from "./password.ts";

export type RuntimeConfig =
  | { authMode: "cognito"; cognitoUserPoolId: string; cognitoClientId: string; passwordPolicy?: PasswordPolicy }
  | { authMode: "local" };

/**
 * Read at startup from `/config.json`, which Terraform writes next to the app,
 * so one build works for every instance. Without it (local development) the app
 * uses local sign-in against the dev API.
 */
export async function loadConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (response.ok && response.headers.get("content-type")?.includes("json")) {
      const config = (await response.json()) as RuntimeConfig;
      if (config.authMode === "cognito" && config.cognitoUserPoolId && config.cognitoClientId) return config;
    }
  } catch {
    // Fall through to local mode.
  }
  return { authMode: "local" };
}
