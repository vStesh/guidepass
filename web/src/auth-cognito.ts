import { Amplify } from "aws-amplify";
import { confirmSignIn, fetchAuthSession, signIn, signOut } from "aws-amplify/auth";
import type { Auth, SignInStep } from "./auth.ts";
import type { RuntimeConfig } from "./config.ts";
import { defaultPasswordPolicy } from "./password.ts";

function step(nextStep: { signInStep: string }): SignInStep {
  switch (nextStep.signInStep) {
    case "DONE":
      return { kind: "done" };
    case "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED":
      return { kind: "newPassword" };
    case "CONFIRM_SIGN_IN_WITH_TOTP_CODE":
    case "CONFIRM_SIGN_IN_WITH_SMS_CODE":
    case "CONFIRM_SIGN_IN_WITH_EMAIL_CODE":
      return { kind: "code" };
    default:
      throw new Error(`Unsupported sign-in step: ${nextStep.signInStep}`);
  }
}

export function cognitoAuth(config: Extract<RuntimeConfig, { authMode: "cognito" }>): Auth {
  Amplify.configure({
    Auth: { Cognito: { userPoolId: config.cognitoUserPoolId, userPoolClientId: config.cognitoClientId } },
  });
  return {
    mode: "cognito",
    passwordPolicy: { ...defaultPasswordPolicy, ...config.passwordPolicy },
    async headers() {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      return token ? { authorization: `Bearer ${token}` } : null;
    },
    async signIn(email, password) {
      return step((await signIn({ username: email, password })).nextStep);
    },
    async confirm(answer) {
      return step((await confirmSignIn({ challengeResponse: answer })).nextStep);
    },
    async signOut() {
      await signOut();
    },
  };
}

