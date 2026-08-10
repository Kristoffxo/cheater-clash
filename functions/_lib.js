/* Shared season logic for the Cloudflare Pages Functions backend.
   Mirrors server.py — the caps are enforced here exactly the same way.

   Storage (KV binding: CLASH)
     season        the whole live season: totals, queue, recent, board, history
     vote:<id>     an audit copy of every approved payment, never read in normal use

   Money only ever moves in approve(), and approvals come from one admin at human
   pace, so the read-modify-write on `season` is not a practical race. Creating an
   intent writes nothing to `season`, so the busy path has no contention at all. */

import config from "../config.json";

export const CAP = Number(config.total_cap_rupees) || 10000;
export const SIDE_CAP = Number(config.side_cap_rupees) || 10000;
export const SEASON_DAYS = Number(config.season_days) || 30;
export const MIN_AMOUNT = Math.max(1, Number(config.min_amount) || 1);
export const MAX_AMOUNT = Number(config.max_amount_per_vote) || 500;
export const QUICK = config.quick_amounts || [1, 5, 10, 25, 50, 100];
export const UPI_ID = config.upi_id;
export const PAYEE = config.payee_name || "Cheat Clash";

const DAY = 86400000;
const SIDES = ["men", "women"];
const QUEUE_MAX = 300;
const UNPAID_TTL = 2 * 3600 * 1000;   // drop intents nobody ever paid for

export function verification(env) {
  return (env.VERIFICATION || config.verification || "manual").toLowerCase();
}

export function adminToken(env) {
  return env.ADMIN_TOKEN || config.admin_token || "";
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function newSeason(number, now = Date.now()) {
  return {
    number,
    started_at: now,
    ends_at: now + SEASON_DAYS * DAY,
    status: "live",
    ended_reason: null,
    winner: null,
    men: 0,
    women: 0,
    queue: [],      // pending / claimed / refund_due
    recent: [],     // last 25 approved
    board: {},      // "name|side" -> rupees
    history: [],
  };
}

export async function loadSeason(env) {
  const raw = await env.CLASH.get("season", "json");
  let s = raw || newSeason(1);
  if (rollIfExpired(s)) await saveSeason(env, s);
  return s;
}

export async function saveSeason(env, s) {
  await env.CLASH.put("season", JSON.stringify(s));
}

/* ─── the cap lives here ─────────────────────────────────────────── */

export function collected(s) {
  return s.men + s.women;
}

export function remainingTotal(s) {
  return Math.max(0, CAP - collected(s));
}

export function remainingSide(s, side) {
  return Math.max(0, SIDE_CAP - s[side]);
}

/** The most rupees this side may still legitimately take. */
export function headroom(s, side) {
  return Math.min(remainingTotal(s), remainingSide(s, side));
}

export function leader(s) {
  if (s.men > s.women) return "men";
  if (s.women > s.men) return "women";
  return "tie";
}

function endSeason(s, reason) {
  if (s.status === "ended") return;
  s.status = "ended";
  s.ended_reason = reason;
  s.winner = leader(s);
  s.ended_at = Date.now();
}

/** Called after every approval and on every read. Enforces the caps. */
export function checkEnd(s) {
  if (s.status !== "live") return;
  if (s.men >= SIDE_CAP || s.women >= SIDE_CAP) endSeason(s, "side_cap");
  else if (collected(s) >= CAP) endSeason(s, "cap");
  else if (Date.now() >= s.ends_at) endSeason(s, "time");
}

/** Archive a finished season and open the next one once its 30 days are up. */
function rollIfExpired(s) {
  checkEnd(s);
  if (Date.now() < s.ends_at) return pruneQueue(s);
  if (s.status !== "ended") endSeason(s, "time");

  const history = [
    {
      number: s.number,
      started_at: s.started_at,
      ended_at: s.ended_at || s.ends_at,
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
  Object.assign(s, next);
  return true;
}

/** Intents nobody ever paid for shouldn't pile up in the admin queue forever. */
function pruneQueue(s) {
  const before = s.queue.length;
  const cutoff = Date.now() - UNPAID_TTL;
  s.queue = s.queue
    .filter((v) => v.status !== "pending" || v.created_at > cutoff)
    .slice(-QUEUE_MAX);
  return s.queue.length !== before;
}

/* ─── helpers ────────────────────────────────────────────────────── */

export function cleanName(name) {
  const n = String(name || "").replace(/[^\w \-'.]/g, "").trim().slice(0, 18);
  return n || "Anonymous";
}

export function upiUri(amount, ref, side) {
  const p = new URLSearchParams({
    pa: UPI_ID,
    pn: PAYEE,
    am: Number(amount).toFixed(2),
    cu: "INR",
    tn: `Cheat Clash - Team ${side[0].toUpperCase()}${side.slice(1)}`,
    tr: ref,
  });
  return "upi://pay?" + p.toString();
}

export function makeRef() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return "CC" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Fold an approved payment into the totals, the ticker and the leaderboard. */
export function applyApproval(s, v) {
  s[v.side] += v.amount;
  v.status = "approved";
  v.approved_at = Date.now();

  s.recent = [{ name: v.name, side: v.side, amount: v.amount, at: v.approved_at }, ...s.recent].slice(0, 25);

  const key = `${v.name}|${v.side}`;
  s.board[key] = (s.board[key] || 0) + v.amount;

  s.queue = s.queue.filter((q) => q.id !== v.id);
  checkEnd(s);
}

export function publicState(s, env) {
  const top = Object.entries(s.board)
    .map(([k, amount]) => {
      const i = k.lastIndexOf("|");
      return { name: k.slice(0, i), side: k.slice(i + 1), amount };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  return {
    season: s.number,
    status: s.status,
    ended_reason: s.ended_reason,
    winner: s.winner,
    started_at: s.started_at / 1000,
    ends_at: s.ends_at / 1000,
    server_time: Date.now() / 1000,
    men: s.men,
    women: s.women,
    collected: collected(s),
    cap: CAP,
    side_cap: SIDE_CAP,
    remaining: remainingTotal(s),
    headroom: { men: headroom(s, "men"), women: headroom(s, "women") },
    vote_count: Object.keys(s.board).length ? s.recent.length : 0,
    recent: s.recent,
    top,
    history: (s.history || []).slice(0, 12),
    quick_amounts: QUICK,
    min_amount: MIN_AMOUNT,
    max_amount: MAX_AMOUNT,
    upi_id: UPI_ID,
    payee_name: PAYEE,
    verification: verification(env),
    demo: false,
  };
}

export { SIDES };
