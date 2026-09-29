import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.ts";
import { cognitoAuthenticator } from "./auth.ts";
import { required } from "./config.ts";
import { createDataApiDb } from "./db/client.ts";
import { cognitoDirectory } from "./directory.ts";

/**
 * API Lambda behind API Gateway, served under `/api` on the same domain as the
 * web app. Always uses Cognito; local auth is never available here.
 */
export const handler = handle(
  new Hono().route("/api", createApp({
    db: createDataApiDb({
      resourceArn: required("DB_CLUSTER_ARN"),
      secretArn: required("DB_SECRET_ARN"),
      database: required("DB_NAME"),
    }),
    authenticate: cognitoAuthenticator({
      userPoolId: required("COGNITO_USER_POOL_ID"),
      clientId: required("COGNITO_CLIENT_ID"),
    }),
    directory: cognitoDirectory({
      userPoolId: required("COGNITO_USER_POOL_ID"),
      // "true" only when Terraform created the pool for Guidepass.
      manageUsers: process.env.COGNITO_MANAGE_USERS === "true",
    }),
    ownerEmail: required("OWNER_EMAIL"),
  })),
);
