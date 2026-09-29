import { handle } from "hono/aws-lambda";
import { createApp } from "./app.ts";
import { cognitoAuthenticator } from "./auth.ts";
import { required } from "./config.ts";
import { createDataApiDb } from "./db/client.ts";

/** API Lambda behind API Gateway. Always uses Cognito; local auth is never available here. */
export const handler = handle(
  createApp({
    db: createDataApiDb({
      resourceArn: required("DB_CLUSTER_ARN"),
      secretArn: required("DB_SECRET_ARN"),
      database: required("DB_NAME"),
    }),
    authenticate: cognitoAuthenticator({
      userPoolId: required("COGNITO_USER_POOL_ID"),
      clientId: required("COGNITO_CLIENT_ID"),
    }),
    ownerEmail: required("OWNER_EMAIL"),
  }),
);
