/* Cheat Clash — landing page */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var rupee = function (n) { return "₹" + Number(n || 0).toLocaleString("en-IN"); };
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var state = null, drift = 0, last = { men: 0, women: 0 };

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
      g.gain.setValueAtTime(gain == null ? 0.05 : gain, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { /* no audio, no problem */ }
  }
  $("soundBtn").onclick = function () {
    soundOn = !soundOn;
    localStorage.setItem("cc_sound", soundOn ? "1" : "0");
    this.textContent = soundOn ? "🔊" : "🔇";
    this.classList.toggle("off", !soundOn);
    if (soundOn) beep(680, 0.1);
  };
  $("soundBtn").textContent = soundOn ? "🔊" : "🔇";
  $("soundBtn").classList.toggle("off", !soundOn);

  // ─────────────────────────── ambient particles ───────────────────────────
  var cv = $("fx"), ctx = cv.getContext("2d"), bits = [], raf = null;
  function sizeCanvas() {
    var d = window.devicePixelRatio || 1;
    cv.width = innerWidth * d; cv.height = innerHeight * d;
    cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px";
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  sizeCanvas();
  addEventListener("resize", sizeCanvas);

  var GLYPH = { men: ["🕺", "💙", "😈", "💔", "🍺"], women: ["💃", "💖", "😇", "💋", "👠"] };

  function spawn(side, n, atX, atY) {
    if (reduced) return;
    var stacked = innerWidth <= 720;
    for (var i = 0; i < n; i++) {
      var x, y;
      if (atX != null) { x = atX + (Math.random() - 0.5) * 140; y = atY + (Math.random() - 0.5) * 90; }
      else if (stacked) { x = Math.random() * innerWidth; y = side === "men" ? innerHeight * 0.42 : innerHeight * 0.58; }
      else { x = side === "men" ? Math.random() * innerWidth * 0.44 : innerWidth * 0.56 + Math.random() * innerWidth * 0.44; y = innerHeight * 0.62 + Math.random() * 80; }
      bits.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 2.6,
        vy: -1.2 - Math.random() * 2.6,
        g: GLYPH[side][(Math.random() * GLYPH[side].length) | 0],
        s: 13 + Math.random() * 17,
        rot: (Math.random() - 0.5) * 1.2,
        spin: (Math.random() - 0.5) * 0.05,
        a: 0, fade: 0.006 + Math.random() * 0.006, life: 0
      });
    }
    start();
  }

  function start() {
    if (raf) return;
    (function tick() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (var i = bits.length - 1; i >= 0; i--) {
        var b = bits[i];
        b.life++;
        b.x += b.vx; b.y += b.vy; b.rot += b.spin;
        b.vy += 0.012;
        b.vx *= 0.995;
        if (b.life < 26) b.a = Math.min(0.85, b.a + 0.04); else b.a -= b.fade;
        if (b.a <= 0 || b.y < -60) { bits.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = Math.max(0, b.a);
        ctx.translate(b.x, b.y); ctx.rotate(b.rot);
        ctx.font = b.s + "px serif"; ctx.textAlign = "center";
        ctx.fillText(b.g, 0, 0);
        ctx.restore();
      }
      if (bits.length) raf = requestAnimationFrame(tick);
      else { raf = null; ctx.clearRect(0, 0, innerWidth, innerHeight); }
    })();
  }

  // a slow trickle in the background so the page always feels alive
  if (!reduced) setInterval(function () {
    if (document.hidden || bits.length > 90) return;
    spawn(Math.random() < 0.5 ? "men" : "women", 1);
  }, 900);

  // ─────────────────────────── lean + pointer ───────────────────────────
  var glow = $("glow"), body = document.body;

  document.querySelectorAll(".word").forEach(function (w) {
    var side = w.dataset.side;
    w.addEventListener("mouseenter", function () {
      body.classList.remove("lean-men", "lean-women");
      body.classList.add("lean-" + side);
      var r = w.getBoundingClientRect();
      spawn(side, 9, r.left + r.width / 2, r.top + r.height / 2);
      beep(side === "men" ? 340 : 470, 0.09, "triangle", 0.035);
    });
    w.addEventListener("mouseleave", function () {
      body.classList.remove("lean-men", "lean-women");
    });
    // full-page transition, so the colour sweeps before the jump
    w.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      var r = w.getBoundingClientRect();
      spawn(side, 24, r.left + r.width / 2, r.top + r.height / 2);
      beep(side === "men" ? 420 : 560, 0.14, "triangle", 0.06);
      setTimeout(function () { beep(side === "men" ? 630 : 840, 0.2, "triangle", 0.05); }, 90);
      body.classList.remove("lean-men", "lean-women");
      body.classList.add("leaving", "to-" + side);
      setTimeout(function () { location.href = "/vote?side=" + side; }, 320);
    });
  });

  addEventListener("pointermove", function (e) {
    body.classList.add("has-pointer");
    glow.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)";
  }, { passive: true });
  addEventListener("pointerleave", function () { body.classList.remove("has-pointer"); });

  // ─────────────────────────── numbers ───────────────────────────
  function countUp(el, to, suffix) {
    var from = parseFloat(el.dataset.v || "0");
    el.dataset.v = to;
    // rAF is paused on a hidden tab, which would freeze the number mid-count
    if (reduced || from === to || document.hidden) {
      el.textContent = Math.round(to) + (suffix || "");
      return;
    }
    var t0 = performance.now(), dur = 700;
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * e) + (suffix || "");
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  function render(s) {
    var first = !state;
    state = s;

    $("seasonChip").textContent = "SEASON " + s.season;
    $("potChip").textContent = rupee(s.collected) + " in the pot";

    var total = s.men + s.women;
    var menPct = total ? (s.men / total) * 100 : 50;

    countUp($("menPct"), Math.round(menPct), "%");
    countUp($("womenPct"), 100 - Math.round(menPct), "%");
    $("menAmt").textContent = rupee(s.men);
    $("womenAmt").textContent = rupee(s.women);
    $("menBar").style.width = menPct + "%";
    $("womenBar").style.width = (100 - menPct) + "%";

    $("potVal").innerHTML = rupee(s.collected) + " <em>/ " + rupee(s.cap) + "</em>";
    $("capBar").style.width = Math.min(100, (s.collected / s.cap) * 100) + "%";

    // celebrate incoming points
    if (!first) {
      ["men", "women"].forEach(function (side) {
        if (s[side] > last[side]) {
          var el = $(side + "Pct");
          el.classList.add("pop");
          setTimeout(function () { el.classList.remove("pop"); }, 320);
          spawn(side, 14);
          beep(side === "men" ? 330 : 450, 0.16, "triangle", 0.05);
        }
      });
    }
    last = { men: s.men, women: s.women };

    if (s.status !== "live") {
      $("closedKicker").textContent = "SEASON " + s.season + " · FINAL";
      $("closedTitle").textContent = s.winner === "tie" ? "DEAD HEAT" : (s.winner || "").toUpperCase();
      $("closedSub").textContent = s.winner === "tie"
        ? "Perfectly, infuriatingly tied. Nobody gets to be smug."
        : (s.winner === "men" ? "Men" : "Women") + " cheat more — " + rupee(s.men) + " to " + rupee(s.women) +
          ". Season " + (s.season + 1) + " opens on reset.";
      $("closed").hidden = false;
      $("nudge").innerHTML = "This season is over.";
    } else {
      $("closed").hidden = true;
      $("nudge").innerHTML = s.remaining < 1000
        ? "Only <b>" + rupee(s.remaining) + "</b> left before it all ends."
        : "Tap a side. <b>₹1 = 1 point.</b>";
    }
  }

  setInterval(function () {
    if (!state) return;
    var left = Math.max(0, state.ends_at * 1000 - (Date.now() - drift));
    var s = Math.floor(left / 1000);
    $("cdVal").textContent =
      Math.floor(s / 86400) + "d " +
      String(Math.floor(s % 86400 / 3600)).padStart(2, "0") + ":" +
      String(Math.floor(s % 3600 / 60)).padStart(2, "0") + ":" +
      String(s % 60).padStart(2, "0");
  }, 250);

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

  fetch("/api/state").then(function (r) { return r.json(); }).then(function (s) {
    drift = Date.now() - s.server_time * 1000;
    last = { men: s.men, women: s.women };
    render(s);
    connect();
  });

  // bfcache: undo the leave animation if the user comes back
  addEventListener("pageshow", function () {
    body.classList.remove("leaving", "to-men", "to-women", "lean-men", "lean-women");
  });
})();
