/* Minimal QR encoder - byte mode, versions 1-10, EC level L/M.
   Written from scratch so the site ships with zero dependencies and works offline.
   Usage:  QR.svg("upi://pay?...", { scale: 8, quiet: 4 })  ->  SVG markup string  */
(function (global) {
  "use strict";

  // ---- GF(256) ----------------------------------------------------------
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function mul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  function rsGenerator(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(poly.length + 1).fill(0);
      // multiply poly by (x + a^i), highest-degree coefficient first
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      for (var j = 0; j < gen.length - 1; j++) res[j] ^= mul(gen[j + 1], factor);
    }
    return res;
  }

  // ---- version tables ---------------------------------------------------
  // [ecPerBlock, blocksG1, dataG1, blocksG2, dataG2]
  var RS = {
    L: [null,
      [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0],
      [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0],
      [30, 2, 116, 0, 0], [18, 2, 68, 2, 69]],
    M: [null,
      [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
      [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
      [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]]
  };

  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  var ECBITS = { L: 1, M: 0, Q: 3, H: 2 };

  function capacity(ver, ecl) {
    var t = RS[ecl][ver];
    return t[1] * t[2] + t[3] * t[4];
  }

  // ---- bit buffer -------------------------------------------------------
  function Bits() { this.bits = []; }
  Bits.prototype.put = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  };

  // ---- encode -----------------------------------------------------------
  function utf8(str) {
    var out = [], s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
    return out;
  }

  function buildCodewords(bytes, ver, ecl) {
    var bb = new Bits();
    bb.put(4, 4);                                  // byte mode
    bb.put(bytes.length, ver < 10 ? 8 : 16);       // char count
    for (var i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);

    var total = capacity(ver, ecl) * 8;
    for (i = 0; i < 4 && bb.bits.length < total; i++) bb.bits.push(0);   // terminator
    while (bb.bits.length % 8) bb.bits.push(0);

    var data = [];
    for (i = 0; i < bb.bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bb.bits[i + j];
      data.push(b);
    }
    var pad = [0xec, 0x11], p = 0;
    while (data.length < capacity(ver, ecl)) data.push(pad[p++ % 2]);

    // split into blocks, interleave
    var t = RS[ecl][ver], ecLen = t[0];
    var blocks = [], ecs = [], pos = 0;
    function take(count, size) {
      for (var k = 0; k < count; k++) {
        var chunk = data.slice(pos, pos + size);
        pos += size;
        blocks.push(chunk);
        ecs.push(rsEncode(chunk, ecLen));
      }
    }
    take(t[1], t[2]);
    take(t[3], t[4]);

    var out = [], maxData = Math.max(t[2], t[4]);
    for (i = 0; i < maxData; i++)
      for (j = 0; j < blocks.length; j++)
        if (i < blocks[j].length) out.push(blocks[j][i]);
    for (i = 0; i < ecLen; i++)
      for (j = 0; j < ecs.length; j++) out.push(ecs[j][i]);
    return out;
  }

  // ---- matrix -----------------------------------------------------------
  function newMatrix(size) {
    var m = [];
    for (var i = 0; i < size; i++) m.push(new Array(size).fill(null));
    return m;
  }

  function placeFinder(m, r, c) {
    for (var dr = -1; dr <= 7; dr++) {
      for (var dc = -1; dc <= 7; dc++) {
        var rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        var inRing = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                     (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6));
        var inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        m[rr][cc] = (inRing || inCore) ? 1 : 0;
      }
    }
  }

  function placeFunction(m, ver) {
    var size = m.length;
    placeFinder(m, 0, 0);
    placeFinder(m, 0, size - 7);
    placeFinder(m, size - 7, 0);

    for (var i = 8; i < size - 8; i++) {           // timing
      var v = (i % 2 === 0) ? 1 : 0;
      m[6][i] = v; m[i][6] = v;
    }

    var centers = ALIGN[ver], last = centers.length - 1;
    for (var a = 0; a <= last; a++) {
      for (var b = 0; b <= last; b++) {
        // the three corners are occupied by finder patterns
        if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue;
        var r = centers[a], c = centers[b];
        for (var dr = -2; dr <= 2; dr++)
          for (var dc = -2; dc <= 2; dc++)
            m[r + dr][c + dc] =
              (Math.max(Math.abs(dr), Math.abs(dc)) !== 1) ? 1 : 0;
      }
    }

    m[size - 8][8] = 1;                            // dark module

    for (i = 0; i < 9; i++) {                      // reserve format areas
      if (m[8][i] === null) m[8][i] = 2;
      if (m[i][8] === null) m[i][8] = 2;
    }
    for (i = 0; i < 8; i++) {
      if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 2;
      if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 2;
    }

    if (ver >= 7) {                                // reserve version areas
      for (i = 0; i < 6; i++)
        for (var j = 0; j < 3; j++) {
          m[i][size - 11 + j] = 2;
          m[size - 11 + j][i] = 2;
        }
    }
  }

  function placeData(m, cw) {
    var size = m.length, bitIdx = 0, dir = -1, row = size - 1;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;                        // skip timing column
      while (true) {
        for (var k = 0; k < 2; k++) {
          var c = col - k;
          if (m[row][c] === null) {
            var bit = 0;
            if (bitIdx >>> 3 < cw.length) bit = (cw[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
            m[row][c] = bit;
            bitIdx++;
          }
        }
        row += dir;
        if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
      }
    }
  }

  function maskFn(n) {
    switch (n) {
      case 0: return function (r, c) { return (r + c) % 2 === 0; };
      case 1: return function (r) { return r % 2 === 0; };
      case 2: return function (r, c) { return c % 3 === 0; };
      case 3: return function (r, c) { return (r + c) % 3 === 0; };
      case 4: return function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; };
      case 5: return function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; };
      case 6: return function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; };
      default: return function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; };
    }
  }

  function bch15(fmt) {
    var d = fmt << 10;
    for (var i = 14; i >= 10; i--) if ((d >>> i) & 1) d ^= 0x537 << (i - 10);
    return ((fmt << 10) | d) ^ 0x5412;
  }

  function bch18(ver) {
    var d = ver << 12;
    for (var i = 17; i >= 12; i--) if ((d >>> i) & 1) d ^= 0x1f25 << (i - 12);
    return (ver << 12) | d;
  }

  function applyFormat(m, ecl, mask) {
    var size = m.length, bits = bch15((ECBITS[ecl] << 3) | mask);
    for (var i = 0; i < 15; i++) {
      var b = (bits >>> i) & 1;
      // vertical strip, top-left
      if (i < 6) m[i][8] = b;
      else if (i < 8) m[i + 1][8] = b;
      else m[size - 15 + i][8] = b;
      // horizontal strip, top-left
      if (i < 8) m[8][size - 1 - i] = b;
      else if (i < 9) m[8][15 - i - 1 + 1] = b;
      else m[8][15 - i - 1] = b;
    }
    m[size - 8][8] = 1;
  }

  function applyVersion(m, ver) {
    if (ver < 7) return;
    var size = m.length, bits = bch18(ver);
    for (var i = 0; i < 18; i++) {
      var b = (bits >>> i) & 1;
      var r = Math.floor(i / 3), c = i % 3;
      m[r][size - 11 + c] = b;
      m[size - 11 + c][r] = b;
    }
  }

  function penalty(m) {
    var size = m.length, score = 0, i, j, run, dark = 0;

    for (i = 0; i < size; i++) {                   // rule 1: runs of 5+
      for (var pass = 0; pass < 2; pass++) {
        run = 1;
        for (j = 1; j < size; j++) {
          var a = pass ? m[j][i] : m[i][j];
          var p = pass ? m[j - 1][i] : m[i][j - 1];
          if (a === p) { run++; }
          else { if (run >= 5) score += run - 2; run = 1; }
        }
        if (run >= 5) score += run - 2;
      }
    }

    for (i = 0; i < size - 1; i++)                 // rule 2: 2x2 blocks
      for (j = 0; j < size - 1; j++)
        if (m[i][j] === m[i][j + 1] && m[i][j] === m[i + 1][j] && m[i][j] === m[i + 1][j + 1])
          score += 3;

    var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];  // rule 3: finder-like
    var pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function matches(get, start, pat) {
      for (var k = 0; k < 11; k++) if (get(start + k) !== pat[k]) return false;
      return true;
    }
    for (i = 0; i < size; i++) {
      for (j = 0; j + 11 <= size; j++) {
        var rowGet = (function (r) { return function (x) { return m[r][x]; }; })(i);
        var colGet = (function (c) { return function (x) { return m[x][c]; }; })(i);
        if (matches(rowGet, j, pat1) || matches(rowGet, j, pat2)) score += 40;
        if (matches(colGet, j, pat1) || matches(colGet, j, pat2)) score += 40;
      }
    }

    for (i = 0; i < size; i++)                     // rule 4: dark ratio
      for (j = 0; j < size; j++) if (m[i][j]) dark++;
    var pct = dark * 100 / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function encode(text, ecl) {
    ecl = ecl || "L";
    var bytes = utf8(text), ver = 0;
    for (var v = 1; v <= 10; v++) {
      var headerBits = 4 + (v < 10 ? 8 : 16);
      if (bytes.length + Math.ceil(headerBits / 8) <= capacity(v, ecl)) { ver = v; break; }
    }
    if (!ver) throw new Error("QR: payload too long (" + bytes.length + " bytes)");

    var cw = buildCodewords(bytes, ver, ecl);
    var size = ver * 4 + 17;

    var base = newMatrix(size);
    placeFunction(base, ver);

    var best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var m = base.map(function (r) { return r.slice(); });
      placeData(m, cw);
      var fn = maskFn(mask);
      for (var r = 0; r < size; r++)
        for (var c = 0; c < size; c++)
          if (base[r][c] === null && fn(r, c)) m[r][c] ^= 1;
      applyFormat(m, ecl, mask);
      applyVersion(m, ver);
      var s = penalty(m);
      if (s < bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  function svg(text, opts) {
    opts = opts || {};
    var scale = opts.scale || 6, quiet = opts.quiet == null ? 4 : opts.quiet;
    var m = encode(text, opts.ecl || "L");
    var size = m.length, dim = (size + quiet * 2) * scale;
    var d = "";
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (m[r][c] === 1) {
          d += "M" + ((c + quiet) * scale) + " " + ((r + quiet) * scale) +
               "h" + scale + "v" + scale + "h-" + scale + "z";
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim +
      '" width="' + dim + '" height="' + dim + '" shape-rendering="crispEdges" role="img" aria-label="UPI QR code">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + (opts.bg || "#ffffff") + '"/>' +
      '<path d="' + d + '" fill="' + (opts.fg || "#0b0714") + '"/></svg>';
  }

  global.QR = { encode: encode, svg: svg };
})(window);
