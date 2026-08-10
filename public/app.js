/* Cheat Clash — front end */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var state = null;
  var pending = null;          // { id, amount, side, upi_uri }
  var chosenSide = "men";
  var chosenAmount = 10;
  var lastTotals = { men: 0, women: 0 };
  var seenWinner = false;

  var rupee = function (n) { return "₹" + Number(n || 0).toLocaleString("en-IN"); };

  // ─────────────────────────── sound ───────────────────────────
  var soundOn = localStorage.getItem("cc_sound") !== "0";
  var actx = null;
  function beep(freq, dur, type, gain) {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, actx.currentTime);
      g.gain.setValueAtTime(gain == null ? 0.06 : gain, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { /* no audio, no problem */ }
  }
  function chime(side) {
    var base = side === "men" ? 320 : 440;
    beep(base, 0.16, "triangle", 0.07);
    setTimeout(function () { beep(base * 1.5, 0.22, "triangle", 0.05); }, 80);
  }
  $("soundBtn").onclick = function () {
    soundOn = !soundOn;
    localStorage.setItem("cc_sound", soundOn ? "1" : "0");
    this.textContent = soundOn ? "🔊" : "🔇";
    this.classList.toggle("off", !soundOn);
    if (soundOn) beep(660, 0.1, "sine");
  };
  $("soundBtn").textContent = soundOn ? "🔊" : "🔇";
  $("soundBtn").classList.toggle("off", !soundOn);

  // ─────────────────────────── particles ───────────────────────────
  var cv = $("fx"), ctx = cv.getContext("2d"), bits = [], raf = null;
  function sizeCanvas() {
    var d = window.devicePixelRatio || 1;
    cv.width = innerWidth * d; cv.height = innerHeight * d;
    cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px";
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  sizeCanvas();
  addEventListener("resize", sizeCanvas);

  function burst(side, count) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var glyphs = side === "men" ? ["🕺", "💙", "😈", "💔"] : ["💃", "💖", "😇", "💋"];
    var x = side === "men" ? innerWidth * 0.25 : innerWidth * 0.75;
    for (var i = 0; i < (count || 18); i++) {
      bits.push({
        x: x + (Math.random() - 0.5) * 220,
        y: innerHeight * 0.55 + Math.random() * 60,
        vx: (Math.random() - 0.5) * 5,
        vy: -6 - Math.random() * 7,
        g: glyphs[(Math.random() * glyphs.length) | 0],
        s: 16 + Math.random() * 18,
        r: (Math.random() - 0.5) * 0.35,
        a: 1, rot: Math.random() * 6.28
      });
    }
    run();
  }

  function confettiRain(seconds) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var colors = ["#38bdf8", "#4f46e5", "#fb7185", "#e11d8f", "#fbbf24", "#34d399", "#ffffff"];
    var end = Date.now() + (seconds || 6) * 1000;
    (function shower() {
      for (var i = 0; i < 6; i++) {
        bits.push({
          x: Math.random() * innerWidth, y: -20,
          vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
          c: colors[(Math.random() * colors.length) | 0],
          w: 5 + Math.random() * 7, h: 8 + Math.random() * 10,
          r: (Math.random() - 0.5) * 0.3, a: 1, rot: Math.random() * 6.28, fall: true
        });
      }
      run();
      if (Date.now() < end) setTimeout(shower, 90);
    })();
  }

  function run() {
    if (raf) return;
    (function tick() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (var i = bits.length - 1; i >= 0; i--) {
        var b = bits[i];
        b.x += b.vx; b.y += b.vy; b.rot += b.r;
        b.vy += b.fall ? 0.05 : 0.32;
        if (!b.fall) b.a -= 0.012; else if (b.y > innerHeight + 40) b.a = 0;
        if (b.a <= 0) { bits.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = Math.max(0, b.a);
        ctx.translate(b.x, b.y); ctx.rotate(b.rot);
        if (b.g) { ctx.font = b.s + "px serif"; ctx.textAlign = "center"; ctx.fillText(b.g, 0, 0); }
        else { ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); }
        ctx.restore();
      }
      if (bits.length) raf = requestAnimationFrame(tick);
      else { raf = null; ctx.clearRect(0, 0, innerWidth, innerHeight); }
    })();
  }

  // ─────────────────────────── render ───────────────────────────
  function render(s) {
    var prev = state;
    state = s;

    $("seasonChip").textContent = "SEASON " + s.season;
    $("footUpi").textContent = s.upi_id;

    var total = s.men + s.women;
    var menPct = total ? (s.men / total) * 100 : 50;
    var womenPct = 100 - menPct;

    $("menScore").textContent = rupee(s.men);
    $("womenScore").textContent = rupee(s.women);
    $("menPct").textContent = Math.round(menPct) + "%";
    $("womenPct").textContent = Math.round(womenPct) + "%";
    $("menFill").style.width = menPct + "%";
    $("womenFill").style.width = womenPct + "%";
    $("knot").style.left = menPct + "%";
    $("menMini").style.width = menPct + "%";
    $("womenMini").style.width = womenPct + "%";

    var lead = s.men === s.women ? null : (s.men > s.women ? "men" : "women");
    $("menTag").textContent = !total ? "Back the boys"
      : lead === "men" ? "Leading by " + rupee(s.men - s.women) : "Down by " + rupee(s.women - s.men);
    $("womenTag").textContent = !total ? "Back the girls"
      : lead === "women" ? "Leading by " + rupee(s.women - s.men) : "Down by " + rupee(s.men - s.women);

    var capPct = Math.min(100, (s.collected / s.cap) * 100);
    $("capFill").style.width = capPct + "%";
    $("capText").textContent = rupee(s.collected) + " of " + rupee(s.cap) + " in the pot";
    $("capNote").textContent = s.status !== "live"
      ? "season closed"
      : s.remaining <= 0 ? "cap reached — closing"
      : rupee(s.remaining) + " left before it all ends";

    // score pop + effects on change
    if (prev) {
      ["men", "women"].forEach(function (side) {
        if (s[side] > lastTotals[side]) {
          var el = $(side + "Score");
          el.classList.add("pop");
          setTimeout(function () { el.classList.remove("pop"); }, 320);
          $("warbar").classList.add("shake");
          setTimeout(function () { $("warbar").classList.remove("shake"); }, 460);
          burst(side, Math.min(40, 10 + Math.round((s[side] - lastTotals[side]) / 3)));
          chime(side);
        }
      });
    }
    lastTotals = { men: s.men, women: s.women };

    renderTicker(s.recent);
    renderTop(s.top);
    renderHistory(s.history);

    var over = s.status !== "live";
    document.querySelectorAll(".pick").forEach(function (b) {
      var side = b.dataset.side;
      b.disabled = over || s.headroom[side] <= 0;
      var cta = b.querySelector(".pick-cta");
      cta.firstChild.nodeValue = over ? "SEASON CLOSED " : (s.headroom[side] <= 0 ? "CAP REACHED " : "BACK THIS SIDE ");
    });

    if (over && !seenWinner) showWinner(s);
    if (!over) $("winnerScrim").hidden = true;
  }

  function renderTicker(recent) {
    var wrap = $("tickerWrap"), t = $("ticker");
    if (!recent.length) { wrap.style.display = "none"; return; }
    wrap.style.display = "";
    var html = recent.map(function (v) {
      return '<span class="tick ' + v.side + '"><b>' + esc(v.name) + '</b> backed ' +
        (v.side === "men" ? "🕺 Men" : "💃 Women") + ' <span class="amt">' + rupee(v.amount) + '</span></span>';
    }).join("");
    t.innerHTML = html + html;     // doubled so the marquee loops seamlessly
  }

  function renderTop(top) {
    var el = $("topBoard");
    if (!top.length) { el.innerHTML = '<li class="empty">Nobody yet. Be the first.</li>'; return; }
    el.innerHTML = top.map(function (r, i) {
      return '<li><span class="rank">' + (i + 1) + '</span>' +
        '<span class="side-dot ' + r.side + '"></span>' +
        '<span class="who">' + esc(r.name) + '</span>' +
        '<span class="amt-cell">' + rupee(r.amount) + '</span></li>';
    }).join("");
  }

  function renderHistory(hist) {
    var el = $("historyBoard");
    if (!hist.length) { el.innerHTML = '<li class="empty">Season 1 is the first ever.</li>'; return; }
    el.innerHTML = hist.map(function (h) {
      var label = h.winner === "tie" ? "DEAD HEAT" : (h.winner || "—").toUpperCase();
      return '<li><span class="season-no">S' + h.number + '</span>' +
        '<span class="who won ' + h.winner + '">' + label + '</span>' +
        '<span class="amt-cell">' + rupee(h.men) + ' · ' + rupee(h.women) + '</span></li>';
    }).join("");
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ─────────────────────────── countdown ───────────────────────────
  var drift = 0;
  setInterval(function () {
    if (!state) return;
    var left = Math.max(0, state.ends_at * 1000 - (Date.now() - drift));
    var s = Math.floor(left / 1000);
    $("cdD").textContent = Math.floor(s / 86400);
    $("cdH").textContent = String(Math.floor(s % 86400 / 3600)).padStart(2, "0");
    $("cdM").textContent = String(Math.floor(s % 3600 / 60)).padStart(2, "0");
    $("cdS").textContent = String(s % 60).padStart(2, "0");
  }, 250);

  // ─────────────────────────── winner ───────────────────────────
  function showWinner(s) {
    seenWinner = true;
    var w = s.winner;
    $("winnerKicker").textContent = "SEASON " + s.season + " · FINAL";
    $("winnerTitle").textContent = w === "tie" ? "DEAD HEAT" : (w || "").toUpperCase();
    $("winnerSub").textContent = w === "tie"
      ? "Perfectly, infuriatingly tied. Nobody gets to be smug."
      : (w === "men" ? "Men" : "Women") + " cheat more. The internet has spoken, and it paid to say so.";
    $("winnerScore").innerHTML =
      '<span style="color:var(--men-1)">' + rupee(s.men) + '</span>' +
      '<span style="opacity:.4">vs</span>' +
      '<span style="color:var(--women-1)">' + rupee(s.women) + '</span>';
    $("winnerNext").textContent = s.ended_reason === "cap" || s.ended_reason === "side_cap"
      ? "The ₹" + s.cap.toLocaleString("en-IN") + " cap was hit. Season " + (s.season + 1) + " opens on reset."
      : "Time ran out. Season " + (s.season + 1) + " opens on reset.";
    $("winnerScrim").hidden = false;
    confettiRain(7);
    beep(523, 0.2, "triangle", 0.07);
    setTimeout(function () { beep(659, 0.2, "triangle", 0.07); }, 160);
    setTimeout(function () { beep(784, 0.45, "triangle", 0.07); }, 320);
  }
  $("winnerClose").onclick = function () { $("winnerScrim").hidden = true; };

  // ─────────────────────────── sheet ───────────────────────────
  var scrim = $("scrim");
  function openSheet(side) {
    chosenSide = side;
    pending = null;
    showPane("paneAmount");
    var chip = $("sheetSide");
    chip.textContent = side === "men" ? "TEAM MEN" : "TEAM WOMEN";
    chip.className = "sheet-side " + side;
    $("sheetTitle").textContent = side === "men" ? "Back the boys" : "Back the girls";

    var room = state.headroom[side];
    var max = Math.min(state.max_amount, room);
    $("roomNote").textContent = room < 500
      ? "Only " + rupee(room) + " of room left on this side."
      : "Max " + rupee(max) + " per go.";

    $("chips").innerHTML = state.quick_amounts.map(function (a) {
      return '<button class="chip" data-amt="' + a + '"' + (a > max ? " disabled" : "") + '>₹' + a + "</button>";
    }).join("");
    $("chips").querySelectorAll(".chip").forEach(function (c) {
      c.onclick = function () { setAmount(+c.dataset.amt); beep(880, 0.05, "square", 0.03); };
    });

    setAmount(Math.min(chosenAmount, max) || state.min_amount);
    $("nameInput").value = localStorage.getItem("cc_name") || "";
    scrim.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeSheet() {
    scrim.hidden = true;
    document.body.style.overflow = "";
  }

  function setAmount(a) {
    chosenAmount = a;
    $("amtInput").value = a;
    $("chips").querySelectorAll(".chip").forEach(function (c) {
      c.classList.toggle("on", +c.dataset.amt === a);
    });
  }

  function showPane(id) {
    ["paneAmount", "panePay", "paneDone"].forEach(function (p) { $(p).hidden = p !== id; });
    $("sheet").scrollTop = 0;
  }

  $("amtInput").oninput = function () {
    var v = parseInt(this.value, 10);
    if (!isNaN(v)) {
      chosenAmount = v;
      $("chips").querySelectorAll(".chip").forEach(function (c) {
        c.classList.toggle("on", +c.dataset.amt === v);
      });
    }
  };

  document.querySelectorAll(".pick").forEach(function (b) {
    b.onclick = function () { if (!b.disabled) { beep(520, 0.08, "sine", 0.05); openSheet(b.dataset.side); } };
  });
  $("sheetClose").onclick = closeSheet;
  scrim.onclick = function (e) { if (e.target === scrim) closeSheet(); };
  addEventListener("keydown", function (e) { if (e.key === "Escape" && !scrim.hidden) closeSheet(); });

  // ── step 1 → 2 ──
  $("goPay").onclick = function () {
    var btn = this;
    var name = $("nameInput").value.trim();
    localStorage.setItem("cc_name", name);
    btn.disabled = true; btn.textContent = "…";

    post("/api/intent", { side: chosenSide, amount: chosenAmount, name: name })
      .then(function (r) {
        btn.disabled = false; btn.textContent = "CONTINUE →";
        if (!r.ok) { flash($("goPay"), r.body.message || "Try a different amount."); return; }
        pending = r.body;

        renderPay(pending);
        $("verifyNote").textContent = state.demo
          ? "DEMO MODE — no money moves and your points are already on the board."
          : state.verification === "auto"
            ? "Your points appear as soon as you submit the reference."
            : "Your points appear once the payment is checked. Usually within a few hours.";
        $("verifyNote").className = "fineprint" + (state.demo ? " warn" : "");
        showPane(state.demo ? "paneDone" : "panePay");
        if (state.demo) {
          $("doneTitle").textContent = "Demo points added";
          $("doneMsg").textContent = rupee(pending.amount) + " on team " + pending.side + ". No real money involved.";
        }
      });
  };

  // ── the pay step ──────────────────────────────────────────────
  // upi:// only resolves on a phone. On a laptop there is no app registered
  // for the scheme, so the button does nothing at all — which is why desktop
  // gets the QR as the main path and never sees a dead button.
  var IS_PHONE = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (matchMedia("(pointer: coarse)").matches && innerWidth < 900);

  var APP_SCHEMES = { gpay: "tez://upi/pay?", phonepe: "phonepe://pay?", paytm: "paytmmp://pay?" };

  function renderPay(p) {
    $("payAmt").textContent = rupee(p.amount);
    $("mUpi").textContent = p.upi_id;
    $("mAmt").textContent = rupee(p.amount);
    $("payRef").textContent = p.id;

    try {
      $("qr").innerHTML = QR.svg(p.upi_uri, { scale: 5, quiet: 3 });
    } catch (e) {
      $("qr").innerHTML = '<p class="fineprint bad">Couldn\'t draw the QR — pay manually with the details below.</p>';
    }

    $("upiLink").href = p.upi_uri;
    var qs = p.upi_uri.split("?")[1] || "";
    document.querySelectorAll(".app-chip").forEach(function (a) {
      a.href = APP_SCHEMES[a.dataset.app] + qs;
    });

    $("payOnPhone").hidden = !IS_PHONE;
    $("payOnDesktop").hidden = IS_PHONE;
    $("showQrToggle").hidden = !IS_PHONE;
    $("deadLinkHint").hidden = true;
    $("payLead").textContent = IS_PHONE
      ? "Tap to open your UPI app — the amount is already filled in."
      : "Scan the code with any UPI app on your phone.";
  }

  // If the app never opened, the page stays visible. Say so instead of
  // leaving someone staring at a button that did nothing.
  function watchForDeadLink() {
    var t = setTimeout(function () {
      if (!document.hidden) $("deadLinkHint").hidden = false;
    }, 1500);
    var stop = function () {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", stop);
    };
    document.addEventListener("visibilitychange", stop);
  }
  $("upiLink").addEventListener("click", watchForDeadLink);
  document.querySelectorAll(".app-chip").forEach(function (a) {
    a.addEventListener("click", watchForDeadLink);
  });

  $("showQrToggle").onclick = function () {
    var hidden = $("payOnDesktop").hidden;
    $("payOnDesktop").hidden = !hidden;
    this.textContent = hidden ? "Hide QR code" : "Show QR code instead";
  };

  document.querySelectorAll(".m-copy").forEach(function (b) {
    b.onclick = function () {
      var what = b.dataset.copy;
      var text = what === "upi" ? $("mUpi").textContent
        : what === "amt" ? String(pending ? pending.amount : "")
        : $("payRef").textContent;
      navigator.clipboard.writeText(text).then(function () {
        b.textContent = "Copied ✓";
        setTimeout(function () { b.textContent = "Copy"; }, 1600);
      }).catch(function () { b.textContent = "Select it"; });
    };
  });

  $("confirmPay").onclick = function () {
    var btn = this, utr = $("utrInput").value.trim();
    if (utr.length < 6) { flash($("verifyNote"), "Enter the reference number your UPI app showed you.", true); return; }
    btn.disabled = true; btn.textContent = "CHECKING…";

    post("/api/claim", { id: pending.id, utr: utr }).then(function (r) {
      btn.disabled = false; btn.textContent = "I'VE PAID — COUNT MY POINTS";
      if (!r.ok) { flash($("verifyNote"), r.body.message || "That didn't work.", true); return; }

      var st = r.body.status;
      if (st === "approved") {
        $("doneTitle").textContent = "Points locked in";
        $("doneMsg").textContent = rupee(pending.amount) + " on team " + pending.side + ". Watch the bar move.";
        confettiRain(3);
      } else if (st === "refund_due") {
        $("doneTitle").textContent = "You just missed it";
        $("doneMsg").textContent = "The cap filled before this landed. It's flagged for a refund — nothing was counted.";
      } else {
        $("doneTitle").textContent = "Sent for checking";
        $("doneMsg").textContent = "Reference " + utr + " is in the queue. Your points land once it's confirmed.";
      }
      showPane("paneDone");
      $("utrInput").value = "";
    });
  };

  $("doneBtn").onclick = closeSheet;

  function flash(el, msg, bad) {
    var old = el.textContent, cls = el.className;
    el.textContent = msg;
    el.className = "fineprint " + (bad ? "bad" : "warn");
    setTimeout(function () { el.textContent = old; el.className = cls; }, 3200);
  }

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; })
        .then(function (b) { return { ok: res.ok, body: b }; });
    }).catch(function () {
      return { ok: false, body: { message: "Can't reach the server." } };
    });
  }

  // ─────────────────────────── live feed ───────────────────────────
  // Polling, not SSE: Cloudflare Functions can't hold a connection open.
  // Works against the Python server too, which serves the same /api/state.
  function connect() {
    (function poll() {
      fetch("/api/state", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (s) {
          drift = Date.now() - s.server_time * 1000;
          render(s);
        })
        .catch(function () { /* offline — try again next tick */ })
        .then(function () { setTimeout(poll, document.hidden ? 15000 : 3000); });
    })();
  }

  function fatal(msg) {
    if (document.querySelector(".fatal")) return;
    var bar = document.createElement("div");
    bar.className = "fatal";
    bar.textContent = msg;
    document.body.appendChild(bar);
  }

  fetch("/api/state")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (s) {
      drift = Date.now() - s.server_time * 1000;
      lastTotals = { men: s.men, women: s.women };
      render(s);
      connect();

      // arrived from the landing page with a side already picked
      var want = new URLSearchParams(location.search).get("side");
      if ((want === "men" || want === "women") && s.status === "live" && s.headroom[want] > 0) {
        setTimeout(function () { openSheet(want); }, 420);
      }
      if (want) history.replaceState({}, "", "/vote");
    })
    .catch(function (err) {
      // Failing silently here looks exactly like "nothing happens when I
      // click" — the page sits at ₹0 with buttons that do nothing. Say it.
      fatal("The scoreboard isn't responding. Try again in a moment.");
      document.querySelectorAll(".pick").forEach(function (b) { b.disabled = true; });
      console.error(
        "[cheat clash] /api/state failed:", err,
        "\nOn the deployed site this usually means the CLASH KV binding is missing" +
        " (Cloudflare → Settings → Functions → KV namespace bindings)."
      );
    });
})();
