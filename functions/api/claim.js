import {
  loadSeason, saveSeason, headroom, applyApproval, verification, json,
} from "../_lib.js";

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch { /* treated as empty */ }

  const s = await loadSeason(env);
  const vote = s.queue.find((v) => v.id === body.id);

  if (!vote) {
    // already approved (approval removes it from the queue), or never existed
    return json({
      error: "not_found",
      message: "That payment reference isn't open any more.",
    }, 404);
  }
  if (vote.status === "refund_due") return json({ status: vote.status });

  const utr = String(body.utr || "").replace(/[^A-Za-z0-9]/g, "");
  if (utr.length < 6) {
    return json({
      error: "bad_utr",
      message: "Enter the UPI reference / UTR number from your payment app.",
    }, 400);
  }

  const dupe = s.queue.some((v) => v.utr === utr && v.id !== vote.id) ||
               (s.usedUtrs || []).includes(utr);
  if (dupe) {
    return json({ error: "duplicate_utr", message: "That reference number has already been used." }, 409);
  }

  vote.utr = utr;
  vote.claimed_at = Date.now();

  if (verification(env) === "auto") {
    if (vote.amount > headroom(s, vote.side)) {
      vote.status = "refund_due";
    } else {
      s.usedUtrs = [utr, ...(s.usedUtrs || [])].slice(0, 500);
      applyApproval(s, vote);
    }
  } else {
    vote.status = "claimed";
  }

  await saveSeason(env, s);
  return json({ status: vote.status });
}
