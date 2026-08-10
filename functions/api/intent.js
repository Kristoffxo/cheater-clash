import {
  loadSeason, saveSeason, checkEnd, headroom, cleanName, upiUri, makeRef,
  json, SIDES, MIN_AMOUNT, MAX_AMOUNT, UPI_ID,
} from "../_lib.js";

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch { /* treated as empty */ }

  const s = await loadSeason(env);
  checkEnd(s);

  if (s.status !== "live") {
    return json({
      error: "season_over",
      message: `This season is finished. Come back for Season ${s.number + 1}.`,
    }, 409);
  }

  const side = body.side;
  if (!SIDES.includes(side)) return json({ error: "bad_side" }, 400);

  const amount = Number.parseInt(body.amount, 10);
  if (!Number.isFinite(amount)) return json({ error: "bad_amount" }, 400);

  const room = headroom(s, side);
  if (room <= 0) {
    return json({
      error: "cap_reached",
      message: "The ₹10,000 cap is full. No more money is being accepted.",
    }, 409);
  }

  // never let someone start a payment bigger than the room that's left
  const limit = Math.min(MAX_AMOUNT, room);
  if (amount < MIN_AMOUNT || amount > limit) {
    return json({
      error: "amount_out_of_range",
      message: `Pick between ₹${MIN_AMOUNT} and ₹${limit}.`,
      limit,
    }, 400);
  }

  const ref = makeRef();
  s.queue.push({
    id: ref,
    side,
    amount,
    name: cleanName(body.name),
    status: "pending",
    utr: null,
    created_at: Date.now(),
    approved_at: null,
  });
  await saveSeason(env, s);

  return json({
    id: ref,
    amount,
    side,
    upi_uri: upiUri(amount, ref, side),
    upi_id: UPI_ID,
    demo: false,
  });
}
