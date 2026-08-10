import { loadSeason, saveSeason, newSeason, leader, json } from "../../_lib.js";
import { authed } from "./queue.js";

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  const s = await loadSeason(env);
  if (s.status !== "ended") {
    s.status = "ended";
    s.ended_reason = "manual";
    s.winner = leader(s);
    s.ended_at = Date.now();
  }

  const history = [
    {
      number: s.number,
      started_at: s.started_at,
      ended_at: s.ended_at,
      ended_reason: s.ended_reason,
      winner: s.winner,
      men: s.men,
      women: s.women,
      votes: s.recent.length,
    },
    ...(s.history || []),
  ].slice(0, 24);

  const next = newSeason(s.number + 1);
  next.history = history;
  await saveSeason(env, next);

  return json({ ok: true });
}
