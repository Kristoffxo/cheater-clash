# 💔 Cheat Clash

A paid, capped, monthly *Men vs Women* poll. ₹1 = 1 point. First side to move the bar
wins the season. Hard stop at ₹10,000, then it resets every 30 days.

Python 3 standard library only — nothing to install.

---

## Run it

```bash
python3 server.py
```

- Site → http://localhost:8000
- Admin → http://localhost:8000/admin

Want to play with the UI without money changing hands:

```bash
python3 server.py --demo
```

Demo mode counts every vote instantly, writes to a separate `data/demo-state.json`, and
never touches your real season. Other flags: `--port 9000`, `--verbose`.

---

## The ₹10,000 cap

This is the part you asked me to be strict about, so it's enforced in three places:

1. **When someone asks to pay** — the amount is checked against the room left. If only
   ₹400 remains, a ₹500 vote is refused before anyone opens their UPI app.
2. **When a payment is approved** — re-checked. If the pot filled up in between, the
   payment is *never counted*; it's marked `refund_due` for you to send back.
3. **Continuously** — the moment approved payments total ₹10,000, the season ends, the
   winner is frozen, and the site stops asking anyone for money.

Verified: the pot lands on exactly ₹10,000 and has no path to ₹10,001.

A single side hitting ₹10,000 also ends it — though since the *total* is capped at
₹10,000 too, that can only happen if one side took the entire pot.

Change any of it in `config.json`:

| key | meaning |
|---|---|
| `total_cap_rupees` | hard stop for the whole season |
| `side_cap_rupees` | a single side hitting this also ends it |
| `season_days` | 30 |
| `max_amount_per_vote` | stops one person buying the whole board in one go |
| `verification` | `manual` or `auto` — see below |
| `admin_token` | **change this** |

---

## ⚠️ How payments actually work here

**A raw UPI link cannot be verified.** `upi://pay?pa=paiseaagye@ptyes` opens the payer's
app, but your website never finds out whether money arrived. So:

- The payer pays, then types the **UTR** (the reference number their app shows).
- That lands in `/admin` as `claimed`. **It counts for nothing yet.**
- You open your UPI app, confirm the money is really there, and hit **Approve**.
- Only then do the points appear on the bar.

Duplicate UTRs are rejected automatically, so the same reference can't be reused.

Setting `verification: "auto"` in `config.json` skips your approval and counts points the
instant a UTR is submitted. It's frictionless and **people can and will type fake
numbers.** Only use it if you genuinely don't mind.

### Making it automatic (the real fix)

A payment gateway signs a webhook to your server, so nothing depends on trust:

1. Sign up at **Cashfree** or **Razorpay**. KYC needs PAN + a bank account and usually
   clears in 1–3 working days. Sandbox works immediately.
2. Copy `.env.example` → `.env` and fill in your keys. **Never paste keys into a chat.**
3. The server grows two things: an order-create call in place of the `upi://` link, and a
   `/api/webhook/cashfree` route that verifies the signature and calls the existing
   approval path. Everything else — the cap, the season logic, the UI — stays as is.

Wise can't do this job: Wise has no INR receiving account, so it cannot accept UPI.

---

## Putting it on the internet

Fastest, free, no signup:

```bash
cloudflared tunnel --url http://localhost:8000
```

That prints an HTTPS link you can paste into a story. Your Mac has to stay awake and the
server running. For something permanent, any small VPS or a container host will do —
it's one Python file with no dependencies.

**Before you share the link:** change `admin_token` in `config.json`. It defaults to a
placeholder and it's the only thing standing between a stranger and your approve button.

---

## Admin

`/admin`, then your token.

- **Approve** — counts the points. Do this only after seeing the money in your UPI app.
- **Reject** — no points. For fake or mistaken claims.
- **Mark refunded** — bookkeeping for payments that arrived after the cap filled.
- **Force reset season** — ends the season now, files it in the Hall of Seasons, starts
  the next one with a clean board and a fresh 30-day clock.

---

## Files

```
server.py          API, cap enforcement, season rollover, live updates (SSE)
config.json        UPI id, caps, season length, admin token
public/index.html  the site
public/style.css   all the styling
public/app.js      live bar, pay flow, particles, sound
public/qr.js       QR encoder, written from scratch — no dependencies
public/admin.html  approval queue
data/state.json    the live season (gitignored)
```

---

## Honest limitations

- Points are only as trustworthy as your approvals. Manual mode is safe but you're the
  bottleneck; auto mode is fast but fakeable. A gateway fixes both.
- State is a JSON file. Fine for one server and this scale; it is not a database.
- No refund mechanism — the site says so in the footer. `refund_due` is a note to
  yourself, not an automated payout.
- Collecting money from the public on a personal UPI ID has tax implications, and Paytm
  may treat a stream of small payments from strangers as commercial use. Your ₹10,000
  cap keeps the numbers small, but it's worth knowing before you post the link.
