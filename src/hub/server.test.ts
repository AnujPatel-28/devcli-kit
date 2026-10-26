import assert from "node:assert/strict";
import test from "node:test";

import { startHub, type RunningHub } from "./server.js";

async function withHub(run: (hub: RunningHub) => Promise<void>): Promise<void> {
  const hub = await startHub({ port: 0, notify: false, persist: false, token: "test-token" });
  try {
    await run(hub);
  } finally {
    await hub.close();
  }
}

function post(hub: RunningHub, route: string, body: unknown, token = hub.token): Promise<Response> {
  return fetch(`${hub.url}${route.slice(1)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-clidev-token": token },
    body: JSON.stringify(body),
  });
}

test("an agent event, an inbox reply and a waiting relay meet in the hub", async () => {
  await withHub(async (hub) => {
    const reported = await post(hub, "/api/events", {
      agent: "claude",
      sessionId: "s1",
      kind: "done",
      cwd: "/work/shop-api",
      summary: "Refactored auth",
    });
    const { askId } = (await reported.json()) as { askId: string };
    assert.ok(askId);

    const waiting = post(hub, `/api/asks/${askId}/wait`, { timeoutMs: 5_000 });
    const answered = await post(hub, `/api/asks/${askId}/reply`, { text: "now write the migration" });
    assert.equal(answered.status, 200);

    const result = (await (await waiting).json()) as { reply: { text: string } };
    assert.equal(result.reply.text, "now write the migration");

    const again = await post(hub, `/api/asks/${askId}/reply`, { text: "twice" });
    assert.equal(again.status, 409);
  });
});

test("the API refuses requests without the token", async () => {
  await withHub(async (hub) => {
    const response = await post(hub, "/api/events", { agent: "x", sessionId: "y", kind: "done" }, "wrong");
    assert.equal(response.status, 401);
    const state = await fetch(`${hub.url}api/state`);
    assert.equal(state.status, 401);
  });
});

test("the hub refuses a foreign Host header (DNS rebinding)", async () => {
  await withHub(async (hub) => {
    const http = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        { host: "127.0.0.1", port: hub.port, path: "/", headers: { host: "evil.example:80" } },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(status, 403);
  });
});

test("the inbox page embeds the token and health needs none", async () => {
  await withHub(async (hub) => {
    const page = await (await fetch(hub.url)).text();
    assert.match(page, /clidev inbox/u);
    assert.match(page, /"test-token"/u);

    const health = (await (await fetch(`${hub.url}api/health`)).json()) as { app: string };
    assert.equal(health.app, "clidev-hub");
  });
});

test("malformed events and replies are rejected", async () => {
  await withHub(async (hub) => {
    assert.equal((await post(hub, "/api/events", { agent: "claude" })).status, 400);
    const { askId } = (await (
      await post(hub, "/api/events", { agent: "claude", sessionId: "s", kind: "permission" })
    ).json()) as { askId: string };
    assert.equal((await post(hub, `/api/asks/${askId}/reply`, { decision: "maybe" })).status, 400);
  });
});
