// ── Vanities globe: D3 orthographic projection on canvas ─────────────────────
// Hexes, terrain, factions and pins live in (col,row) space and are mapped onto
// longitude/latitude so the planet can be freely rotated to reveal its far side.

const TERRAIN_FILL = {
  ocean:      null,            // null → let the sphere ocean gradient show through
  polar:      '#cdd9e2',
  grassland:  '#3d5a28',
  forest:     '#26401c',
  desert:     '#9a7d3e',
  mountain:   '#6a6052',
  industrial: '#3a3640',
  urban:      '#4a3a52',
  coastal:    '#356a78',
};

const FACTION_TINT = {
  'northreach-confederacy': 'rgba(90,170,55,0.30)',
  'veltora-federation':     'rgba(150,80,210,0.30)',
  'smogspire-union':        'rgba(120,110,150,0.30)',
  'duneward-coalition':     'rgba(210,160,60,0.30)',
  'greenvale-republic':     'rgba(80,180,60,0.30)',
  'farreach-league':        'rgba(60,160,80,0.30)',
  'stoneview-commonwealth': 'rgba(150,160,170,0.30)',
  'brightmarch-union':      'rgba(220,90,70,0.30)',
  'rustcoast-confederacy':  'rgba(200,110,40,0.30)',
  'lakeside-union':         'rgba(60,150,190,0.30)',
  'southpoint-league':      'rgba(60,180,150,0.30)',
};

// A few rivers, each a list of [lng,lat] waypoints winding across the continents.
const RIVERS = [
  [[-120, 55], [-110, 40], [-95, 28], [-88, 12], [-92, -4]],
  [[-30, 48], [-18, 34], [-10, 18], [-14, 2], [-6, -14]],
  [[60, 40], [72, 26], [80, 10], [76, -8], [84, -22]],
  [[10, -30], [22, -42], [34, -54], [30, -66]],
];

export async function initGlobe(container, config) {
  const zones = await fetch('data/territories.json').then(r => r.json());
  const COLS = config.hex.columns;
  const ROWS = config.hex.rows;
  const dLng = 360 / COLS;
  const dLat = 180 / ROWS;

  // ── Hex ↔ geo mapping ──────────────────────────────────────────────────────
  function hexCenter(col, row) {
    const lng = -180 + (col + 0.5 * (row % 2) + 0.5) * dLng;
    let lat = 90 - (row + 0.5) * dLat;
    lat = Math.max(-89.9, Math.min(89.9, lat));
    return [lng, lat];
  }

  function hexPolygon(col, row) {
    const [clng, clat] = hexCenter(col, row);
    const Sx = dLng / Math.sqrt(3);
    const Sy = dLat / 1.5;
    const ring = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      let lat = clat + Sy * Math.sin(a);
      lat = Math.max(-90, Math.min(90, lat));
      ring.push([clng + Sx * Math.cos(a), lat]);
    }
    ring.push(ring[0]);
    return ring;
  }

  // ── Territory lookup ────────────────────────────────────────────────────────
  const lookup = new Map();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let entry = { terrain: 'ocean', faction: null };
      for (const z of zones) {
        if (row >= z.rMin && row <= z.rMax && col >= z.cMin && col <= z.cMax) {
          entry = { terrain: z.terrain, faction: z.faction || null };
        }
      }
      lookup.set(`${col},${row}`, entry);
    }
  }

  // Pre-group hex rings by fill colour and by faction tint (built once).
  const fillGroups = new Map();   // colour → [ring,…]
  const tintGroups = new Map();   // colour → [ring,…]
  const allRings = [];            // every hex ring (for the grid outline)
  const mountains = [];           // [lng,lat] centres
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const data = lookup.get(`${col},${row}`);
      const fill = TERRAIN_FILL[data.terrain];
      const ring = hexPolygon(col, row);
      allRings.push(ring);
      if (fill) {
        if (!fillGroups.has(fill)) fillGroups.set(fill, []);
        fillGroups.get(fill).push(ring);
      }
      if (data.faction) {
        const t = FACTION_TINT[data.faction] || 'rgba(255,255,255,0.12)';
        if (!tintGroups.has(t)) tintGroups.set(t, []);
        tintGroups.get(t).push(ring);
      }
      if (data.terrain === 'mountain') mountains.push(hexCenter(col, row));
    }
  }

  // Faction border edges: for each hex, compare with its right & lower neighbours.
  function neighbourKey(col, row, dir) {
    const even = row % 2 === 0;
    const D = even
      ? { right: [1, 0], dl: [-1, 1], dr: [0, 1] }
      : { right: [1, 0], dl: [0, 1], dr: [1, 1] };
    const [dc, dr] = D[dir];
    return [col + dc, row + dr];
  }
  const borderEdges = []; // [[lng,lat],[lng,lat]]
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const me = lookup.get(`${col},${row}`).faction;
      const ring = hexPolygon(col, row); // verts 0..5 (closed at 6)
      // edge index between this hex and each neighbour direction (pointy-top)
      const edgeFor = { right: [0, 1], dl: [3, 4], dr: [5, 0] };
      for (const dir of ['right', 'dl', 'dr']) {
        const [nc, nr] = neighbourKey(col, row, dir);
        const nd = lookup.get(`${nc},${nr}`);
        const nf = nd ? nd.faction : null;
        if (me !== nf && (me || nf)) {
          const [i0, i1] = edgeFor[dir];
          borderEdges.push([ring[i0], ring[i1]]);
        }
      }
    }
  }

  // ── Canvas + projection setup ───────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.id = 'globe-canvas';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const projection = d3.geoOrthographic().clipAngle(90).rotate([0, -10]);
  const path = d3.geoPath(projection, ctx);
  const graticule = d3.geoGraticule10();
  const sphere = { type: 'Sphere' };
  const northCap = d3.geoCircle().center([0, 90]).radius(7)();
  const southCap = d3.geoCircle().center([0, -90]).radius(7)();

  let scaleFactor = 0.46; // fraction of min(viewport) used for globe radius
  let width, height, radius;

  function resize() {
    const rect = container.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    radius = Math.min(width, height) * scaleFactor;
    projection.scale(radius).translate([width / 2, height / 2]);
    render();
  }

  function visible(point) {
    const r = projection.rotate();
    return d3.geoDistance(point, [-r[0], -r[1]]) < Math.PI / 2 - 0.01;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  let showTint = true;
  let pins = [];

  function render() {
    ctx.clearRect(0, 0, width, height);
    const cx = width / 2, cy = height / 2;

    // Space backdrop is the page background; draw atmosphere glow behind globe.
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.9, cx, cy, radius * 1.12);
    glow.addColorStop(0, 'rgba(60,130,200,0.0)');
    glow.addColorStop(0.6, 'rgba(56,128,192,0.18)');
    glow.addColorStop(1, 'rgba(40,96,160,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.12, 0, 2 * Math.PI);
    ctx.fill();

    // Ocean sphere (lit gradient: highlight upper-left, deep at the limb).
    const og = ctx.createRadialGradient(
      cx - radius * 0.35, cy - radius * 0.4, radius * 0.1,
      cx, cy, radius);
    og.addColorStop(0, '#2f6fa6');
    og.addColorStop(0.55, '#16467a');
    og.addColorStop(1, '#0a1f3a');
    ctx.beginPath(); path(sphere); ctx.fillStyle = og; ctx.fill();

    // Clip everything else to the sphere.
    ctx.save();
    ctx.beginPath(); path(sphere); ctx.clip();

    // Terrain hex fills, batched by colour.
    for (const [colour, rings] of fillGroups) {
      ctx.beginPath();
      for (const ring of rings) path({ type: 'Polygon', coordinates: [ring] });
      ctx.fillStyle = colour;
      ctx.fill();
    }

    // Faction tints.
    if (showTint) {
      for (const [colour, rings] of tintGroups) {
        ctx.beginPath();
        for (const ring of rings) path({ type: 'Polygon', coordinates: [ring] });
        ctx.fillStyle = colour;
        ctx.fill();
      }
    }

    // Hex grid outline (subtle — keeps the hex character on the sphere).
    ctx.beginPath();
    for (const ring of allRings) path({ type: 'Polygon', coordinates: [ring] });
    ctx.strokeStyle = 'rgba(10,16,26,0.35)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Rivers.
    ctx.beginPath();
    for (const r of RIVERS) path({ type: 'LineString', coordinates: r });
    ctx.strokeStyle = 'rgba(90,170,220,0.7)';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Polar ice caps (SVG-style soft white).
    for (const cap of [northCap, southCap]) {
      ctx.beginPath(); path(cap);
      ctx.fillStyle = 'rgba(230,240,248,0.88)';
      ctx.fill();
    }

    // Mountain carets.
    ctx.strokeStyle = 'rgba(225,220,210,0.85)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (const m of mountains) {
      if (!visible(m)) continue;
      const p = projection(m);
      if (!p) continue;
      const s = Math.max(2.2, radius * 0.012);
      ctx.moveTo(p[0] - s, p[1] + s * 0.6);
      ctx.lineTo(p[0], p[1] - s * 0.8);
      ctx.lineTo(p[0] + s, p[1] + s * 0.6);
    }
    ctx.stroke();

    // Faction borders (dashed gold).
    ctx.beginPath();
    for (const [a, b] of borderEdges) {
      path({ type: 'LineString', coordinates: [a, b] });
    }
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(201,168,76,0.85)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.setLineDash([]);

    // Faint graticule.
    ctx.beginPath(); path(graticule);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Limb darkening for a rounded, lit-sphere feel.
    const limb = ctx.createRadialGradient(
      cx - radius * 0.3, cy - radius * 0.35, radius * 0.2,
      cx, cy, radius);
    limb.addColorStop(0, 'rgba(255,255,255,0.06)');
    limb.addColorStop(0.7, 'rgba(0,0,0,0)');
    limb.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.beginPath(); path(sphere); ctx.fillStyle = limb; ctx.fill();

    ctx.restore();

    // Atmosphere rim.
    ctx.beginPath(); path(sphere);
    ctx.strokeStyle = 'rgba(80,150,220,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    updatePins();
  }

  // ── Pins (DOM layer) ─────────────────────────────────────────────────────────
  const pinLayer = document.createElement('div');
  pinLayer.id = 'pin-layer';
  container.appendChild(pinLayer);

  const TYPE_COLORS = { location: '#4a9eff', faction: '#e8a030', character: '#50c878' };

  function setPins(pinData, onClick) {
    pinLayer.innerHTML = '';
    pins = pinData.map(pin => {
      const col = parseInt(pin.hexAddress.slice(0, 2), 10);
      const row = parseInt(pin.hexAddress.slice(2, 4), 10);
      const ll = hexCenter(col, row);
      const el = document.createElement('div');
      el.className = `pin pin-${pin.type}`;
      const colour = TYPE_COLORS[pin.type] || '#fff';
      el.innerHTML =
        `<div class="pin-dot" style="background:${colour};color:${colour}"></div>` +
        `<div class="pin-label">${pin.label}</div>`;
      el.addEventListener('click', e => { e.stopPropagation(); onClick(pin); });
      pinLayer.appendChild(el);
      return { el, ll };
    });
    updatePins();
  }

  function updatePins() {
    for (const { el, ll } of pins) {
      if (!visible(ll)) { el.style.display = 'none'; continue; }
      const p = projection(ll);
      if (!p) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = p[0] + 'px';
      el.style.top = p[1] + 'px';
    }
  }

  // ── Interaction: drag to rotate, wheel to zoom, animated panTo ───────────────
  let raf = null;
  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; render(); });
  }

  const sensitivity = 0.25; // degrees per pixel, scaled by zoom
  d3.select(canvas).call(
    d3.drag().on('drag', event => {
      const r = projection.rotate();
      const k = sensitivity * (radius > 0 ? (Math.min(width, height) * 0.46) / radius : 1);
      let phi = r[1] - event.dy * k;
      phi = Math.max(-90, Math.min(90, phi));
      projection.rotate([r[0] + event.dx * k, phi]);
      scheduleRender();
    })
  );

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    scaleFactor *= e.deltaY < 0 ? 1.1 : 0.9;
    scaleFactor = Math.max(0.3, Math.min(2.4, scaleFactor));
    radius = Math.min(width, height) * scaleFactor;
    projection.scale(radius);
    scheduleRender();
  }, { passive: false });

  function panTo(lng, lat) {
    const r0 = projection.rotate();
    const r1 = [-lng, -lat];
    const iv = d3.interpolate(r0, r1);
    const t0 = performance.now();
    const dur = 700;
    (function step(now) {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      projection.rotate(iv(e));
      render();
      if (t < 1) requestAnimationFrame(step);
    })(t0);
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    toggleTint() { showTint = !showTint; render(); return showTint; },
    setPins,
    panTo,
    panToHex(address) {
      const col = parseInt(address.slice(0, 2), 10);
      const row = parseInt(address.slice(2, 4), 10);
      const [lng, lat] = hexCenter(col, row);
      panTo(lng, lat);
    },
    invalidateSize: resize,
  };
}
