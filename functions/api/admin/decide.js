import { loadSeason, saveSeason, headroom, applyApproval, json } from "../../_lib.js";
import { authed } from "./queue.js";

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  let body = {};
  try { body = await request.json(); } catch { /* treated as empty */ }

  const s = await loadSeason(env);
  const vote = s.queue.find((v) => v.id === body.id);
  if (!vote) return json({ error: "not_found" }, 404);

  const decision = body.decision;

  if (decision === "approve") {
    const room = headroom(s, vote.side);
    if (vote.amount > room) {
      // Would breach the cap. Never count it — flag it for a refund instead.
      vote.status = "refund_due";
      await saveSeason(env, s);
      return json({
        error: "would_exceed_cap",
        message: `Only ₹${room} of room left. Marked for refund.`,
      }, 409);
    }
    if (vote.utr) s.usedUtrs = [vote.utr, ...(s.usedUtrs || [])].slice(0, 500);
    applyApproval(s, vote);
  } else if (decision === "reject") {
    s.queue = s.queue.filter((v) => v.id !== vote.id);
  } else if (decision === "refunded") {
    s.queue = s.queue.filter((v) => v.id !== vote.id);
  } else {
    return json({ error: "bad_decision" }, 400);
  }

  await saveSeason(env, s);
  return json({ ok: true });
}
