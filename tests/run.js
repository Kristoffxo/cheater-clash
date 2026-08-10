/* Exercises the real Cloudflare handlers against a fake KV.
   Staged into public/_cfcheck/ by tests/mirror.py, then from the browser console:
     import('/_cfcheck/run.js').then(m => m.run()).then(console.table)             */

import { onRequestGet as getState } from "./api/state.js";
import { onRequestPost as postIntent } from "./api/intent.js";
import { onRequestPost as postClaim } from "./api/claim.js";
import { onRequestGet as getQueue } from "./api/admin/queue.js";
import { onRequestPost as postDecide } from "./api/admin/decide.js";
import { onRequestPost as postReset } from "./api/admin/reset.js";
import config from "./config.js";

const TOKEN = config.admin_token;

function makeEnv(extra = {}) {
  const store = new Map();
  return {
    CLASH: {
      async get(k, type) {
        const v = store.get(k);
        if (v == null) return null;
        return type === "json" ? JSON.parse(v) : v;
      },
      async put(k, v) { store.set(k, v); },
    },
    ...extra,
  };
}

const req = (body, headers = {}) =>
  new Request("https://x/", { method: "POST", body: JSON.stringify(body), headers });
const getReq = (headers = {}) => new Request("https://x/", { headers });
const j = async (res) => ({ status: res.status, body: await res.json() });

const results = [];
const check = (name, pass, detail) =>
  results.push({ name, pass: !!pass, detail: detail === undefined ? "" : String(detail) });

/** approve a payment end to end */
async function pay(env, side, amount, name, utr) {
  const it = await j(await postIntent({ request: req({ side, amount, name }), env }));
  if (it.status !== 200) return it;
  await postClaim({ request: req({ id: it.body.id, utr }), env });
  const d = await j(await postDecide({
    request: req({ id: it.body.id, decision: "approve" }, { "X-Admin-Token": TOKEN }), env,
  }));
  return { status: d.status, body: d.body, id: it.body.id };
}

export async function run() {
  results.length = 0;

  // ─── config actually loaded ───
  check("config loaded from clash.json", config.total_cap_rupees === 10000, config.total_cap_rupees);
  check("UPI id present", !!config.upi_id, config.upi_id);

  // ─── validation ───
  let env = makeEnv();
  for (const [label, body, want] of [
    ["amount 0 rejected", { side: "men", amount: 0 }, 400],
    ["amount over per-vote max rejected", { side: "men", amount: 501 }, 400],
    ["bad side rejected", { side: "aliens", amount: 10 }, 400],
    ["non-numeric amount rejected", { side: "men", amount: "abc" }, 400],
  ]) {
    const r = await j(await postIntent({ request: req(body), env }));
    check(label, r.status === want, r.status);
  }

  // ─── name sanitising ───
  env = makeEnv();
  await postIntent({ request: req({ side: "men", amount: 5, name: "<script>alert(1)</script>" }), env });
  let q = await j(await getQueue({ request: getReq({ "X-Admin-Token": TOKEN }), env }));
  check("script tags stripped from name", !/[<>]/.test(q.body.rows[0].name), q.body.rows[0].name);

  // ─── nothing counts before approval ───
  env = makeEnv();
  const intent = await j(await postIntent({ request: req({ side: "men", amount: 100, name: "Rohit" }), env }));
  let st = await j(await getState({ env }));
  check("pending payment counts as zero", st.body.men === 0, st.body.men);

  let r = await j(await postClaim({ request: req({ id: intent.body.id, utr: "12" }), env }));
  check("short UTR rejected", r.status === 400, r.status);
  r = await j(await postClaim({ request: req({ id: intent.body.id, utr: "418329274611" }), env }));
  check("claim moves to 'claimed'", r.body.status === "claimed", JSON.stringify(r.body));

  st = await j(await getState({ env }));
  check("claimed payment still counts as zero", st.body.men === 0, st.body.men);

  const i2 = await j(await postIntent({ request: req({ side: "women", amount: 50, name: "Priya" }), env }));
  r = await j(await postClaim({ request: req({ id: i2.body.id, utr: "418329274611" }), env }));
  check("duplicate UTR rejected", r.status === 409, r.status);

  // ─── admin auth ───
  r = await j(await getQueue({ request: getReq(), env }));
  check("admin blocked with no token", r.status === 401, r.status);
  r = await j(await getQueue({ request: getReq({ "X-Admin-Token": "hunter2" }), env }));
  check("admin blocked with wrong token", r.status === 401, r.status);
  r = await j(await getQueue({ request: getReq({ "X-Admin-Token": TOKEN }), env }));
  check("admin allowed with right token", r.status === 200, r.status);

  // ─── approve / reject ───
  r = await j(await postDecide({ request: req({ id: intent.body.id, decision: "approve" }, { "X-Admin-Token": TOKEN }), env }));
  check("approve succeeds", r.status === 200, r.status);
  st = await j(await getState({ env }));
  check("approved money counts", st.body.men === 100, st.body.men);
  check("shows on leaderboard", st.body.top[0] && st.body.top[0].name === "Rohit", JSON.stringify(st.body.top));
  check("shows in ticker", st.body.recent[0] && st.body.recent[0].amount === 100, JSON.stringify(st.body.recent));

  await postDecide({ request: req({ id: i2.body.id, decision: "reject" }, { "X-Admin-Token": TOKEN }), env });
  st = await j(await getState({ env }));
  check("rejected money does not count", st.body.women === 0, st.body.women);

  // ─── the Cloudflare secret beats the committed placeholder ───
  const envSecret = makeEnv({ ADMIN_TOKEN: "s3cret-from-cloudflare" });
  r = await j(await getQueue({ request: getReq({ "X-Admin-Token": TOKEN }), env: envSecret }));
  check("clash.json token ignored once ADMIN_TOKEN is set", r.status === 401, r.status);
  r = await j(await getQueue({ request: getReq({ "X-Admin-Token": "s3cret-from-cloudflare" }), env: envSecret }));
  check("ADMIN_TOKEN accepted", r.status === 200, r.status);

  // ─── THE CAP ───
  // seed men a little so women can't take the whole pot and trip the per-side
  // cap first — we want the total cap under test here
  env = makeEnv();
  await pay(env, "men", 100, "Seed", "111000111");

  let blocked = null;
  for (let i = 0; i < 40; i++) {
    const res = await pay(env, "women", 500, "F" + i, "90000" + i);
    if (res.status !== 200) { blocked = res; break; }
  }
  st = await j(await getState({ env }));
  check("₹500 refused when less room remains", blocked && blocked.status === 400, blocked && blocked.body.message);
  check("pot never exceeds cap", st.body.collected <= st.body.cap, st.body.collected);

  await pay(env, "women", st.body.headroom.women, "LastRupee", "777777777");
  st = await j(await getState({ env }));
  check("lands on exactly ₹10,000", st.body.collected === st.body.cap, st.body.collected);
  check("season closed by cap", st.body.status === "ended" && st.body.ended_reason === "cap",
    st.body.status + "/" + st.body.ended_reason);
  check("winner declared", st.body.winner === "women", st.body.winner);

  r = await j(await postIntent({ request: req({ side: "men", amount: 1, name: "toolate" }), env }));
  check("no new payments after close", r.status === 409, r.status);

  // ─── a payment approved after the pot filled must never count ───
  env = makeEnv();
  const parked = await j(await postIntent({ request: req({ side: "men", amount: 500, name: "SlowPoke" }), env }));
  await postClaim({ request: req({ id: parked.body.id, utr: "999000111222" }), env });
  for (let i = 0; i < 19; i++) {
    if ((await pay(env, "women", 500, "G" + i, "5000" + i)).status !== 200) break;
  }
  await pay(env, "women", 100, "TopUp", "444000444");   // leaves only ₹400

  const before = (await j(await getState({ env }))).body.collected;
  r = await j(await postDecide({ request: req({ id: parked.body.id, decision: "approve" }, { "X-Admin-Token": TOKEN }), env }));
  st = await j(await getState({ env }));
  check("late approval refused as over-cap", r.status === 409, r.body.message);
  check("late approval added nothing", st.body.collected === before, before + " -> " + st.body.collected);
  q = await j(await getQueue({ request: getReq({ "X-Admin-Token": TOKEN }), env }));
  const slow = q.body.rows.find((x) => x.name === "SlowPoke");
  check("late payment flagged for refund", slow && slow.status === "refund_due", slow && slow.status);

  // ─── season reset ───
  await postReset({ request: req({}, { "X-Admin-Token": TOKEN }), env });
  st = await j(await getState({ env }));
  check("reset opens a clean season 2", st.body.season === 2 && st.body.collected === 0,
    st.body.season + "/" + st.body.collected);
  check("old season filed in history", st.body.history.length === 1 && st.body.history[0].number === 1,
    JSON.stringify(st.body.history[0] || null));
  check("new season is live", st.body.status === "live", st.body.status);

  const failed = results.filter((x) => !x.pass);
  console.log(failed.length ? `❌ ${failed.length} of ${results.length} FAILED` : `✅ all ${results.length} passed`);
  return results;
}
