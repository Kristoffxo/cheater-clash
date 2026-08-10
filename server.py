#!/usr/bin/env python3
"""
Cheat Clash - a paid, capped, monthly Men vs Women poll.

Run:      python3 server.py
Demo:     python3 server.py --demo     (no real money, votes count instantly, separate save file)
Admin:    http://localhost:8000/admin

Stdlib only. No installs.
"""

import json
import os
import queue
import re
import secrets
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
DATA_DIR = os.path.join(ROOT, "data")

DEMO = "--demo" in sys.argv
STATE_PATH = os.path.join(DATA_DIR, "demo-state.json" if DEMO else "state.json")

PORT = 8000
for i, a in enumerate(sys.argv):
    if a == "--port" and i + 1 < len(sys.argv):
        PORT = int(sys.argv[i + 1])

DAY = 86400
SIDES = ("men", "women")

_lock = threading.RLock()
_state = None
_subscribers = []          # list of queue.Queue for SSE clients
_subs_lock = threading.Lock()


# --------------------------------------------------------------------------
# config
# --------------------------------------------------------------------------

def load_config():
    with open(os.path.join(ROOT, "clash.json"), "r", encoding="utf-8") as f:
        cfg = json.load(f)
    cfg.pop("_notes", None)
    cfg["total_cap_rupees"] = int(cfg.get("total_cap_rupees", 10000))
    cfg["side_cap_rupees"] = int(cfg.get("side_cap_rupees", 10000))
    cfg["season_days"] = int(cfg.get("season_days", 30))
    cfg["min_amount"] = max(1, int(cfg.get("min_amount", 1)))
    cfg["max_amount_per_vote"] = int(cfg.get("max_amount_per_vote", 500))
    if DEMO:
        cfg["verification"] = "demo"
    return cfg


CFG = load_config()


# --------------------------------------------------------------------------
# state
# --------------------------------------------------------------------------

def new_season(number, now=None):
    now = now or time.time()
    return {
        "number": number,
        "started_at": now,
        "ends_at": now + CFG["season_days"] * DAY,
        "status": "live",          # live | ended
        "ended_reason": None,      # cap | side_cap | time
        "winner": None,            # men | women | tie
        "votes": [],
    }


def blank_state():
    return {"season": new_season(1), "history": []}


def load_state():
    global _state
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, "r", encoding="utf-8") as f:
                _state = json.load(f)
            return
        except Exception as e:
            print("! could not read %s (%s) - starting fresh" % (STATE_PATH, e))
    _state = blank_state()
    save_state()


def save_state():
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(_state, f, indent=2)
    os.replace(tmp, STATE_PATH)


# --------------------------------------------------------------------------
# money math  (the cap lives here)
# --------------------------------------------------------------------------

def totals(season):
    t = {"men": 0, "women": 0}
    for v in season["votes"]:
        if v["status"] == "approved":
            t[v["side"]] += v["amount"]
    return t


def collected(season):
    t = totals(season)
    return t["men"] + t["women"]


def remaining_total(season):
    return max(0, CFG["total_cap_rupees"] - collected(season))


def remaining_side(season, side):
    return max(0, CFG["side_cap_rupees"] - totals(season)[side])


def headroom(season, side):
    """The most rupees this side may still legitimately take."""
    return min(remaining_total(season), remaining_side(season, side))


def leader(season):
    t = totals(season)
    if t["men"] > t["women"]:
        return "men"
    if t["women"] > t["men"]:
        return "women"
    return "tie"


def end_season(season, reason):
    if season["status"] == "ended":
        return
    season["status"] = "ended"
    season["ended_reason"] = reason
    season["winner"] = leader(season)
    season["ended_at"] = time.time()


def check_end_conditions(season):
    """Called after every approval and on every read. Enforces the caps."""
    if season["status"] != "live":
        return
    t = totals(season)
    if t["men"] >= CFG["side_cap_rupees"] or t["women"] >= CFG["side_cap_rupees"]:
        end_season(season, "side_cap")
    elif t["men"] + t["women"] >= CFG["total_cap_rupees"]:
        end_season(season, "cap")
    elif time.time() >= season["ends_at"]:
        end_season(season, "time")


def maybe_roll_season():
    """Archive a finished season and start the next one once its 30 days are up."""
    s = _state["season"]
    check_end_conditions(s)
    if time.time() >= s["ends_at"]:
        if s["status"] != "ended":
            end_season(s, "time")
        t = totals(s)
        _state["history"].insert(0, {
            "number": s["number"],
            "started_at": s["started_at"],
            "ended_at": s.get("ended_at", s["ends_at"]),
            "ended_reason": s["ended_reason"],
            "winner": s["winner"],
            "men": t["men"],
            "women": t["women"],
            "votes": len([v for v in s["votes"] if v["status"] == "approved"]),
        })
        _state["history"] = _state["history"][:24]
        _state["season"] = new_season(s["number"] + 1)
        save_state()
        return True
    return False


# --------------------------------------------------------------------------
# public view of the state
# --------------------------------------------------------------------------

def clean_name(name):
    name = re.sub(r"[^\w \-'.]", "", (name or "").strip())[:18]
    return name or "Anonymous"


def public_state():
    with _lock:
        maybe_roll_season()
        s = _state["season"]
        check_end_conditions(s)
        t = totals(s)
        approved = [v for v in s["votes"] if v["status"] == "approved"]
        approved.sort(key=lambda v: v.get("approved_at") or v["created_at"], reverse=True)

        board = {}
        for v in approved:
            k = (v["name"], v["side"])
            board[k] = board.get(k, 0) + v["amount"]
        top = sorted(
            [{"name": k[0], "side": k[1], "amount": a} for k, a in board.items()],
            key=lambda r: -r["amount"],
        )[:10]

        return {
            "season": s["number"],
            "status": s["status"],
            "ended_reason": s["ended_reason"],
            "winner": s["winner"],
            "started_at": s["started_at"],
            "ends_at": s["ends_at"],
            "server_time": time.time(),
            "men": t["men"],
            "women": t["women"],
            "collected": t["men"] + t["women"],
            "cap": CFG["total_cap_rupees"],
            "side_cap": CFG["side_cap_rupees"],
            "remaining": remaining_total(s),
            "headroom": {"men": headroom(s, "men"), "women": headroom(s, "women")},
            "vote_count": len(approved),
            "recent": [
                {"name": v["name"], "side": v["side"], "amount": v["amount"],
                 "at": v.get("approved_at") or v["created_at"]}
                for v in approved[:25]
            ],
            "top": top,
            "history": _state["history"][:12],
            "quick_amounts": CFG["quick_amounts"],
            "min_amount": CFG["min_amount"],
            "max_amount": CFG["max_amount_per_vote"],
            "upi_id": CFG["upi_id"],
            "payee_name": CFG["payee_name"],
            "verification": CFG["verification"],
            "demo": DEMO,
        }


# --------------------------------------------------------------------------
# live updates (SSE)
# --------------------------------------------------------------------------

def broadcast():
    payload = json.dumps(public_state())
    with _subs_lock:
        dead = []
        for q in _subscribers:
            try:
                q.put_nowait(payload)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _subscribers.remove(q)


# --------------------------------------------------------------------------
# actions
# --------------------------------------------------------------------------

def upi_uri(amount, ref, side):
    params = {
        "pa": CFG["upi_id"],
        "pn": CFG["payee_name"],
        "am": "%.2f" % amount,
        "cu": "INR",
        "tn": "Cheat Clash - Team %s" % side.capitalize(),
        "tr": ref,
    }
    return "upi://pay?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)


def create_intent(side, amount, name):
    with _lock:
        maybe_roll_season()
        s = _state["season"]
        check_end_conditions(s)

        if s["status"] != "live":
            return 409, {"error": "season_over",
                         "message": "This season is finished. Come back for Season %d." % (s["number"] + 1)}
        if side not in SIDES:
            return 400, {"error": "bad_side"}

        try:
            amount = int(amount)
        except (TypeError, ValueError):
            return 400, {"error": "bad_amount"}

        room = headroom(s, side)
        if room <= 0:
            return 409, {"error": "cap_reached",
                         "message": "The ₹10,000 cap is full. No more money is being accepted."}

        limit = min(CFG["max_amount_per_vote"], room)
        if amount < CFG["min_amount"] or amount > limit:
            return 400, {"error": "amount_out_of_range",
                         "message": "Pick between ₹%d and ₹%d." % (CFG["min_amount"], limit),
                         "limit": limit}

        ref = "CC" + secrets.token_hex(6).upper()
        vote = {
            "id": ref,
            "side": side,
            "amount": amount,
            "name": clean_name(name),
            "status": "approved" if DEMO else "pending",
            "utr": None,
            "created_at": time.time(),
            "approved_at": time.time() if DEMO else None,
        }
        s["votes"].append(vote)
        if DEMO:
            check_end_conditions(s)
        save_state()

    if DEMO:
        broadcast()
    return 200, {
        "id": ref,
        "amount": amount,
        "side": side,
        "upi_uri": upi_uri(amount, ref, side),
        "upi_id": CFG["upi_id"],
        "demo": DEMO,
    }


def claim_payment(vote_id, utr):
    """Punter says 'I paid, here's the UTR'."""
    with _lock:
        s = _state["season"]
        vote = next((v for v in s["votes"] if v["id"] == vote_id), None)
        if not vote:
            return 404, {"error": "not_found"}
        if vote["status"] in ("approved", "refund_due"):
            return 200, {"status": vote["status"]}

        utr = re.sub(r"[^A-Za-z0-9]", "", utr or "")
        if len(utr) < 6:
            return 400, {"error": "bad_utr", "message": "Enter the UPI reference / UTR number from your payment app."}

        if any(v["utr"] == utr and v["id"] != vote_id for v in s["votes"]):
            return 409, {"error": "duplicate_utr", "message": "That reference number has already been used."}

        vote["utr"] = utr
        vote["claimed_at"] = time.time()

        if CFG["verification"] == "auto":
            room = headroom(s, vote["side"])
            if vote["amount"] > room:
                vote["status"] = "refund_due"
            else:
                vote["status"] = "approved"
                vote["approved_at"] = time.time()
                check_end_conditions(s)
        else:
            vote["status"] = "claimed"
        save_state()
        result = vote["status"]

    broadcast()
    return 200, {"status": result}


def admin_decide(vote_id, decision):
    with _lock:
        s = _state["season"]
        vote = next((v for v in s["votes"] if v["id"] == vote_id), None)
        if not vote:
            return 404, {"error": "not_found"}

        if decision == "approve":
            if vote["status"] != "approved":
                room = headroom(s, vote["side"])
                if vote["amount"] > room:
                    # Would breach the cap. Never count it - flag it for a refund instead.
                    vote["status"] = "refund_due"
                    save_state()
                    broadcast()
                    return 409, {"error": "would_exceed_cap",
                                 "message": "Only ₹%d of room left. Marked for refund." % room}
                vote["status"] = "approved"
                vote["approved_at"] = time.time()
                check_end_conditions(s)
        elif decision == "reject":
            vote["status"] = "rejected"
        elif decision == "refunded":
            vote["status"] = "refunded"
        else:
            return 400, {"error": "bad_decision"}
        save_state()

    broadcast()
    return 200, {"ok": True}


def admin_queue():
    with _lock:
        s = _state["season"]
        rows = [v for v in s["votes"] if v["status"] in ("claimed", "pending", "refund_due")]
        rows.sort(key=lambda v: -(v.get("claimed_at") or v["created_at"]))
        t = totals(s)
        return {
            "season": s["number"],
            "status": s["status"],
            "men": t["men"],
            "women": t["women"],
            "collected": t["men"] + t["women"],
            "cap": CFG["total_cap_rupees"],
            "verification": CFG["verification"],
            "rows": [
                {
                    "id": v["id"], "side": v["side"], "amount": v["amount"], "name": v["name"],
                    "utr": v["utr"], "status": v["status"],
                    "at": v.get("claimed_at") or v["created_at"],
                }
                for v in rows[:200]
            ],
        }


def admin_reset():
    """Force-end the current season and open the next one."""
    with _lock:
        s = _state["season"]
        if s["status"] != "ended":
            end_season(s, "manual")
        t = totals(s)
        _state["history"].insert(0, {
            "number": s["number"], "started_at": s["started_at"],
            "ended_at": s.get("ended_at", time.time()), "ended_reason": s["ended_reason"],
            "winner": s["winner"], "men": t["men"], "women": t["women"],
            "votes": len([v for v in s["votes"] if v["status"] == "approved"]),
        })
        _state["season"] = new_season(s["number"] + 1)
        save_state()
    broadcast()
    return {"ok": True}


# --------------------------------------------------------------------------
# http
# --------------------------------------------------------------------------

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CheatClash"

    def log_message(self, fmt, *args):
        if "--verbose" in sys.argv:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -- helpers -----------------------------------------------------------

    def send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > 8192:
                return {}
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    def is_admin(self):
        token = self.headers.get("X-Admin-Token") or ""
        return secrets.compare_digest(token, str(CFG["admin_token"]))

    def serve_file(self, relpath):
        path = os.path.normpath(os.path.join(PUBLIC, relpath.lstrip("/")))
        if not path.startswith(PUBLIC) or not os.path.isfile(path):
            self.send_json(404, {"error": "not_found"})
            return
        with open(path, "rb") as f:
            body = f.read()
        ext = os.path.splitext(path)[1]
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    # -- routes ------------------------------------------------------------

    def do_GET(self):
        route = urllib.parse.urlparse(self.path).path

        if route == "/api/state":
            return self.send_json(200, public_state())

        if route == "/api/stream":
            return self.stream()

        if route == "/api/admin/queue":
            if not self.is_admin():
                return self.send_json(401, {"error": "unauthorized"})
            return self.send_json(200, admin_queue())

        if route in ("/", "/index.html"):
            return self.serve_file("index.html")
        if route in ("/vote", "/vote/"):
            return self.serve_file("vote.html")
        if route in ("/admin", "/admin/"):
            return self.serve_file("admin.html")

        return self.serve_file(route)

    def do_POST(self):
        route = urllib.parse.urlparse(self.path).path
        body = self.read_json()

        if route == "/api/intent":
            code, out = create_intent(body.get("side"), body.get("amount"), body.get("name"))
            return self.send_json(code, out)

        if route == "/api/claim":
            code, out = claim_payment(body.get("id"), body.get("utr"))
            return self.send_json(code, out)

        if route.startswith("/api/admin/"):
            if not self.is_admin():
                return self.send_json(401, {"error": "unauthorized"})
            if route == "/api/admin/decide":
                code, out = admin_decide(body.get("id"), body.get("decision"))
                return self.send_json(code, out)
            if route == "/api/admin/reset":
                return self.send_json(200, admin_reset())

        return self.send_json(404, {"error": "not_found"})

    def stream(self):
        q = queue.Queue(maxsize=32)
        with _subs_lock:
            _subscribers.append(q)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.wfile.write(b"retry: 3000\n\n")
            self.wfile.write(("data: %s\n\n" % json.dumps(public_state())).encode("utf-8"))
            self.wfile.flush()
            while True:
                try:
                    payload = q.get(timeout=20)
                    self.wfile.write(("data: %s\n\n" % payload).encode("utf-8"))
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")     # keeps proxies from hanging up
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with _subs_lock:
                if q in _subscribers:
                    _subscribers.remove(q)


class Server(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        """A browser hanging up mid-request is normal, not an error.

        Chrome opens speculative connections and abandons them, and cancels
        in-flight polls on navigation. The default handler prints a full stack
        trace for each one, which looks alarming and means nothing.
        """
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, BrokenPipeError,
                            ConnectionAbortedError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def ticker():
    """Nudge clients when the season rolls over or the clock runs out."""
    while True:
        time.sleep(30)
        try:
            with _lock:
                before = (_state["season"]["number"], _state["season"]["status"])
                maybe_roll_season()
                check_end_conditions(_state["season"])
                after = (_state["season"]["number"], _state["season"]["status"])
                if before != after:
                    save_state()
            if before != after:
                broadcast()
        except Exception as e:
            print("ticker: %s" % e)


def main():
    load_state()
    threading.Thread(target=ticker, daemon=True).start()

    print("")
    print("  ♥  CHEAT CLASH")
    print("  " + "-" * 46)
    print("  site    http://localhost:%d" % PORT)
    print("  admin   http://localhost:%d/admin" % PORT)
    print("  upi     %s" % CFG["upi_id"])
    print("  cap     ₹%s total   |   ₹%s per side"
          % (CFG["total_cap_rupees"], CFG["side_cap_rupees"]))
    print("  season  %d days" % CFG["season_days"])
    if DEMO:
        print("  mode    DEMO - votes count instantly, no money involved")
    elif CFG["verification"] == "auto":
        print("  mode    AUTO - a UTR is taken on trust. People can lie.")
    else:
        print("  mode    MANUAL - votes count only after you approve them in /admin")
    if str(CFG["admin_token"]).startswith("change-me"):
        print("  ⚠  change admin_token in clash.json before this goes public")
    print("")

    srv = Server(("0.0.0.0", PORT), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  bye\n")


if __name__ == "__main__":
    main()
