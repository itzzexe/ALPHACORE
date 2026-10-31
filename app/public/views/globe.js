// The globe — the company's world, drawn on a canvas with nothing fetched.
//
// An orthographic projection of every country as one point (components/geo.js),
// so the shape of the continents comes from where countries are rather than
// from a coastline file. The sun is where it really is: the subsolar point is
// worked out from the clock, the terminator is drawn where day meets night,
// and a country on the night side glows warm the way a city does from orbit.
// The countries the record touches are lit and sized by how much it touches
// them; payments travel as arcs along the great circle from home, a comet on
// each. Live data adds the weather beside the places the company works, a
// ripple at every recent earthquake (larger and redder for a stronger one, and
// ringed when it was near a place the company works), and the point where the
// sun is overhead — where it is noon; natural events still open (a triangle
// for fire and volcano, a ring for a storm, a wave for a flood); the markets
// on the atlas shortlist, ringed; and the International Space Station moving
// along its orbit between reads. Drag to turn it; it drifts on its own
// unless motion is reduced, and it stops drawing when nobody can see it.
import { CENTROIDS, landDots } from '../components/geo.js';

const RAD = Math.PI / 180;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Where the sun is overhead right now: latitude (declination) and longitude. */
export function subsolar(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 86400000;
  const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (day + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = (12 - hours) * 15;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return [decl, lon];
}

const vec = (lat, lon) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The land as unit vectors, worked out once for every globe on the page. */
let LAND_V = null;
const landVectors = () => (LAND_V ||= landDots().map(([la, lo]) => vec(la, lo)));

/** Points along the great circle from a to b, lifted off the surface in the middle. */
function arcPoints(a, b, steps = 48) {
  const A = vec(...a); const B = vec(...b);
  const omega = Math.acos(Math.max(-1, Math.min(1, dot3(A, B))));
  const lift = 0.06 + 0.22 * (omega / Math.PI);
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let p;
    if (omega < 1e-6) p = A;
    else {
      const s = Math.sin(omega);
      const k1 = Math.sin((1 - t) * omega) / s; const k2 = Math.sin(t * omega) / s;
      p = [A[0] * k1 + B[0] * k2, A[1] * k1 + B[1] * k2, A[2] * k1 + B[2] * k2];
    }
    const h = 1 + lift * Math.sin(Math.PI * t);
    out.push([p[0] * h, p[1] * h, p[2] * h]);
  }
  return out;
}

export function mountGlobe(host, { data = null, onPick = null, onHover = null, spin = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'globe-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let W = 0; let H = 0; let R = 0; let cx = 0; let cy = 0; let dpr = 1;
  let rot = { lon: 30, lat: 18 };
  let vel = 0.035;
  let drag = null;
  let raf = 0;
  let alive = true;
  let visible = true;
  let colors = {};
  let model = { home: null, lit: new Map(), arcs: [], quakes: [], weather: {}, events: [], shortlist: new Set(), iss: null };
  let hover = null;
  let t0 = performance.now();

  function readColors() {
    const cs = getComputedStyle(host);
    const g = (k, d) => cs.getPropertyValue(k).trim() || d;
    colors = {
      ocean: g('--g-ocean', '#0b1220'), ocean2: g('--g-ocean-2', '#0f1a30'), rim: g('--g-rim', 'rgba(110,200,255,.5)'),
      grid: g('--g-grid', 'rgba(140,180,255,.08)'), dot: g('--g-dot', 'rgba(170,200,255,.35)'), lit: g('--g-lit', '#4fe3ff'),
      land: g('--g-land', 'rgba(120,170,230,.55)'), landNight: g('--g-land-night', 'rgba(70,95,140,.45)'),
      home: g('--g-home', '#ffb547'), arc: g('--g-arc', '#4fe3ff'), city: g('--g-city', '#ffcf7a'), term: g('--g-term', 'rgba(255,207,122,.35)'),
      glow: g('--g-glow', 'rgba(79,227,255,.18)'), quake: g('--g-quake', '#ff6b5a'), label: g('--g-label', 'rgba(220,235,255,.85)'),
      fire: g('--g-fire', '#ff8a3d'), storm: g('--g-storm', '#8fb8ff'), water: g('--g-water', '#4fa3ff'), shortlist: g('--g-short', '#b28bff'), iss: g('--g-iss', '#ffffff'),
      font: cs.fontFamily || 'system-ui',
    };
  }

  function setData(d) {
    const lit = new Map();
    for (const c of d?.countries || []) if (CENTROIDS[c.code]) lit.set(c.code, c);
    const home = d?.home && CENTROIDS[d.home] ? d.home : null;
    const arcs = home ? (d?.arcs || []).filter((a) => CENTROIDS[a.to] && a.to !== home)
      .map((a) => ({ ...a, pts: arcPoints(CENTROIDS[home], CENTROIDS[a.to]), phase: Math.random() })) : [];
    const first = !model.home && !model.lit.size;
    const quakes = (d?.quakes || []).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).slice(0, 60)
      .map((x) => ({ ...x, v: vec(x.lat, x.lon), phase: Math.random() }));
    const events = (d?.events || []).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).slice(0, 150).map((x) => ({ ...x, v: vec(x.lat, x.lon) }));
    const iss = (d?.iss?.track || []).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).map((x) => ({ ...x, v: vec(x.lat, x.lon) }));
    model = { home, lit, arcs, quakes, weather: d?.weather || {}, events, shortlist: new Set(d?.shortlist || []), iss: iss.length > 1 ? iss : null };
    if (first) {
      const focus = home || [...lit.keys()][0];
      if (focus) { rot.lon = CENTROIDS[focus][1]; rot.lat = Math.max(-30, Math.min(35, CENTROIDS[focus][0] * 0.7)); }
    }
  }

  function resize() {
    const r = host.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(10, r.width); H = Math.max(10, r.height);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.min(W, H) * 0.42; cx = W / 2; cy = H / 2;
    readColors();
  }

  /** Rotate a unit vector into view space: x right, y up, z towards the viewer. */
  function view(v) {
    const l = -rot.lon * RAD; const p = rot.lat * RAD;
    const x1 = v[0] * Math.cos(l) - v[1] * Math.sin(l);
    const y1 = v[0] * Math.sin(l) + v[1] * Math.cos(l);
    const z1 = v[2];
    // Now the meridian rot.lon faces +x; turn so it faces the viewer (z), then tilt.
    const vx = y1; const vy = z1; const vz = x1;
    return [vx, vy * Math.cos(p) - vz * Math.sin(p), vy * Math.sin(p) + vz * Math.cos(p)];
  }
  const screen = (v) => [cx + v[0] * R, cy - v[1] * R];

  function draw(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    const sun = vec(...subsolar());
    const sunV = view(sun);

    // Atmosphere, then the sphere lit from where the sun is in view.
    const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.35);
    halo.addColorStop(0, colors.glow); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, 6.2832); ctx.fill();
    const lx = cx + sunV[0] * R * 0.55; const ly = cy - sunV[1] * R * 0.55;
    const body = ctx.createRadialGradient(lx, ly, R * 0.1, cx, cy, R * 1.05);
    body.addColorStop(0, colors.ocean2); body.addColorStop(1, colors.ocean);
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = colors.rim; ctx.lineWidth = 1.2; ctx.stroke();

    // Graticule: every thirty degrees, front half only.
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
    const line = (pts) => {
      ctx.beginPath(); let on = false;
      for (const p of pts) {
        const v = view(p);
        if (v[2] < 0) { on = false; continue; }
        const [x, y] = screen(v);
        if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    for (let lon = -180; lon < 180; lon += 30) line(Array.from({ length: 61 }, (_, i) => vec(-90 + i * 3, lon)));
    for (let lat = -60; lat <= 60; lat += 30) line(Array.from({ length: 121 }, (_, i) => vec(lat, -180 + i * 3)));

    // The terminator: where the sun is exactly on the horizon.
    const ax = Math.abs(sun[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = [sun[1] * ax[2] - sun[2] * ax[1], sun[2] * ax[0] - sun[0] * ax[2], sun[0] * ax[1] - sun[1] * ax[0]];
    const ul = Math.hypot(...u); const U = u.map((x) => x / ul);
    const Wv = [sun[1] * U[2] - sun[2] * U[1], sun[2] * U[0] - sun[0] * U[2], sun[0] * U[1] - sun[1] * U[0]];
    ctx.save(); ctx.setLineDash([3, 5]); ctx.strokeStyle = colors.term; ctx.lineWidth = 1.2;
    line(Array.from({ length: 121 }, (_, i) => { const a = (i / 120) * 6.2832; return [U[0] * Math.cos(a) + Wv[0] * Math.sin(a), U[1] * Math.cos(a) + Wv[1] * Math.sin(a), U[2] * Math.cos(a) + Wv[2] * Math.sin(a)]; }));
    ctx.restore();

    // The continents: a field of dots, lit by the sun and dim on the night side.
    // One path per shade, so three thousand points are two fills, not three thousand.
    const day = new Path2D(); const dusk = new Path2D();
    for (const v3 of landVectors()) {
      const v = view(v3);
      if (v[2] < 0.04) continue;
      const [x, y] = screen(v);
      const r = 0.55 + 0.75 * v[2];
      (dot3(v3, sun) > 0 ? day : dusk).rect(x - r, y - r, r * 2, r * 2);
    }
    ctx.fillStyle = colors.land; ctx.fill(day);
    ctx.fillStyle = colors.landNight; ctx.fill(dusk);

    // Where the sun is overhead: noon, there.
    if (sunV[2] > 0.05) {
      const [sx, sy] = screen(sunV);
      ctx.globalAlpha = Math.min(1, sunV[2] * 2) * 0.9; ctx.strokeStyle = colors.city; ctx.fillStyle = colors.city; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(sx, sy, 3.2, 0, 6.2832); ctx.fill();
      for (let k = 0; k < 8; k++) { const a = k * 0.7854 + (reduced() ? 0 : t * 0.15); ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * 6, sy + Math.sin(a) * 6); ctx.lineTo(sx + Math.cos(a) * 9, sy + Math.sin(a) * 9); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }

    // Natural events: a shape for the kind, so a fire and a storm are told apart without a legend.
    for (const ev of model.events) {
      const v = view(ev.v);
      if (v[2] < 0.05) continue;
      const [x, y] = screen(v);
      const k = ev.category;
      ctx.globalAlpha = Math.min(1, v[2] * 1.6) * (ev.near ? 1 : 0.75);
      ctx.lineWidth = 1.3;
      if (k === 'wildfires' || k === 'volcanoes') {
        ctx.fillStyle = k === 'volcanoes' ? colors.quake : colors.fire;
        ctx.beginPath(); ctx.moveTo(x, y - 4.2); ctx.lineTo(x + 3.8, y + 2.8); ctx.lineTo(x - 3.8, y + 2.8); ctx.closePath(); ctx.fill();
      } else if (k === 'severeStorms') {
        ctx.strokeStyle = colors.storm; ctx.beginPath(); ctx.arc(x, y, 4, 0.4, 5.6); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, 1.4, 0, 6.2832); ctx.fillStyle = colors.storm; ctx.fill();
      } else if (k === 'floods' || k === 'seaLakeIce' || k === 'waterColor') {
        ctx.strokeStyle = colors.water; ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.quadraticCurveTo(x - 2, y - 3, x, y); ctx.quadraticCurveTo(x + 2, y + 3, x + 4, y); ctx.stroke();
      } else {
        ctx.fillStyle = colors.storm; ctx.fillRect(x - 2, y - 2, 4, 4);
      }
      if (ev.near) { ctx.strokeStyle = colors.quake; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(x, y, 8, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]); }
    }
    ctx.globalAlpha = 1;

    // Earthquakes this week: a ripple sized by magnitude, a ring when one was near a place the company works.
    for (const qk of model.quakes) {
      const v = view(qk.v);
      if (v[2] < 0.03) continue;
      const [x, y] = screen(v);
      const s = 1.6 + Math.max(0, qk.mag - 4.5) * 1.8;
      const edge = Math.min(1, v[2] * 1.8);
      ctx.fillStyle = colors.quake; ctx.strokeStyle = colors.quake;
      ctx.globalAlpha = 0.85 * edge; ctx.beginPath(); ctx.arc(x, y, s, 0, 6.2832); ctx.fill();
      for (let k = 0; k < 2; k++) {
        const ring = reduced() ? 0.45 + k * 0.3 : (t * 0.45 + k * 0.5 + qk.phase) % 1;
        ctx.globalAlpha = (1 - ring) * 0.6 * edge; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, s + ring * (8 + qk.mag * 2.4), 0, 6.2832); ctx.stroke();
      }
      if (qk.near) { ctx.globalAlpha = edge; ctx.lineWidth = 1.4; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(x, y, s + 6, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]); }
    }
    ctx.globalAlpha = 1;

    // Every country a point; the night side glows warm.
    const pts = [];
    for (const [code, [lat, lon]] of Object.entries(CENTROIDS)) {
      const v3 = vec(lat, lon);
      const v = view(v3);
      if (v[2] < 0.02) continue;
      const [x, y] = screen(v);
      const night = dot3(v3, sun) < -0.05;
      const tie = model.lit.get(code);
      const edge = Math.min(1, v[2] * 1.6);
      pts.push({ code, x, y, tie, z: v[2] });
      if (tie || code === model.home) continue;
      ctx.globalAlpha = (night ? 0.9 : 0.55) * edge;
      ctx.fillStyle = night ? colors.city : colors.dot;
      ctx.beginPath(); ctx.arc(x, y, night ? 1.9 : 1.6, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Arcs from home, and the comet on each.
    for (const a of model.arcs) {
      // A lifted point is hidden only while the sphere stands between it and the viewer.
      const proj = a.pts.map((p) => { const v = view(p); return { s: screen(v), hidden: v[2] < 0 && Math.hypot(v[0], v[1]) < 1 }; });
      ctx.strokeStyle = colors.arc; ctx.lineWidth = a.state === 'released' ? 1.6 : 1;
      ctx.globalAlpha = a.state === 'released' ? 0.75 : 0.35;
      ctx.beginPath(); let on = false;
      for (const p of proj) {
        if (p.hidden) { on = false; continue; }
        if (!on) { ctx.moveTo(...p.s); on = true; } else ctx.lineTo(...p.s);
      }
      ctx.stroke();
      if (!reduced()) {
        const k = Math.floor(((t * 0.22 + a.phase) % 1) * (proj.length - 1));
        const c = proj[k];
        if (!c.hidden) {
          ctx.globalAlpha = 1; ctx.fillStyle = colors.arc;
          ctx.beginPath(); ctx.arc(...c.s, 2.6, 0, 6.2832); ctx.fill();
          ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(...c.s, 6, 0, 6.2832); ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;

    // The atlas shortlist: markets being decided on, a dashed ring that turns slowly.
    for (const p of pts) {
      if (!model.shortlist.has(p.code) || p.code === model.home) continue;
      ctx.globalAlpha = Math.min(1, p.z * 1.8); ctx.strokeStyle = colors.shortlist; ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]); ctx.lineDashOffset = reduced() ? 0 : -t * 6;
      ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    ctx.globalAlpha = 1;

    // The countries the record touches: sized by how much, ringing.
    const max = Math.max(1, ...[...model.lit.values()].map((c) => c.total));
    for (const p of pts) {
      if (!p.tie && p.code !== model.home) continue;
      const home = p.code === model.home;
      const size = home ? 4.5 : 2.4 + 4 * Math.sqrt(p.tie.total / max);
      const col = home ? colors.home : colors.lit;
      const ring = reduced() ? 0.5 : (t * 0.6 + (p.x + p.y) * 0.001) % 1;
      ctx.globalAlpha = (1 - ring) * 0.55 * Math.min(1, p.z * 1.6);
      ctx.strokeStyle = col; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, size + ring * 14, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = Math.min(1, p.z * 1.8);
      ctx.fillStyle = col;
      if (home) { ctx.beginPath(); ctx.moveTo(p.x, p.y - size - 2); ctx.lineTo(p.x + size + 2, p.y); ctx.lineTo(p.x, p.y + size + 2); ctx.lineTo(p.x - size - 2, p.y); ctx.closePath(); ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, 6.2832); ctx.fill(); }
      if (hover === p.code) { ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, size + 5, 0, 6.2832); ctx.stroke(); }
      const w = model.weather[p.code];
      if (w && Number.isFinite(w.temp) && p.z > 0.25) {
        ctx.globalAlpha = Math.min(1, (p.z - 0.25) * 2.5); ctx.fillStyle = colors.label;
        ctx.font = `600 10.5px ${colors.font}`; ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(w.temp)}°`, p.x + size + 6, p.y);
      }
    }
    ctx.globalAlpha = 1;

    // The station: its orbit as dots above the surface, and where it is now —
    // the read gives ten points nine minutes apart; between them it moves on
    // the great circle, so it crosses the globe at its real speed.
    if (model.iss) {
      const tr = model.iss;
      const lift = (u) => [u[0] * 1.07, u[1] * 1.07, u[2] * 1.07];
      ctx.fillStyle = colors.iss;
      for (let i = 0; i < tr.length - 1; i++) {
        for (let k = 0; k < 6; k++) {
          const a = tr[i].v; const b = tr[i + 1].v; const f = k / 6;
          const m = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
          const n = Math.hypot(...m); const v = view(lift(m.map((c) => c / n)));
          if (v[2] < 0 && Math.hypot(v[0], v[1]) < 1) continue;
          ctx.globalAlpha = 0.35; const [x, y] = screen(v); ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
        }
      }
      const now = Date.now() / 1000;
      const i = tr.findIndex((p, j) => j < tr.length - 1 && now >= p.t && now < tr[j + 1].t);
      if (i >= 0) {
        const a = tr[i].v; const b = tr[i + 1].v; const f = (now - tr[i].t) / (tr[i + 1].t - tr[i].t);
        const om = Math.acos(Math.max(-1, Math.min(1, dot3(a, b))));
        const k1 = om > 1e-6 ? Math.sin((1 - f) * om) / Math.sin(om) : 1 - f; const k2 = om > 1e-6 ? Math.sin(f * om) / Math.sin(om) : f;
        const v = view(lift([a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2]));
        if (!(v[2] < 0 && Math.hypot(v[0], v[1]) < 1)) {
          const [x, y] = screen(v);
          ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(x, y, 8, 0, 6.2832); ctx.fill();
          ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, 2.8, 0, 6.2832); ctx.fill();
          ctx.fillRect(x - 7, y - 0.6, 14, 1.2);
          ctx.font = `600 10px ${colors.font}`; ctx.textBaseline = 'middle'; ctx.fillStyle = colors.label;
          ctx.fillText('ISS', x + 10, y - 8);
        }
      }
      ctx.globalAlpha = 1;
    }
    lastPts = pts;
  }
  let lastPts = [];

  function frame(now) {
    if (!alive) return;
    if (!document.body.contains(host)) { destroy(); return; }
    if (visible && !document.hidden) {
      if (!drag && spin && !reduced()) { rot.lon += vel; vel += (0.035 - vel) * 0.02; }
      draw(now);
    }
    raf = requestAnimationFrame(frame);
  }

  function nearest(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left; const y = e.clientY - r.top;
    let best = null; let bd = 14;
    for (const p of lastPts) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd && (p.tie || p.code === model.home)) { bd = d; best = p; } }
    if (!best) for (const p of lastPts) { const d = Math.hypot(p.x - x, p.y - y); if (d < Math.min(bd, 8)) { bd = d; best = p; } }
    return best;
  }
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, lon: rot.lon, lat: rot.lat, moved: 0, last: e.clientX, t: performance.now() }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      rot.lon = drag.lon - dx * (90 / R);
      rot.lat = Math.max(-70, Math.min(70, drag.lat + dy * (90 / R)));
      const nowT = performance.now();
      vel = -((e.clientX - drag.last) * (90 / R)) / Math.max(1, (nowT - drag.t) / 16);
      drag.last = e.clientX; drag.t = nowT;
      if (reduced() || !spin) draw(performance.now());
      return;
    }
    const p = nearest(e);
    const code = p ? p.code : null;
    if (code !== hover) { hover = code; canvas.style.cursor = code ? 'pointer' : 'grab'; onHover?.(code, p ? { x: p.x, y: p.y } : null); if (reduced() || !spin) draw(performance.now()); }
  });
  const up = (e) => {
    if (!drag) return;
    const click = drag.moved < 4;
    drag = null;
    if (click) { const p = nearest(e); if (p) onPick?.(p.code); }
    vel = Math.max(-1.5, Math.min(1.5, vel));
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; onHover?.(null, null); } });

  const ro = new ResizeObserver(() => { resize(); draw(performance.now()); });
  ro.observe(host);
  const io = new IntersectionObserver((entries) => { visible = entries.some((x) => x.isIntersecting); });
  io.observe(host);
  const theme = new MutationObserver(() => readColors());
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function destroy() {
    alive = false;
    cancelAnimationFrame(raf);
    ro.disconnect(); io.disconnect(); theme.disconnect();
  }

  setData(data);
  resize();
  draw(performance.now());
  raf = requestAnimationFrame(frame);
  return {
    update(d) { setData(d); },
    focus(code) { const c = CENTROIDS[code]; if (c) { rot.lon = c[1]; rot.lat = Math.max(-40, Math.min(45, c[0] * 0.8)); vel = 0; draw(performance.now()); } },
    destroy,
  };
}
