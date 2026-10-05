import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.ts";
import { cognitoAuthenticator } from "./auth.ts";
import { required } from "./config.ts";
import { createDataApiDb } from "./db/client.ts";
import { cognitoDirectory } from "./directory.ts";
import { createMcpHandler } from "./mcp/server.ts";
import { s3EvidenceStorage } from "./storage.ts";
import { codebuildUpdater } from "./updater.ts";

const db = createDataApiDb({
  resourceArn: required("DB_CLUSTER_ARN"),
  secretArn: required("DB_SECRET_ARN"),
  database: required("DB_NAME"),
});

// Screenshots attached as proof, when the instance has a bucket for them.
const evidence = process.env.EVIDENCE_BUCKET ? s3EvidenceStorage(process.env.EVIDENCE_BUCKET) : null;

const api = createApp({
  db,
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
  publicUrl: required("PUBLIC_URL"),
  guideLanguage: process.env.GUIDE_LANGUAGE || "en",
  // Empty when the instance was deployed with update checks off.
  updateRepository: process.env.UPDATE_REPOSITORY || null,
  evidenceStorage: evidence,
  // The Update button, when the instance was deployed with self_update.
  updater: process.env.UPDATE_PROJECT ? codebuildUpdater(process.env.UPDATE_PROJECT) : null,
});

const mcp = createMcpHandler({
  db,
  evidenceStorage: evidence,
  guideLanguage: process.env.GUIDE_LANGUAGE || "en",
  publicUrl: required("PUBLIC_URL"),
});

/**
 * One Lambda behind API Gateway, on the same domain as the web app: the web API
 * under `/api` (Cognito sign-in; local auth is never available here) and the MCP
 * server at `/mcp` (agent tokens).
 */
export const handler = handle(
  new Hono().route("/api", api).all("/mcp", (c) => mcp(c.req.raw)),
);
