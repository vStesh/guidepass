import { describe, expect, it } from "vitest";
import { retryWhileResuming } from "./client.ts";

const resuming = Object.assign(new Error("resuming"), { name: "DatabaseResumingException" });

function fakeClient(failures: number, error: Error = resuming) {
  let calls = 0;
  const client = {
    send: async (..._args: never[]) => {
      calls++;
      if (calls <= failures) throw error;
      return "ok";
    },
  };
  return { client, calls: () => calls };
}

describe("retryWhileResuming", () => {
  const noSleep = async () => {};

  it("retries while the database resumes", async () => {
    const { client, calls } = fakeClient(3);
    retryWhileResuming(client, 22_000, noSleep);
    await expect(client.send()).resolves.toBe("ok");
    expect(calls()).toBe(4);
  });

  it("gives up when the wait budget runs out", async () => {
    const { client } = fakeClient(100);
    retryWhileResuming(client, 22_000, noSleep);
    await expect(client.send()).rejects.toThrow("resuming");
  });

  it("does not retry other errors", async () => {
    const { client, calls } = fakeClient(1, new Error("syntax error"));
    retryWhileResuming(client, 22_000, noSleep);
    await expect(client.send()).rejects.toThrow("syntax error");
    expect(calls()).toBe(1);
  });
});
