import { CognitoJwtVerifier } from "aws-jwt-verify";

export interface Identity {
  sub: string;
  email: string;
  name?: string;
}

/** Turns a request into the signed-in person, or null when there is none. */
export type Authenticator = (request: Request) => Promise<Identity | null>;

/** Verifies a Cognito ID token sent as `Authorization: Bearer <token>`. */
export function cognitoAuthenticator(config: { userPoolId: string; clientId: string }): Authenticator {
  const verifier = CognitoJwtVerifier.create({ ...config, tokenUse: "id" });
  return async (request) => {
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return null;
    try {
      const payload = await verifier.verify(token);
      const email = payload.email;
      // Invitations are matched by email, so it has to be one the person proved they own.
      if (typeof email !== "string" || payload.email_verified !== true) return null;
      const name = typeof payload.name === "string" ? payload.name : undefined;
      return { sub: payload.sub, email, name };
    } catch {
      return null;
    }
  };
}

/**
 * Local development and tests only: trusts the `x-local-user` header as an email.
 * Never wired into the Lambda handler.
 */
export const localAuthenticator: Authenticator = async (request) => {
  const email = request.headers.get("x-local-user");
  return email ? { sub: `local:${email}`, email } : null;
};
