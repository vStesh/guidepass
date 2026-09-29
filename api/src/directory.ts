import {
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";

/**
 * The user pool, as far as invitations are concerned.
 *
 * - `created`: the pool belongs to Guidepass and Cognito emailed a temporary
 *   password — for a new account, or again for one that never signed in (the
 *   first password expires after 7 days).
 * - `exists`: the person already has an account.
 * - `missing`: no account, and Guidepass may not create one (a shared pool).
 */
export type EnsureResult = "created" | "exists" | "missing";

export interface UserDirectory {
  ensureUser(email: string): Promise<EnsureResult>;
}

/**
 * `manageUsers` is true only for a pool Terraform created for Guidepass. In a
 * shared pool (for example a project's admin pool) Guidepass never creates
 * accounts, so an invitation can't hand a tester an account in someone else's pool.
 */
export function cognitoDirectory(config: { userPoolId: string; manageUsers: boolean }): UserDirectory {
  const client = new CognitoIdentityProviderClient({});

  async function find(email: string) {
    const escaped = email.replace(/["\\]/g, "\\$&");
    const found = await client.send(
      new ListUsersCommand({ UserPoolId: config.userPoolId, Filter: `email = "${escaped}"`, Limit: 1 }),
    );
    return found.Users?.[0];
  }

  return {
    async ensureUser(email) {
      const user = await find(email);
      if (user) {
        if (!config.manageUsers || user.UserStatus !== "FORCE_CHANGE_PASSWORD") return "exists";
        await client.send(
          new AdminCreateUserCommand({ UserPoolId: config.userPoolId, Username: user.Username, MessageAction: "RESEND" }),
        );
        return "created";
      }
      if (!config.manageUsers) return "missing";
      try {
        await client.send(
          new AdminCreateUserCommand({
            UserPoolId: config.userPoolId,
            Username: email,
            UserAttributes: [
              { Name: "email", Value: email },
              // The temporary password goes to this address, so signing in proves it.
              { Name: "email_verified", Value: "true" },
            ],
            DesiredDeliveryMediums: ["EMAIL"],
          }),
        );
        return "created";
      } catch (err) {
        if (err instanceof UsernameExistsException) return "exists";
        throw err;
      }
    },
  };
}

/** Local development and tests: everyone already has an account. */
export const localDirectory: UserDirectory = {
  ensureUser: async () => "exists",
};
