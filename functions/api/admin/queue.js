import { loadSeason, collected, adminToken, verification, json, CAP } from "../../_lib.js";

export function authed(request, env) {
  const given = request.headers.get("X-Admin-Token") || "";
  const want = adminToken(env);
  if (!want || given.length !== want.length) return false;
  // constant-time-ish compare
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  const s = await loadSeason(env);
  const rows = s.queue
    .slice()
    .sort((a, b) => (b.claimed_at || b.created_at) - (a.claimed_at || a.created_at))
    .map((v) => ({
      id: v.id, side: v.side, amount: v.amount, name: v.name,
      utr: v.utr, status: v.status, at: (v.claimed_at || v.created_at) / 1000,
    }));

  return json({
    season: s.number,
    status: s.status,
    men: s.men,
    women: s.women,
    collected: collected(s),
    cap: CAP,
    verification: verification(env),
    rows,
  });
}
