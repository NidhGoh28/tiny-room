/* Tiny Room: an isometric pixel bedroom that is secretly a live view of your Mac.
   window = real sky · lamp = battery · fern = CPU · bookshelf = disk · paper pile = Downloads
   cat = whether you're at the keyboard · calendar = today + how long since a restart */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const bridge = window.roomDesk || null;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ================= live data ================= */
  const D = {
    cpu: 0.12, cpuHist: [], cores: 8,
    disk: { total: 250e9, free: 120e9 },
    dl: { ok: true, count: 12, bytes: 2.4e9, week: 3 },
    idle: 0, uptime: 3600 * 30,
    battery: null, // { level, charging, dischargingTime }
  };
  let timeOverride = null;
  const now = () => (timeOverride ? new Date(timeOverride) : new Date());
  let cpuSmooth = D.cpu;

  if (bridge) bridge.onStats((s) => {
    if (!s) return;
    D.cpu = s.cpu; D.cores = s.cores; D.disk = s.disk; D.dl = s.dl; D.idle = s.idle; D.uptime = s.uptime;
    D.cpuHist.push(s.cpu); if (D.cpuHist.length > 90) D.cpuHist.shift();
    if (card.open) showCard(card.open);
  });
  if (navigator.getBattery) navigator.getBattery().then((b) => {
    const upd = () => { D.battery = { level: b.level, charging: b.charging, dischargingTime: b.dischargingTime }; if (card.open) showCard(card.open); };
    // desktop Macs report a "full, charging" battery with no discharge time; treat that as no battery
    upd(); ["levelchange", "chargingchange", "dischargingtimechange"].forEach((e) => b.addEventListener(e, upd));
  }).catch(() => {});

  /* ================= sun & sky ================= */
  const ZONES = { "America/Toronto": [43.65, -79.38], "America/New_York": [40.71, -74.0], "America/Chicago": [41.88, -87.63], "America/Denver": [39.74, -104.99], "America/Los_Angeles": [34.05, -118.24], "America/Vancouver": [49.28, -123.12], "America/Montreal": [45.5, -73.57], "Europe/London": [51.5, -0.12], "Europe/Paris": [48.86, 2.35], "Europe/Berlin": [52.52, 13.4], "Asia/Kolkata": [28.61, 77.21], "Asia/Calcutta": [28.61, 77.21], "Asia/Tokyo": [35.68, 139.69], "Asia/Singapore": [1.35, 103.82], "Australia/Sydney": [-33.87, 151.21], "Asia/Dubai": [25.2, 55.27] };
  function place() {
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || "";
    if (ZONES[tz]) return ZONES[tz];
    const y = now().getFullYear(), std = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset());
    return [40, -std / 4];
  }
  function sunTimes(d) { // NOAA approximation; returns local minutes after midnight
    const [lat, lon] = place(), rad = Math.PI / 180;
    const start = new Date(d.getFullYear(), 0, 0), n = Math.floor((d - start) / 864e5);
    const g = 2 * Math.PI / 365 * (n - 1);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    let c = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec);
    c = Math.max(-1, Math.min(1, c));
    const ha = Math.acos(c) / rad, off = -d.getTimezoneOffset();
    return { rise: 720 - 4 * (lon + ha) - eq + off, set: 720 - 4 * (lon - ha) - eq + off };
  }
  function skyState() {
    const d = now(), m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    const { rise, set } = sunTimes(d);
    const ramp = 45;
    const day = Math.max(0, Math.min(1, Math.min((m - (rise - ramp / 2)) / ramp, ((set + ramp / 2) - m) / ramp)));
    const nearRise = Math.abs(m - rise) < 70, nearSet = Math.abs(m - set) < 70;
    const phase = day >= 1 ? "day" : day <= 0 ? "night" : m < 720 ? "dawn" : "dusk";
    const sunT = (m - rise) / (set - rise); // 0..1 across the day
    return { m, rise, set, day, phase, sunT, golden: nearRise || nearSet };
  }

  /* ================= pixel engine ================= */
  const W = 176, H = 146, OX = 88, OY = 70;
  const cv = $("room"), g = cv.getContext("2d");
  const img = g.createImageData(W, H);
  const col = new Uint32Array(W * H);   // 0 = empty, else 0x1RRGGBB
  const ids = new Uint8Array(W * H);
  const beam = new Uint8Array(W * H);
  const paneId = new Uint8Array(W * H);
  const hx = (s) => 0x1000000 | parseInt(s.slice(1), 16);
  const iso = (x, y, z) => [OX + (x - y) * 4, OY + (x + y) * 2 - z];

  let idNames = [null], emissive = new Set();
  function newId(name, glow) { const id = idNames.length; idNames.push(name); if (glow) emissive.add(id); return id; }

  function put(x, y, c, id) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H || c == null) return; const i = y * W + x; col[i] = c; ids[i] = id; }
  function fillPoly(pts, c, id, mask) {
    let y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(H - 1, Math.ceil(y1));
    const fn = typeof c === "function";
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) {
          if (mask) { mask[y * W + x] = 1; continue; }
          put(x, y, fn ? c(x, y) : c, id);
        }
      }
    }
  }
  const quad = (a, b, c2, d2) => [iso(...a), iso(...b), iso(...c2), iso(...d2)];
  function box(x, y, z, w, d, h, top, left, right, id) {
    fillPoly(quad([x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]), right, id); // face +x
    fillPoly(quad([x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]), left, id);  // face +y
    fillPoly(quad([x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]), top, id);   // top
  }
  function oval(cx, cy, rx, ry, c, id) {
    for (let y = Math.floor(-ry); y <= Math.ceil(ry); y++) for (let x = Math.floor(-rx); x <= Math.ceil(rx); x++)
      if ((x * x) / (rx * rx + .3) + (y * y) / (ry * ry + .3) <= 1) put(cx + x, cy + y, c, id);
  }
  function line(x0, y0, x1, y1, c, id, w = 1) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; for (let a = 0; a < w; a++) for (let b = 0; b < w; b++) put(x + a - (w > 1 ? .5 : 0), y + b - (w > 1 ? .5 : 0), c, id); }
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  function mix(c1, c2, t) {
    const r = lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t), gg = lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t), b = lerp(c1 & 255, c2 & 255, t);
    return 0x1000000 | (r << 16) | (gg << 8) | b;
  }
  // deterministic noise for textures
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

  /* ================= palette ================= */
  const P = {
    ink: hx("#4a3b5c"),
    wallL: hx("#ecdcf0"), wallLdot: hx("#e2cde8"), wallR: hx("#f6ecf7"), wallRdot: hx("#eddcef"),
    skirt: hx("#fffaf6"), skirt2: hx("#e6d3e3"), wallTop: hx("#fff7fb"), wallEnd: hx("#d8c1de"),
    floor: hx("#ebcaa4"), floor2: hx("#e3bf96"), seam: hx("#d2aa80"), slabL: hx("#c99f78"), slabR: hx("#b98e69"),
    rug: hx("#ffc9d6"), rug2: hx("#ffe4eb"), rugB: hx("#f3a8ba"),
    wood: hx("#dcae86"), wood2: hx("#c8946c"), wood3: hx("#b07d5a"), cavity: hx("#8e6550"),
    books: ["#ff8fab", "#8ec5ff", "#ffd27a", "#9be3b5", "#c3a6ff", "#ff9e7a", "#7fd1d9", "#f6a6ff"].map(hx),
    deskTop: hx("#fff3e4"), deskL: hx("#ecd8bf"), deskR: hx("#dcc3a6"), leg: hx("#c9ae8f"),
    lapTop: hx("#e3e6ef"), lapL: hx("#c9cedb"), lapR: hx("#b5bccb"), screen: hx("#a8d8ff"), screen2: hx("#d8f0ff"),
    shade: hx("#ffd6a5"), shade2: hx("#ffbf86"),
    pot: hx("#e8a37c"), pot2: hx("#d38a64"), pot3: hx("#f3bc98"), soil: hx("#7a5543"),
    leaf: hx("#7fcf8f"), leaf2: hx("#5fb174"), leafSick: hx("#c9cf7a"), leafSick2: hx("#a8ad5f"),
    paper: hx("#ffffff"), paper2: hx("#e6e2ee"), paper3: hx("#d3cde0"),
    fur: hx("#fff3e6"), fur2: hx("#f1dcc8"), patch: hx("#f7b27a"), pink: hx("#ffb3c7"), belly: hx("#ffffff"),
    frame: hx("#ffffff"), frame2: hx("#e7dbe9"), curtain: hx("#ffd1dc"), curtain2: hx("#ffbccb"),
    calPaper: hx("#ffffff"), calBand: hx("#ff8fab"),
    wire: hx("#8a7b98"),
    hover: hx("#fff1a8"),
  };
  const SKY = {
    day: [hx("#8fcbff"), hx("#d6efff")], dawn: [hx("#b7a5ff"), hx("#ffc9a6")], dusk: [hx("#8d84d8"), hx("#ffb08f")], night: [hx("#1f2350"), hx("#3d3a74")],
  };

  /* ================= tiny 3×5 font for the calendar ================= */
  const F3 = { A: [".#.", "#.#", "###", "#.#", "#.#"], B: ["##.", "#.#", "##.", "#.#", "##."], C: [".##", "#..", "#..", "#..", ".##"], D: ["##.", "#.#", "#.#", "#.#", "##."], E: ["###", "#..", "##.", "#..", "###"], F: ["###", "#..", "##.", "#..", "#.."], G: [".##", "#..", "#.#", "#.#", ".##"], J: ["..#", "..#", "..#", "#.#", ".#."], L: ["#..", "#..", "#..", "#..", "###"], M: ["#.#", "###", "#.#", "#.#", "#.#"], N: ["##.", "#.#", "#.#", "#.#", "#.#"], O: ["###", "#.#", "#.#", "#.#", "###"], P: ["##.", "#.#", "##.", "#..", "#.."], R: ["##.", "#.#", "##.", "#.#", "#.#"], S: [".##", "#..", ".#.", "..#", "##."], T: ["###", ".#.", ".#.", ".#.", ".#."], U: ["#.#", "#.#", "#.#", "#.#", "###"], V: ["#.#", "#.#", "#.#", "#.#", ".#."], Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
    0: ["###", "#.#", "#.#", "#.#", "###"], 1: [".#.", "##.", ".#.", ".#.", "###"], 2: ["##.", "..#", ".#.", "#..", "###"], 3: ["##.", "..#", ".#.", "..#", "##."], 4: ["#.#", "#.#", "###", "..#", "..#"], 5: ["###", "#..", "##.", "..#", "##."], 6: [".##", "#..", "###", "#.#", "###"], 7: ["###", "..#", ".#.", ".#.", ".#."], 8: ["###", "#.#", "###", "#.#", "###"], 9: ["###", "#.#", "###", "..#", "##."] };
  function text3(str, x, y, c, id, s = 1) {
    let cx = x;
    for (const ch of str) { const gl = F3[ch]; if (gl) gl.forEach((row, r) => [...row].forEach((v, k) => { if (v === "#") for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) put(cx + k * s + a, y + r * s + b, c, id); })); cx += 4 * s; }
  }
  const textW = (str, s = 1) => str.length * 4 * s - s;

  /* ================= scene ================= */
  let T = 0;                // animation clock (seconds)
  let hover = 0;            // id under the mouse
  let catHop = 0, hearts = [], zs = [], blinkAt = 2;
  const hitName = {};       // object name -> list of ids this frame

  function drawRoom(sky) {
    col.fill(0); ids.fill(0); beam.fill(0); idNames = [null]; emissive = new Set();
    for (const k in hitName) delete hitName[k];
    const reg = (name, glow) => { const id = newId(name, glow); (hitName[name] = hitName[name] || []).push(id); return id; };

    // --- walls (thick boxes) ---
    const wl = reg("wallL"), wr = reg("wallR");
    const WH = 56;
    // left wall inner face: x = 0 plane, wallpaper with dots + skirting board
    fillPoly(quad([0, 0, 0], [0, 16, 0], [0, 16, WH], [0, 0, WH]), (sx, sy) => {
      const y = (OX - sx) / 4, z = OY + 2 * y - sy;
      if (z < 3) return z < 1 ? P.skirt2 : P.skirt;
      const row = Math.floor(z / 5), dot = ((y * 4 + (row % 2) * 4) % 8 + 8) % 8;
      return (dot < 1 && (z % 5) < 1) ? P.wallLdot : P.wallL;
    }, wl);
    fillPoly(quad([0, 0, 0], [16, 0, 0], [16, 0, WH], [0, 0, WH]), (sx, sy) => {
      const x = (sx - OX) / 4, z = OY + 2 * x - sy;
      if (z < 3) return z < 1 ? P.skirt2 : P.skirt;
      const row = Math.floor(z / 5), dot = ((x * 4 + (row % 2) * 4) % 8 + 8) % 8;
      return (dot < 1 && (z % 5) < 1) ? P.wallRdot : P.wallR;
    }, wr);
    // wall tops + front edges (thickness 1.5)
    fillPoly(quad([-1.5, -1.5, WH], [0, -1.5, WH], [0, 16, WH], [-1.5, 16, WH]), P.wallTop, wl);
    fillPoly(quad([-1.5, -1.5, WH], [16, -1.5, WH], [16, 0, WH], [-1.5, 0, WH]), P.wallTop, wr);
    fillPoly(quad([-1.5, 16, -4], [0, 16, -4], [0, 16, WH], [-1.5, 16, WH]), P.wallEnd, wl);
    fillPoly(quad([16, -1.5, -4], [16, 0, -4], [16, 0, WH], [16, -1.5, WH]), P.wallEnd, wr);

    // --- floor: planks + slab ---
    const fl = reg("floor");
    fillPoly(quad([0, 0, 0], [16, 0, 0], [16, 16, 0], [0, 16, 0]), (sx, sy) => {
      const a = (sx - OX) / 4, b = (sy - OY) / 2, x = (a + b) / 2, y = (b - a) / 2;
      const row = Math.floor(y / 1.6), fy = y / 1.6 - row;
      if (fy < 0.14) return P.seam;
      const fx = ((x + row * 3.7) / 6) % 1;
      if (fx < 0.03) return P.seam;
      return row % 2 ? P.floor : P.floor2;
    }, fl);
    fillPoly(quad([0, 16, 0], [16, 16, 0], [16, 16, -4], [0, 16, -4]), P.slabL, fl);
    fillPoly(quad([16, 0, 0], [16, 16, 0], [16, 16, -4], [16, 0, -4]), P.slabR, fl);
    // daylight beam through the window
    if (sky.day > 0) fillPoly(quad([3, 0.2, 0], [8.5, 0.2, 0], [10.5, 7, 0], [5, 7, 0]), null, 0, beam);

    // --- rug ---
    const rg = reg("rug"), pts = [], pts2 = [];
    for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; pts.push(iso(8 + Math.cos(a) * 4.6, 10 + Math.sin(a) * 4.6, 0)); pts2.push(iso(8 + Math.cos(a) * 3.2, 10 + Math.sin(a) * 3.2, 0)); }
    fillPoly(pts, P.rugB, rg); fillPoly(pts2.map((p, i) => [p[0], p[1]]), (sx, sy) => ((sx + sy * 2) >> 2) % 3 === 0 ? P.rug2 : P.rug, rg);

    // --- window on the right wall: the real sky ---
    drawWindow(sky, reg);

    // --- calendar poster on the left wall (faces you, so it's readable) ---
    drawCalendar(reg);

    // --- fairy lights along the top of the walls ---
    drawLights(sky, reg);

    // --- furniture, back to front ---
    drawShelf(reg);
    drawDesk(sky, reg);
    drawPlant(reg);
    drawCat(reg);
    drawPapers(reg);
  }

  function drawWindow(sky, reg) {
    const fr = reg("window"), sk = reg("window", true);
    // curtains
    const cur = (x0, x1) => fillPoly(quad([x0, 0, 23], [x1, 0, 23], [x1, 0, 51], [x0, 0, 51]), (sx) => ((sx >> 1) % 2 ? P.curtain : P.curtain2), fr);
    cur(1.8, 3.1); cur(8.6, 9.9);
    // pane: per-pixel sky shader (winFn is bound each frame with the current sky)
    fillPoly(quad([3, 0, 25.5], [8.5, 0, 25.5], [8.5, 0, 48], [3, 0, 48]), (sx, sy) => { const r = winFn(sx, sy); paneId[sy * W + sx] = r.f ? fr : sk; return r.c; }, sk);
    for (let i = 0; i < paneId.length; i++) if (paneId[i]) { ids[i] = paneId[i]; paneId[i] = 0; }
    // sill
    box(2.6, 0, 24.3, 6.3, 1, 1.2, P.frame, P.frame2, P.frame2, fr);
  }
  // helper so the pane shader above can be reused (set inside drawWindow)
  let winFn = () => ({ c: 0, f: true });

  function drawCalendar(reg) {
    const id = reg("calendar");
    const [cx, cy] = iso(0, 12, 36);
    const x0 = Math.round(cx - 8), y0 = Math.round(cy - 9), w = 16, h = 18;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x0 + x, y0 + y, y < 4 ? P.calBand : P.calPaper, id);
    put(x0 + 4, y0 - 1, P.ink, id); put(x0 + 11, y0 - 1, P.ink, id); // rings
    const d = now(), mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getMonth()], day = String(d.getDate());
    text3(mon, x0 + Math.round((w - textW(mon)) / 2), y0 + 5, P.ink, id);
    text3(day, x0 + Math.round((w - textW(day, 1)) / 2), y0 + 11, hx("#ff6f91"), id);
  }

  function drawLights(sky, reg) {
    const id = reg("lights", true), wire = reg("lights");
    const on = sky.day < 0.6;
    const cols = ["#ffd27a", "#ff9ec0", "#9fd8ff", "#b9f2c4", "#e2b8ff"].map(hx);
    let n = 0;
    const strand = (p0, p1) => {
      const seg = 12;
      for (let i = 0; i <= seg * 4; i++) {
        const t = i / (seg * 4), k = t * seg % 1;
        const x = lerp(p0[0], p1[0], t), y = lerp(p0[1], p1[1], t), z = lerp(p0[2], p1[2], t) - Math.sin(Math.PI * k) * 2.2;
        const [sx, sy] = iso(x, y, z); put(sx, sy, P.wire, wire);
      }
      for (let s = 0; s < seg; s++) {
        const t = (s + 0.5) / seg, x = lerp(p0[0], p1[0], t), y = lerp(p0[1], p1[1], t), z = lerp(p0[2], p1[2], t) - 2.6;
        const [sx, sy] = iso(x, y, z), c = cols[n++ % cols.length];
        const tw = 0.55 + 0.45 * Math.sin(T * 2.2 + n * 1.7);
        put(sx, sy, on ? mix(hx("#fff8e6"), c, 0.5 + 0.3 * tw) : mix(c, P.wallR, 0.35), id);
        put(sx, sy + 1, on ? c : mix(c, P.wallR, 0.5), id);
        if (on) glows.push([sx, sy, 7, c, 0.35 * tw * (1 - sky.day)]);
      }
    };
    strand([0, 15.5, 53], [0, 0.3, 53]);
    strand([0.3, 0, 53], [15.5, 0, 53]);
  }

  function drawShelf(reg) {
    const id = reg("shelf");
    const x = 0, y = 2.5, w = 3, d = 6, h = 40;
    box(x, y, 0, w, d, h, P.wood, P.wood2, P.wood3, id);
    const used = D.disk.total ? 1 - D.disk.free / D.disk.total : 0;
    const slots = 32, filled = Math.round(used * slots);
    let k = 0;
    for (let s = 0; s < 4; s++) {
      const z0 = 1.5 + s * 9.7, z1 = z0 + 7.6;
      fillPoly(quad([w, y + 0.5, z0], [w, y + d - 0.5, z0], [w, y + d - 0.5, z1], [w, y + 0.5, z1]), P.cavity, id);
      for (let b = 0; b < 8; b++, k++) {
        if (k >= filled) continue;
        const by = y + 0.6 + b * 0.62, bh = 5 + hash(k, 3) * 2.4, c = P.books[(k * 5 + s) % P.books.length];
        fillPoly(quad([w, by, z0], [w, by + 0.52, z0], [w, by + 0.52, z0 + bh], [w, by, z0 + bh]), (sx, sy) => ((sy + k) % 6 === 0 ? mix(c, P.ink, 0.25) : c), id);
      }
    }
    if (used > 0.92) { // overflowing: books stacked on top and on the floor
      box(0.4, 3.2, h, 2.2, 1.6, 0.9, P.books[0], mix(P.books[0], P.ink, 0.2), mix(P.books[0], P.ink, 0.3), id);
      box(0.6, 3.4, h + 0.9, 1.8, 1.4, 0.9, P.books[2], mix(P.books[2], P.ink, 0.2), mix(P.books[2], P.ink, 0.3), id);
      box(3.6, 6.5, 0, 2.2, 1.5, 0.9, P.books[4], mix(P.books[4], P.ink, 0.2), mix(P.books[4], P.ink, 0.3), id);
      box(3.8, 6.4, 0.9, 1.9, 1.3, 0.9, P.books[1], mix(P.books[1], P.ink, 0.2), mix(P.books[1], P.ink, 0.3), id);
    }
  }

  function drawDesk(sky, reg) {
    const id = reg("desk"), lap = reg("laptop"), scr = reg("laptop", true), lamp = reg("lamp"), bulb = reg("lamp", true);
    for (const [lx, ly] of [[9.7, 0.2], [14.9, 0.2], [9.7, 3.7], [14.9, 3.7]]) box(lx, ly, 0, 0.6, 0.6, 13, P.leg, mix(P.leg, P.ink, 0.15), mix(P.leg, P.ink, 0.25), id);
    box(9.5, 0, 13, 6, 4.5, 1.6, P.deskTop, P.deskL, P.deskR, id);
    // laptop: base + upright screen that shows busy "code" when the CPU works hard
    box(10.3, 1.2, 14.6, 2.9, 2.1, 0.4, P.lapTop, P.lapL, P.lapR, lap);
    fillPoly(quad([10.3, 1.2, 15], [13.2, 1.2, 15], [13.2, 1.2, 19.4], [10.3, 1.2, 19.4]), P.ink, lap);
    fillPoly(quad([10.6, 1.25, 15.5], [12.9, 1.25, 15.5], [12.9, 1.25, 18.9], [10.6, 1.25, 18.9]), (sx, sy) => {
      const lines = Math.round(1 + cpuSmooth * 5), r = (sy + Math.floor(T * (1 + cpuSmooth * 6))) % 3;
      return r === 0 && ((sx * 7 + sy * 3) % 9) < lines + 2 ? P.screen2 : P.screen;
    }, scr);
    // lamp
    const b = D.battery, level = b ? b.level : 1;
    box(14.1, 1, 14.6, 0.9, 0.9, 0.6, P.ink, P.ink, P.ink, lamp);
    const [px, py] = iso(14.55, 1.45, 15.2), [tx, ty] = iso(14.55, 1.45, 25);
    line(px, py, tx, ty, P.ink, lamp);
    for (let r = 0; r < 5; r++) { const half = 2 + r * 0.7; for (let x = -half; x <= half; x++) put(tx + x, ty - 4 + r, r % 2 ? P.shade2 : P.shade, lamp); }
    let flick = 1;
    if (b && level < 0.2 && !b.charging) flick = Math.sin(T * 23) > 0.2 || Math.random() < 0.6 ? 1 : 0.25;
    const bc = level > 0.6 ? hx("#fff6b8") : level > 0.2 ? hx("#ffd08a") : hx("#ff9a8a");
    put(tx, ty + 1, mix(P.ink, bc, flick), bulb); put(tx - 1, ty + 1, mix(P.ink, bc, flick * 0.8), bulb); put(tx + 1, ty + 1, mix(P.ink, bc, flick * 0.8), bulb);
    glows.push([tx, ty + 3, 16 + 34 * level, hx("#ffcf8a"), (0.06 + 0.85 * (1 - sky.day)) * flick * (0.4 + 0.6 * level)]);
    if (b && b.charging) { // little cable to a wall socket
      const [sx2, sy2] = iso(15.6, 0, 6); fillPoly([[sx2 - 1, sy2 - 2], [sx2 + 2, sy2 - 3.5], [sx2 + 2, sy2 + 0.5], [sx2 - 1, sy2 + 2]], P.frame, lamp);
      line(px + 1, py, sx2, sy2, P.ink, lamp);
      if (Math.sin(T * 4) > 0) put(sx2 + 1, sy2 - 4, hx("#ffd27a"), bulb);
    }
  }

  function drawPlant(reg) {
    const id = reg("plant");
    box(2.2, 11.6, 0, 2, 2, 4.6, P.pot3, P.pot, P.pot2, id);
    fillPoly(quad([2.5, 11.9, 4.6], [3.9, 11.9, 4.6], [3.9, 13.3, 4.6], [2.5, 13.3, 4.6]), P.soil, id);
    const droop = Math.max(0, Math.min(1, (cpuSmooth - 0.25) / 0.6));
    const sick = cpuSmooth > 0.8;
    const [bx, by] = iso(3.2, 12.6, 4.6);
    const leaves = [[-0.9, 13], [-0.45, 16], [0.05, 18], [0.5, 15], [0.95, 12], [-0.2, 11], [0.3, 10]];
    leaves.forEach(([a, L], i) => {
      const sway = reduce ? 0 : Math.sin(T * 1.4 + i * 1.3) * 0.05 * (1 - droop * 0.7);
      const ang = a * (1 + droop * 0.9) + sway, len = L * (1 - droop * 0.15);
      let lx = bx, ly = by;
      const steps = Math.ceil(len);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const nx = bx + Math.sin(ang) * len * t, ny = by - Math.cos(ang) * len * t + droop * len * 0.95 * t * t;
        const c = (sick ? (t > 0.5 ? P.leafSick : P.leafSick2) : (t > 0.45 ? P.leaf : P.leaf2));
        line(lx, ly, nx, ny, c, id, t > 0.25 && t < 0.85 ? 2 : 1);
        lx = nx; ly = ny;
      }
    });
  }

  function catState() { return D.idle >= 300 ? "asleep" : D.idle >= 60 ? "dozing" : "awake"; }
  let lastCat = "awake";
  function drawCat(reg) {
    const id = reg("cat");
    const st = catState();
    if (lastCat === "asleep" && st !== "asleep") catHop = 1; // waking up: little hop
    lastCat = st;
    const [ax0, ay0] = iso(8, 10.2, 0);
    const hop = catHop > 0 ? Math.round(Math.sin(catHop * Math.PI) * 4) : 0;
    const ax = Math.round(ax0), ay = Math.round(ay0) - hop;
    if (st === "asleep" && !catHop) {
      const br = reduce ? 0 : Math.sin(T * 1.6) * 0.35;
      oval(ax + 1, ay - 3.5, 7, 3.4 + br, P.fur, id);
      oval(ax + 3, ay - 5, 2.6, 1.6, P.patch, id);
      oval(ax - 4, ay - 4.6, 4, 3.4, P.fur, id);
      oval(ax - 2.2, ay - 6.5, 1.6, 1.1, P.patch, id);
      fillPoly([[ax - 7.5, ay - 6], [ax - 7, ay - 9.5], [ax - 5, ay - 7.5]], P.fur, id);
      fillPoly([[ax - 3.5, ay - 7.5], [ax - 2, ay - 10], [ax - 1, ay - 7]], P.patch, id);
      put(ax - 6, ay - 4, P.ink, id); put(ax - 5, ay - 4, P.ink, id); put(ax - 3, ay - 4, P.ink, id); put(ax - 2, ay - 4, P.ink, id);
      put(ax - 4, ay - 3, P.pink, id);
      for (let i = 0; i <= 10; i++) { const t = i / 10; put(ax + 7 - t * 11, ay - 0.6 + Math.sin(t * Math.PI) * 0.8, t > 0.75 ? P.patch : P.fur2, id); put(ax + 7 - t * 11, ay - 1.4 + Math.sin(t * Math.PI) * 0.8, t > 0.75 ? P.patch : P.fur, id); }
      if (!reduce && Math.random() < 0.012) zs.push({ x: ax - 4, y: ay - 11, life: 1 });
    } else {
      const swish = reduce ? 0 : Math.sin(T * (st === "awake" ? 3 : 1.2)) * (st === "awake" ? 2 : 1);
      for (let i = 0; i <= 12; i++) { const t = i / 12; const x = ax + 4 + t * 5 + Math.sin(t * 2) * swish * t, y = ay - 1 - t * t * 8; put(x, y, t > 0.8 ? P.patch : P.fur, id); put(x + 1, y, t > 0.8 ? P.patch : P.fur2, id); }
      oval(ax, ay - 5, 5, 5, P.fur, id);
      oval(ax, ay - 3.8, 2.4, 3.3, P.belly, id);
      oval(ax - 3, ay - 6.5, 1.8, 2.4, P.patch, id);
      oval(ax - 2, ay - 0.5, 1.6, 1, P.fur2, id); oval(ax + 2, ay - 0.5, 1.6, 1, P.fur2, id);
      oval(ax, ay - 12, 5, 4, P.fur, id);
      oval(ax + 3, ay - 13.6, 2, 1.5, P.patch, id);
      fillPoly([[ax - 5.2, ay - 13.5], [ax - 4.6, ay - 18.5], [ax - 1.4, ay - 15.2]], P.fur, id);
      fillPoly([[ax + 1.4, ay - 15.2], [ax + 4.6, ay - 18.5], [ax + 5.2, ay - 13.5]], P.patch, id);
      put(ax - 4, ay - 16, P.pink, id); put(ax + 4, ay - 16, P.pink, id);
      const t = T % 100;
      if (t > blinkAt + 0.15) blinkAt = t + 2 + Math.random() * 4;
      const blink = t > blinkAt && t < blinkAt + 0.15;
      const look = st === "awake" ? Math.round(Math.sin(T * 0.4) * 1.2) : 0;
      if (st === "dozing" || blink) { put(ax - 3 + look, ay - 12, P.ink, id); put(ax - 2 + look, ay - 12, P.ink, id); put(ax + 2 + look, ay - 12, P.ink, id); put(ax + 3 + look, ay - 12, P.ink, id); }
      else { put(ax - 2 + look, ay - 13, P.ink, id); put(ax - 2 + look, ay - 12, P.ink, id); put(ax + 2 + look, ay - 13, P.ink, id); put(ax + 2 + look, ay - 12, P.ink, id); }
      put(ax, ay - 10.5, P.pink, id);
    }
    if (catHop > 0) catHop = Math.max(0, catHop - 0.06);
  }

  function drawPapers(reg) {
    const id = reg("papers");
    if (!D.dl.ok) { // can't see Downloads: a sealed box
      box(11, 6.5, 0, 2.6, 2.2, 2.4, hx("#e9cfae"), hx("#d8b78f"), hx("#c7a47b"), id);
      return;
    }
    const n = D.dl.count, sheets = n === 0 ? 0 : Math.min(16, Math.ceil(Math.log2(n + 1) * 2.2));
    for (let i = 0; i < sheets; i++) {
      const jx = (hash(i, 1) - 0.5) * 0.5, jy = (hash(i, 2) - 0.5) * 0.5;
      box(11 + jx, 6.6 + jy, i * 0.75, 2.5, 2, 0.5, i % 3 ? P.paper : P.paper2, P.paper2, P.paper3, id);
    }
    if (n > 150) for (let i = 0; i < 4; i++) { // spilling onto the floor
      const x = 9.5 + hash(i, 7) * 5, y = 9 + hash(i, 8) * 3;
      fillPoly(quad([x, y, 0.05], [x + 2, y + 0.3, 0.05], [x + 1.8, y + 1.9, 0.05], [x - 0.2, y + 1.6, 0.05]), P.paper, id);
    }
    if (n === 0 && Math.sin(T * 3) > 0.3) { const [sx, sy] = iso(12, 7.5, 3); put(sx, sy, hx("#ffd27a"), id); put(sx - 1, sy, hx("#ffe9a8"), id); put(sx + 1, sy, hx("#ffe9a8"), id); put(sx, sy - 1, hx("#ffe9a8"), id); put(sx, sy + 1, hx("#ffe9a8"), id); }
  }

  /* ================= outline + light, then to screen ================= */
  let glows = [];
  function compose(sky) {
    const out = img.data, inkR = 0x4a, inkG = 0x3b, inkB = 0x5c;
    const hov = hover ? idNames[hover] : null;
    const nr = 0.42 + 0.58 * sky.day, ng = 0.44 + 0.56 * sky.day, nb = 0.66 + 0.34 * sky.day;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, c = col[i], a = ids[i];
      // outline: this pixel is "behind" a neighbour drawn later (or empty next to anything)
      let edge = 0, edgeId = 0;
      const nb4 = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb4) { if (j < 0) continue; const b = ids[j]; if (col[j] && (c === 0 || b > a) && !(idNames[b] === idNames[a])) { edge = 1; edgeId = b; break; } }
      const o = i * 4;
      if (edge) {
        const hl = hov && idNames[edgeId] === hov && hov !== "wallL" && hov !== "wallR" && hov !== "floor" && hov !== "rug";
        const lit = hl ? 1 : nr * 0.9 + 0.1;
        out[o] = hl ? 0xff : inkR * lit; out[o + 1] = hl ? 0xf1 : inkG * lit; out[o + 2] = hl ? 0xa8 : inkB * (hl ? 1 : (nb * 0.9 + 0.1)); out[o + 3] = 255;
        continue;
      }
      if (!c) { out[o + 3] = 0; continue; }
      let r = (c >> 16) & 255, gg = (c >> 8) & 255, b = c & 255;
      if (!emissive.has(a)) {
        r *= nr; gg *= ng; b *= nb;
        if (beam[i]) { const k = 0.16 * sky.day; r += 255 * k; gg += 240 * k; b += 205 * k; }
        for (const [gx, gy, R, gc, s] of glows) {
          const d = Math.hypot(x - gx, (y - gy) * 1.3); if (d >= R) continue;
          const k = s * (1 - d / R) ** 2; r += ((gc >> 16) & 255) * k; gg += ((gc >> 8) & 255) * k; b += (gc & 255) * k;
        }
      }
      out[o] = r > 255 ? 255 : r; out[o + 1] = gg > 255 ? 255 : gg; out[o + 2] = b > 255 ? 255 : b; out[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // floating extras (no outline): Zs and hearts
    for (const z of zs) { z.y -= 0.12; z.x += 0.05; z.life -= 0.006; if (z.life > 0) { g.fillStyle = "#8a7bd6"; for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]]) g.fillRect(Math.round(z.x) + dx, Math.round(z.y) + dy, 1, 1); } }
    zs = zs.filter((z) => z.life > 0);
    for (const h of hearts) { h.y -= 0.3; h.life -= 0.015; if (h.life > 0) { g.fillStyle = h.life > 0.3 ? "#ff5fa2" : "#ffb3d1"; for (const [dx, dy] of [[0, 0], [1, 0], [3, 0], [4, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [2, 3]]) g.fillRect(Math.round(h.x) + dx, Math.round(h.y) + dy, 1, 1); } }
    hearts = hearts.filter((h) => h.life > 0);
  }

  function frame() {
    T += 1 / 12;
    cpuSmooth += (D.cpu - cpuSmooth) * 0.08;
    const sky = skyState();
    glows = [];
    // the window shader needs sky + T; bind it here
    winFn = (sx, sy) => {
      const x = (sx - OX) / 4, z = OY + 2 * x - sy;
      const u = (x - 3) / 5.5, v = (48 - z) / 22.5;
      if (u < 0.07 || u > 0.93 || v < 0.06 || v > 0.94 || Math.abs(u - 0.5) < 0.045 || Math.abs(v - 0.52) < 0.03) return { c: v > 0.9 ? P.frame2 : P.frame, f: true };
      const [top, bot] = SKY[sky.phase];
      let c = mix(top, bot, v);
      const px = u * 22, py = v * 22, nightK = 1 - sky.day;
      if (sky.day > 0.02) {
        const st = Math.max(0, Math.min(1, sky.sunT)), sunX = 0.14 + 0.72 * st, sunY = 0.86 - Math.sin(Math.PI * st) * 0.62;
        const d = Math.hypot(px - sunX * 22, py - sunY * 22);
        if (d < 2.6) c = sky.golden ? hx("#ffd27a") : hx("#fff3a8"); else if (d < 3.6) c = mix(c, hx("#fff3c4"), 0.55);
        const cl = ((u * 1.6 - T * 0.004) % 1 + 1) % 1;
        if (v > 0.2 && v < 0.3 && cl > 0.2 && cl < 0.48) c = mix(c, P.frame, 0.8 * sky.day);
        if (v > 0.28 && v < 0.34 && cl > 0.26 && cl < 0.42) c = mix(c, P.frame, 0.8 * sky.day);
      }
      if (nightK > 0.35) {
        const sxp = Math.floor(px), syp = Math.floor(py);
        if (hash(sxp, syp) > 0.95 && v < 0.85) c = mix(c, hx("#ffffff"), (0.55 + 0.45 * Math.sin(T * 2 + sxp * 7 + syp)) * nightK);
        const span = ((sky.rise - sky.set) + 1440) % 1440 || 1, mt = (((sky.m - sky.set) + 1440) % 1440) / span;
        const mx = (0.16 + 0.68 * mt) * 22, my = (0.78 - Math.sin(Math.PI * Math.max(0, Math.min(1, mt))) * 0.5) * 22;
        if (Math.hypot(px - mx, py - my) < 2.7 && Math.hypot(px - mx - 1.4, py - my + 0.6) > 2.2) c = hx("#fff6d6");
      }
      return { c, f: false };
    };
    drawRoom(sky);
    compose(sky);
    clock(sky);
  }

  /* ================= clock pill ================= */
  function fmtTime(min) { min = ((Math.round(min) % 1440) + 1440) % 1440; const h = Math.floor(min / 60), m = min % 60; return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; }
  let lastClock = "";
  function clock(sky) {
    const d = now(), s = fmtTime(d.getHours() * 60 + d.getMinutes());
    const k = s + sky.phase; if (k === lastClock) return; lastClock = k;
    const el = $("clock"); el.textContent = s; const sm = document.createElement("small"); sm.textContent = sky.phase; el.appendChild(sm);
  }

  /* ================= hover + info cards ================= */
  const NAMES = { window: "Window · the real sky", lamp: "Desk lamp · battery", plant: "Fern · CPU", shelf: "Bookshelf · disk space", papers: "Paper pile · Downloads", cat: "Mochi · are you here?", calendar: "Calendar · today", laptop: "Laptop · how busy" };
  const card = { open: null };
  const gb = (b) => b >= 1e12 ? (b / 1e12).toFixed(1) + " TB" : b >= 1e9 ? (b / 1e9).toFixed(b >= 1e10 ? 0 : 1) + " GB" : (b / 1e6).toFixed(0) + " MB";
  function dur(sec) { const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60); return d ? `${d} day${d === 1 ? "" : "s"} ${h} hr` : h ? `${h} hr ${m} min` : `${m} min`; }
  function info(name) {
    const sky = skyState();
    switch (name) {
      case "plant": { const p = Math.round(D.cpu * 100); return { t: "Fern · CPU", big: `${p}%`, sub: p < 25 ? "Your Mac is calm, so the fern is happy." : p < 60 ? "Working away. The fern is leaning a little." : p < 85 ? "Busy! The fern is drooping." : "Working really hard. The fern is wilting.", spark: true, warn: p >= 85 }; }
      case "lamp": { const b = D.battery; if (!b) return { t: "Desk lamp · battery", big: "Plugged in", sub: "No battery info on this Mac." };
        const p = Math.round(b.level * 100), left = !b.charging && isFinite(b.dischargingTime) && b.dischargingTime > 0 ? ` · about ${dur(b.dischargingTime)} left` : "";
        return { t: "Desk lamp · battery", big: `${p}%`, sub: (b.charging ? (p >= 100 ? "Fully charged and plugged in." : "Charging.") : p < 20 ? "Low battery, so the lamp is flickering. Plug in soon." : "On battery") + left, warn: !b.charging && p < 20 }; }
      case "shelf": { const used = D.disk.total - D.disk.free, p = Math.round(used / D.disk.total * 100);
        return { t: "Bookshelf · disk space", big: `${p}% full`, sub: `${gb(D.disk.free)} free of ${gb(D.disk.total)}.` + (p >= 92 ? " The shelf is overflowing. Your Mac needs some room to breathe." : p >= 80 ? " Getting full." : " Plenty of room."), warn: p >= 92, act: p >= 80 ? ["Open Storage settings", "storage"] : null }; }
      case "papers": { const dl = D.dl; if (!dl.ok) return { t: "Paper pile · Downloads", big: "Locked", sub: "Tiny Room can't see your Downloads folder. Allow it in System Settings → Privacy & Security → Files and Folders.", act: ["Open Privacy settings", "privacy"] };
        return { t: "Paper pile · Downloads", big: `${dl.count} item${dl.count === 1 ? "" : "s"}`, sub: dl.count === 0 ? "Spotless! Nothing in Downloads." : `${gb(dl.bytes)} in files · ${dl.week} new this week.` + (dl.count > 80 ? " Time for a tidy?" : ""), act: ["Open Downloads", "downloads"] }; }
      case "cat": { const st = catState(), m = Math.floor(D.idle / 60);
        return { t: "Mochi · are you here?", big: st === "awake" ? "Awake" : st === "dozing" ? "Dozing" : "Asleep", sub: st === "awake" ? "You're at your Mac, so Mochi's watching you work." : `No typing or mouse for ${m} min${m === 1 ? "" : "s"}. Mochi ${st === "dozing" ? "is getting sleepy" : "fell asleep"}.` }; }
      case "calendar": { const d = now(), days = D.uptime / 86400;
        return { t: "Calendar · today", big: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }), sub: `Your Mac has been on for ${dur(D.uptime)} since its last restart.` + (days > 14 ? " A restart every couple of weeks keeps it snappy." : "") }; }
      case "window": return { t: "Window · the real sky", big: fmtTime(sky.m), sub: `Sunrise ${fmtTime(sky.rise)} · sunset ${fmtTime(sky.set)}. ${sky.phase === "night" ? "It's night, so the fairy lights are on." : sky.phase === "day" ? "Sunlight is coming in." : sky.phase === "dawn" ? "The sun's coming up." : "The sun's going down."}` };
      case "laptop": { const p = Math.round(D.cpu * 100); return { t: "Laptop · how busy", big: `${D.cores} cores`, sub: `Running at ${p}% overall. The screen scrolls faster the busier your Mac is.`, spark: true }; }
    }
    return null;
  }
  function showCard(name) {
    const inf = info(name); if (!inf) return;
    card.open = name;
    const el = $("card"); el.hidden = false; el.classList.toggle("warn", !!inf.warn);
    $("cTitle").textContent = inf.t; $("cBig").textContent = inf.big; $("cSub").textContent = inf.sub;
    const sp = $("spark"); sp.hidden = !inf.spark; if (inf.spark) drawSpark(sp);
    const a = $("cAct"); a.hidden = !inf.act; if (inf.act) { a.textContent = inf.act[0]; a.dataset.kind = inf.act[1]; }
  }
  function hideCard() { card.open = null; $("card").hidden = true; }
  function drawSpark(c) {
    const x = c.getContext("2d"); x.clearRect(0, 0, c.width, c.height);
    const hst = D.cpuHist.length ? D.cpuHist : [D.cpu];
    x.fillStyle = "#efe6f2"; x.fillRect(0, 0, c.width, c.height);
    hst.forEach((v, i) => { const h = Math.max(1, Math.round(v * (c.height - 2))); x.fillStyle = v > 0.85 ? "#e0566f" : v > 0.5 ? "#ffb26b" : "#7fcf8f"; x.fillRect(c.width - (hst.length - i) * 1.33, c.height - h, 1, h); });
  }
  $("cardX").addEventListener("click", hideCard);
  $("cAct").addEventListener("click", (e) => { if (bridge) bridge.open(e.currentTarget.dataset.kind); });

  /* ================= mouse: hover, click, drag ================= */
  const tip = $("tip");
  function pick(e) {
    const r = cv.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * W), y = Math.floor((e.clientY - r.top) / r.height * H);
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    const id = ids[y * W + x]; return NAMES[idNames[id]] ? id : 0;
  }
  let down = null;
  cv.addEventListener("pointermove", (e) => {
    if (down) {
      if (!down.moved && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 3) { down.moved = true; cv.classList.add("grab"); tip.hidden = true; }
      if (down.moved && bridge) bridge.drag();
      return;
    }
    const id = pick(e); hover = id;
    cv.classList.toggle("point", !!id);
    if (id) { tip.hidden = false; tip.textContent = NAMES[idNames[id]]; const st = $("stage").getBoundingClientRect(); tip.style.left = (e.clientX - st.left) + "px"; tip.style.top = (e.clientY - st.top - 10) + "px"; }
    else tip.hidden = true;
  });
  cv.addEventListener("pointerleave", () => { if (!down) { hover = 0; tip.hidden = true; } });
  cv.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; down = { x: e.screenX, y: e.screenY, moved: false, id: pick(e) }; cv.setPointerCapture(e.pointerId); if (bridge) bridge.dragStart(); });
  cv.addEventListener("pointerup", () => {
    if (!down) return; const d = down; down = null; cv.classList.remove("grab");
    if (bridge) bridge.dragEnd(d.moved);
    if (d.moved) return;
    const name = d.id ? idNames[d.id] : null;
    if (!name) { hideCard(); return; }
    if (name === "cat") { catHop = catHop || 1; const [cx, cy] = iso(8, 10.2, 0); for (let i = 0; i < 3; i++) hearts.push({ x: cx - 2 + Math.random() * 4, y: cy - 22, life: 1 }); }
    tip.hidden = true;
    if (card.open === name) hideCard(); else showCard(name);
  });
  document.addEventListener("contextmenu", (e) => { e.preventDefault(); if (bridge) bridge.menu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideCard(); });
  if (bridge) bridge.onScale((s) => document.documentElement.style.setProperty("--scale", s));

  /* ================= run ================= */
  let timer = setInterval(frame, 1000 / 12);
  document.addEventListener("visibilitychange", () => { clearInterval(timer); timer = setInterval(frame, document.hidden ? 1000 : 1000 / 12); });
  frame();
  if (bridge) bridge.ready();

  // hooks for automated screenshots only
  window.tinyRoom = {
    set(o) { if (o.time) timeOverride = o.time; if (o.cpu != null) { D.cpu = o.cpu; cpuSmooth = o.cpu; D.cpuHist = Array.from({ length: 90 }, (_, i) => Math.max(0, Math.min(1, o.cpu + Math.sin(i / 5) * 0.12))); } if (o.disk) D.disk = o.disk; if (o.dl) D.dl = o.dl; if (o.idle != null) D.idle = o.idle; if (o.battery !== undefined) D.battery = o.battery; if (o.uptime) D.uptime = o.uptime; frame(); },
    show: showCard, frame,
  };
})();
