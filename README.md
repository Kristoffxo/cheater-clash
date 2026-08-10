# 💔 Cheat Clash

A paid, capped, monthly *Men vs Women* poll. ₹1 = 1 point. First side to move the bar
wins the season. Hard stop at ₹10,000, then it resets every 30 days.

Python 3 standard library only — nothing to install.

---

## Run it

The folder lives on your Desktop. **Double-click a launcher — no terminal needed:**

- **`Start Cheat Clash.command`** — the real thing. Points count only once you approve them.
- **`Try It (Demo, No Money).command`** — fake data, votes count instantly, your real
  season is untouched. Use this to show people.

Either one starts the server and opens your browser. Close the Terminal window to stop it.
If port 8000 is busy it quietly moves to 8001, 8002, and so on.

> The first time you double-click, macOS may say it's from an unidentified developer.
> Right-click the file → **Open** → **Open**. You only have to do that once per file.

From a terminal instead:

```bash
cd ~/Desktop/cheat-clash && python3 server.py
```

- Site → http://localhost:8000
- Admin → http://localhost:8000/admin

Add `--demo` for the no-money version.

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

Change any of it in `clash.json`:

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

Setting `verification: "auto"` in `clash.json` skips your approval and counts points the
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

## Deploying to Cloudflare Pages

The site runs on Cloudflare with no server of your own. `public/` is served as static
files and `functions/` becomes the API — same rules, same ₹10,000 cap, with the season
stored in Cloudflare KV instead of a JSON file.

**In the Cloudflare dashboard, on your Pages project:**

1. **Settings → Build & deployments**
   - Build command: *leave empty*
   - Build output directory: **`public`**
   - Root directory: `/`

2. **Settings → Functions → KV namespace bindings** → *Add binding*
   - Variable name: **`CLASH`** (exactly this)
   - KV namespace: create one called `cheat-clash` and pick it
   - Do this for **both** Production and Preview

3. **Settings → Environment variables** → add for Production
   - **`ADMIN_TOKEN`** = a long password you invent. **Encrypt it.**
     This overrides the placeholder in `clash.json`, so your real admin password is
     never in the public repo.
   - Optional: `VERIFICATION` = `manual` (default) or `auto`

4. **Deployments → Retry deployment**

Then `https://<your-project>.pages.dev` is the live game and `/admin` is your queue.

Both backends read the caps from the same `clash.json`, so changing
`total_cap_rupees` there changes it in both places.

**What's different on Cloudflare:** the page polls every 3 seconds instead of holding a
live stream open (Functions can't keep connections open). KV is also eventually
consistent — approvals are the only thing that moves money and they come from one person
at human pace, so it isn't a practical problem, but don't hammer the approve button.

---

## Putting it on the internet (from your own Mac instead)

Fastest, free, no signup:

```bash
cloudflared tunnel --url http://localhost:8000
```

That prints an HTTPS link you can paste into a story. Your Mac has to stay awake and the
server running. For something permanent, any small VPS or a container host will do —
it's one Python file with no dependencies.

**Before you share the link:** change `admin_token` in `clash.json`. It defaults to a
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
server.py           API, cap enforcement, season rollover, live updates (SSE)
clash.json          UPI id, caps, season length, admin token

public/index.html   LANDING — the MEN / WOMEN split
public/landing.css  the split, the seam, the lean-on-hover
public/landing.js   live numbers, particles, page-leave sweep

public/vote.html    VOTE — scoreboard, war bar, pay sheet, leaderboards
public/style.css    styling for the vote page
public/app.js       live bar, pay flow, particles, sound
public/qr.js        QR encoder, written from scratch — no dependencies

public/admin.html   approval queue
data/state.json     the live season (gitignored)
```

### The two pages

`/` is the landing: a full-screen diagonal split with **MEN / WOMEN** either side of a
glowing slash. Hovering a side makes its half swell and drains the colour out of the
other. Clicking sweeps that side's colour over the whole screen and lands on
`/vote?side=men`, which opens the pay sheet with that side already chosen.

`/vote` is the arena — live tug-of-war bar, ticker, leaderboard, Hall of Seasons. The
brand mark in the corner goes back to the split.

The seam between the halves is cut from the same polygon as the halves themselves rather
than being a rotated bar, so it stays welded to the colour boundary at every screen
size. If you change one clip-path, change the seam's to match.

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
