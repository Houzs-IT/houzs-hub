// The hub cron starts each ERP's Mail Sync workflow (src/services/mailSyncKick.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { kickMailSyncs, MAIL_SYNC_TARGETS } from "../src/services/mailSyncKick.ts";

const recorder = (status = 204) => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, init }); return new Response(status === 204 ? null : "bad credentials", { status }); };
  return { calls, fetcher };
};

test("dispatches every ERP's mail-sync on main with its org's token", async () => {
  const { calls, fetcher } = recorder();
  const rs = await kickMailSyncs({ GH_DISPATCH_TOKEN_HOUZS_CENTURY: "a", GH_DISPATCH_TOKEN_HOUZS_IT: "b" }, MAIL_SYNC_TARGETS, fetcher);
  assert.deepEqual(rs.map((r) => [r.system, r.status]), [["HC", 204], ["HK", 204], ["CARRES", 204]]);
  assert.equal(calls[0].url, "https://api.github.com/repos/Houzs-Century/Houzs-ERP/actions/workflows/mail-sync.yml/dispatches");
  assert.equal(calls[0].init.headers.Authorization, "Bearer a");
  assert.equal(calls[2].init.headers.Authorization, "Bearer b");
  assert.deepEqual(JSON.parse(calls[1].init.body), { ref: "main", inputs: { since_days: "1" } });
});

test("a missing token skips that ERP without calling GitHub", async () => {
  const { calls, fetcher } = recorder();
  const rs = await kickMailSyncs({ GH_DISPATCH_TOKEN_HOUZS_IT: "b" }, MAIL_SYNC_TARGETS, fetcher);
  assert.equal(rs[0].status, "no-token");
  assert.equal(calls.length, 2);
});

test("a GitHub refusal is reported, not thrown", async () => {
  const { fetcher } = recorder(401);
  const rs = await kickMailSyncs({ GH_DISPATCH_TOKEN_HOUZS_CENTURY: "x" }, MAIL_SYNC_TARGETS.slice(0, 1), fetcher);
  assert.deepEqual(rs, [{ system: "HC", status: 401, detail: "bad credentials" }]);
});
