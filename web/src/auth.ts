import type { RuntimeConfig } from "./config.ts";

/** What the sign-in screen has to ask for next. */
export type SignInStep = { kind: "done" } | { kind: "newPassword" } | { kind: "code" };

export interface Auth {
  mode: RuntimeConfig["authMode"];
  /** Headers that identify the signed-in person to the API, or null when signed out. */
  headers(): Promise<Record<string, string> | null>;
  signIn(email: string, password: string): Promise<SignInStep>;
  /** Answers a challenge: a new password or a one-time code. */
  confirm(answer: string): Promise<SignInStep>;
  signOut(): Promise<void>;
}

const LOCAL_KEY = "guidepass.localUser";

/** Development only: the local API trusts an email header, no password. */
function localAuth(): Auth {
  return {
    mode: "local",
    async headers() {
      const email = localStorage.getItem(LOCAL_KEY);
      return email ? { "x-local-user": email } : null;
    },
    async signIn(email) {
      localStorage.setItem(LOCAL_KEY, email.trim().toLowerCase());
      return { kind: "done" };
    },
    async confirm() {
      return { kind: "done" };
    },
    async signOut() {
      localStorage.removeItem(LOCAL_KEY);
    },
  };
}

/** Amplify is loaded only when the instance uses Cognito, which keeps local and first loads light. */
export async function createAuth(config: RuntimeConfig): Promise<Auth> {
  if (config.authMode === "local") return localAuth();
  const { cognitoAuth } = await import("./auth-cognito.ts");
  return cognitoAuth(config);
}
