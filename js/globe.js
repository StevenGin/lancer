// ── Vandyse globe: Three.js GPU sphere with baked equirectangular texture ───
// The texture is generated once at startup; all rendering after that is GPU-driven.

// Per-faction political colours.
const FACTION_COLOR = {
  'northreach-confederacy': [140, 155, 90],
  'veltora-federation':     [90, 78, 100],
  'smogspire-union':        [130, 115, 145],
  'duneward-coalition':     [198, 165, 100],
  'greenvale-republic':     [100, 148, 75],
  'farreach-league':        [108, 132, 100],
  'stoneview-commonwealth': [145, 125, 95],
  'brightmarch-union':      [175, 105, 88],
  'rustcoast-confederacy':  [185, 120, 65],
  'lakeside-union':         [80, 148, 165],
  'southpoint-league':      [115, 158, 112],
};

const FACTION_LABEL = {
  'northreach-confederacy': 'Northreach\nConfederacy',
  'veltora-federation':     'Veltora\nFederation',
  'smogspire-union':        'Smogspire\nUnion',
  'duneward-coalition':     'The Duneward\nCoalition',
  'greenvale-republic':     'Greenvale\nRepublic',
  'farreach-league':        'Farreach\nLeague',
  'stoneview-commonwealth': 'Stoneview\nCommonwealth',
  'brightmarch-union':      'Brightmarch\nUnion',
  'rustcoast-confederacy':  'Rustcoast\nConfederacy',
  'lakeside-union':         'Lakeside\nUnion',
  'southpoint-league':      'Southpoint\nLeague',
};

// Physical terrain colours (default view) — natural earth tones.
const TERRAIN_COLOR = {
  ocean:      [36, 92, 142],
  ice:        [234, 242, 248],
  polar:      [206, 222, 232],
  grassland:  [126, 156, 86],
  forest:     [70, 104, 60],
  desert:     [208, 184, 124],
  mountain:   [156, 142, 118],
  industrial: [122, 116, 106],
  urban:      [138, 126, 110],
  coastal:    [150, 172, 122],
};

// ── Value-noise (fbm) – no deps ───────────────────────────────────────────────
function makeNoise(seed) {
  const s = (seed * 982451653) >>> 0;
  function hash(x, y) {
    let n = (x * 374761393) ^ (y * 668265263) ^ s;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  function lerp(a, b, t) { const u = t * t * (3 - 2 * t); return a + (b - a) * u; }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    return lerp(
      lerp(hash(xi, yi), hash(xi + 1, yi), xf),
      lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), xf),
      yf);
  }
  return (x, y, oct = 4) => {
    let f = 0, amp = 0.5, fr = 1;
    for (let o = 0; o < oct; o++) { f += vnoise(x * fr, y * fr) * amp; fr *= 2.1; amp *= 0.48; }
    return f;
  };
}

export async function initGlobe(container, config) {
  const zones = await fetch('data/territories.json').then(r => r.json());
  const COLS = config.hex.columns;   // 32
  const ROWS = config.hex.rows;      // 37
  const dLng = 360 / COLS;
  // Content is squeezed into a mid-latitude band so the polar ice caps can be
  // large; everything beyond ±LAT_LIMIT is ocean/ice.
  const LAT_LIMIT = 60;
  const rowLatStep = (2 * LAT_LIMIT) / ROWS;

  // ── Hex ↔ geographic mapping ──────────────────────────────────────────────
  function hexCenter(col, row) {
    const lng = -180 + (col + 0.5 * (row % 2) + 0.5) * dLng;
    return [lng, LAT_LIMIT - (row + 0.5) * rowLatStep];
  }

  // Return the 6 vertex [lng, lat] positions of a pointy-top hex.
  function hexPolygon(col, row) {
    const [clng, clat] = hexCenter(col, row);
    const Sx = dLng / Math.sqrt(3);   // half-width in longitude degrees
    const Sy = rowLatStep / 1.5;      // half-height in latitude degrees
    const ring = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      ring.push([clng + Sx * Math.cos(a), clat + Sy * Math.sin(a)]);
    }
    return ring;
  }

  // ── Territory lookup (heavily warped for organic, non-rigid shapes) ──────────
  const warpA = makeNoise(211), warpB = makeNoise(307), warpC = makeNoise(409);
  const edgeN = makeNoise(523), iceN = makeNoise(617);
  function sampleZone(col, row) {
    // Two-scale domain warp: a broad undulation plus a finer jitter so no
    // boundary (especially the row-aligned east-west ones) stays straight.
    const wx = (warpA(col * 0.15, row * 0.15, 2) - 0.5) * 7.5
             + (warpC(col * 0.55, row * 0.55, 2) - 0.5) * 3.2;
    const wy = (warpB(col * 0.15, row * 0.15, 2) - 0.5) * 6.5
             + (warpC(col * 0.55 + 9, row * 0.55 + 9, 2) - 0.5) * 3.0;
    const sc = col + wx, sr = row + wy;
    let entry = { terrain: 'ocean', faction: null };
    for (const z of zones) {
      if (sr >= z.rMin && sr <= z.rMax && sc >= z.cMin && sc <= z.cMax)
        entry = { terrain: z.terrain, faction: z.faction || null };
    }
    return entry;
  }
  // Latitude bands, with a per-column wobble so the ice / water boundary is not
  // a perfectly straight line of latitude.
  const ICE_LAT = 47;    // base |lat| for ice
  const MOAT_LAT = 40;   // base |lat| for the separating water ring
  const lookup = new Map();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const lat = Math.abs(hexCenter(col, row)[1]);
      const wob = (iceN(col * 0.45, row * 0.12, 2) - 0.5) * 9; // wavy cap edge
      if (lat >= ICE_LAT + wob) lookup.set(`${col},${row}`, { terrain: 'ice', faction: null });
      else if (lat >= MOAT_LAT + wob * 0.7) lookup.set(`${col},${row}`, { terrain: 'ocean', faction: null });
      else lookup.set(`${col},${row}`, sampleZone(col, row));
    }
  }

  // Coastal erosion: nibble a fraction of land hexes that touch ocean so coasts
  // (and continents) lose a hex here and there — no perfectly clean edges.
  const ODD = r => r % 2 === 1;
  function rawNeighbours(col, row) {
    const o = ODD(row);
    return [[col+1,row],[col+(o?1:0),row+1],[col+(o?0:-1),row+1],
            [col-1,row],[col+(o?0:-1),row-1],[col+(o?1:0),row-1]];
  }
  const toErode = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const d = lookup.get(`${col},${row}`);
      if (d.terrain === 'ocean' || d.terrain === 'ice') continue;
      const touchesOcean = rawNeighbours(col, row)
        .some(([c, r]) => (lookup.get(`${c},${r}`)?.terrain ?? 'ocean') === 'ocean');
      if (touchesOcean && edgeN(col * 0.9, row * 0.9, 2) > 0.66) toErode.push(`${col},${row}`);
    }
  }
  for (const k of toErode) lookup.set(k, { terrain: 'ocean', faction: null });

  // ── Remove fully-enclosed enclaves only ─────────────────────────────────────
  // A blob of one nation is dissolved into a neighbour ONLY when (a) it is not
  // that nation's main (largest) blob, and (b) every nation touching it is the
  // same single other nation — water/ice borders are allowed. Islands surrounded
  // only by water, or blobs bordering two+ nations, are kept.
  {
    const wrap0 = c => ((c % COLS) + COLS) % COLS;
    const keyOf = (c, r) => `${wrap0(c)},${r}`;
    for (let pass = 0; pass < 4; pass++) {
      const visited = new Set();
      const comps = [];
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const k = `${col},${row}`;
          const d = lookup.get(k);
          if (!d.faction || visited.has(k)) continue;
          const fac = d.faction, hexes = [], stack = [[col, row]];
          visited.add(k);
          while (stack.length) {
            const [c, r] = stack.pop();
            hexes.push([c, r]);
            for (const [nc, nr] of rawNeighbours(c, r)) {
              if (nr < 0 || nr >= ROWS) continue;
              const wk = keyOf(nc, nr);
              if (!visited.has(wk) && lookup.get(wk)?.faction === fac) {
                visited.add(wk);
                stack.push([wrap0(nc), nr]);
              }
            }
          }
          comps.push({ fac, hexes });
        }
      }
      const maxSize = {};
      for (const cmp of comps) maxSize[cmp.fac] = Math.max(maxSize[cmp.fac] || 0, cmp.hexes.length);

      const dissolve = [];
      for (const cmp of comps) {
        if (cmp.hexes.length >= maxSize[cmp.fac]) continue; // keep each nation's main blob
        const inComp = new Set(cmp.hexes.map(([c, r]) => keyOf(c, r)));
        const extFactions = new Set();
        let rep = null;
        for (const [c, r] of cmp.hexes) {
          for (const [nc, nr] of rawNeighbours(c, r)) {
            if (nr < 0 || nr >= ROWS) continue;
            const wk = keyOf(nc, nr);
            if (inComp.has(wk)) continue;
            const nd = lookup.get(wk);
            if (nd && nd.faction) { extFactions.add(nd.faction); rep = nd; }
          }
        }
        if (extFactions.size === 1 && rep)
          dissolve.push([cmp.hexes, { terrain: rep.terrain, faction: rep.faction }]);
      }
      if (!dissolve.length) break;
      for (const [hexes, rep] of dissolve)
        for (const [c, r] of hexes) lookup.set(keyOf(c, r), rep);
    }
  }

  // ── Faction centroids (for labels) ────────────────────────────────────────
  const factionCentroids = new Map();
  for (const fk of Object.keys(FACTION_COLOR)) {
    let slng = 0, slat = 0, n = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (lookup.get(`${col},${row}`).faction === fk) {
          const [lng, lat] = hexCenter(col, row);
          slng += lng; slat += lat; n++;
        }
      }
    }
    if (n > 0) factionCentroids.set(fk, [slng / n, slat / n]);
  }

  // ── Texture baking ──────────────────────────────────────────────────────────
  const TW = 8192, TH = 4096;
  const SCALE = TW / 4096;  // line widths scale with resolution
  const lngToX = lng => ((lng + 180) / 360) * TW;
  const latToY = lat => ((90 - lat) / 180) * TH;

  const noiseA = makeNoise(73);
  const noiseB = makeNoise(131);

  // Pre-render a painterly noise tile once; applied as a soft-light overlay.
  // Horizontally TILEABLE: x is sampled around a circle (cos/sin) so the left and
  // right edges match, which is required for the seamless east-west wrap.
  const noiseTile = (() => {
    const w = 1536, h = 768, rad = 9;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    const img = x.createImageData(w, h);
    const d = img.data;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const ang = (i / w) * 2 * Math.PI;
        const cx = Math.cos(ang) * rad + 20, cz = Math.sin(ang) * rad + 40;
        const n = noiseB(cx, j * 0.05, 3) * 0.55 + noiseA(cz, j * 0.05 + 15, 3) * 0.45;
        const g = Math.max(0, Math.min(255, 128 + (n - 0.5) * 165));
        const k = (j * w + i) * 4;
        d[k] = d[k + 1] = d[k + 2] = g; d[k + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  })();

  // Seam helpers: wrap a column index and read wrapped territory data so we can
  // render a margin of columns past both edges, tiling the map east-west.
  const MARGIN = 2;
  const wrapCol = c => ((c % COLS) + COLS) % COLS;
  const cell = (c, r) => (r < 0 || r >= ROWS) ? null : lookup.get(`${wrapCol(c)},${r}`);

  // Per-hex colour with individual noise variation (makes each hex visually distinct).
  function hexBaseColor(col, row, rgb) {
    const n = noiseA(wrapCol(col) * 1.5, row * 1.5, 2);
    const v = 0.82 + 0.38 * n;
    return rgb.map(c => Math.min(255, Math.round(c * v)));
  }

  function fillHex(ctx, col, row, rgb) {
    const [r, g, b] = hexBaseColor(col, row, rgb);
    const ring = hexPolygon(col, row);
    ctx.beginPath();
    ring.forEach(([lng, lat], i) => {
      const x = lngToX(lng), y = latToY(lat);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();
  }

  // Neighbour → shared-edge mapping for an odd-r pointy-top grid.
  // Vertices from hexPolygon (angle 60*i-30), in screen space (y points down):
  //   v0 right-lower, v1 right-upper, v2 top, v3 left-upper, v4 left-lower, v5 bottom
  // Edges: E=[0,1] NE=[1,2] NW=[2,3] W=[3,4] SW=[4,5] SE=[5,0]
  function allNeighbours(col, row) {
    const odd = row % 2 === 1;
    return [
      { nc: col + 1,                nr: row,     ea: 0, eb: 1 }, // E
      { nc: col + (odd ? 1 : 0),    nr: row + 1, ea: 5, eb: 0 }, // SE
      { nc: col + (odd ? 0 : -1),   nr: row + 1, ea: 4, eb: 5 }, // SW
      { nc: col - 1,                nr: row,     ea: 3, eb: 4 }, // W
      { nc: col + (odd ? 0 : -1),   nr: row - 1, ea: 2, eb: 3 }, // NW
      { nc: col + (odd ? 1 : 0),    nr: row - 1, ea: 1, eb: 2 }, // NE
    ];
  }
  // Forward set (E, SE, SW) — each shared edge visited exactly once.
  const forwardNeighbours = (col, row) => allNeighbours(col, row).slice(0, 3);

  function buildTexture(political) {
    const cv = document.createElement('canvas');
    cv.width = TW; cv.height = TH;
    const ctx = cv.getContext('2d', { willReadFrequently: true });

    // ── Ocean base with subtle depth banding ──────────────────────────────
    const oceanGrad = ctx.createLinearGradient(0, 0, 0, TH);
    oceanGrad.addColorStop(0,   '#1a4e82');
    oceanGrad.addColorStop(0.3, '#1e5490');
    oceanGrad.addColorStop(0.7, '#18487e');
    oceanGrad.addColorStop(1,   '#123860');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, 0, TW, TH);

    // Columns are iterated with a margin past both edges (using wrapped data) so
    // the texture tiles seamlessly east-west.
    const C0 = -MARGIN, C1 = COLS + MARGIN;

    // ── Land hex fills (each with per-hex noise variation) ──────────────
    for (let row = 0; row < ROWS; row++) {
      for (let col = C0; col < C1; col++) {
        const d = cell(col, row);
        if (!d || d.terrain === 'ocean') continue;
        const rgb = (political && d.faction) ? FACTION_COLOR[d.faction] : TERRAIN_COLOR[d.terrain];
        fillHex(ctx, col, row, rgb || TERRAIN_COLOR.grassland);
      }
    }

    // ── Painterly noise overlay (soft-light; tile is horizontally seamless) ─
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.8;
    ctx.drawImage(noiseTile, 0, 0, TW, TH);
    ctx.globalAlpha = 0.32;
    ctx.drawImage(noiseTile, 0, TH * 0.31, TW, TH); // vertical-only second octave
    ctx.restore();

    // ── Hex grid outlines (thin, dark – shows the hex character) ─────────
    ctx.strokeStyle = 'rgba(0,0,0,0.26)';
    ctx.lineWidth = 2.5 * SCALE;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let row = 0; row < ROWS; row++) {
      for (let col = C0; col < C1; col++) {
        const d = cell(col, row);
        if (!d || d.terrain === 'ocean') continue;
        const ring = hexPolygon(col, row);
        ring.forEach(([lng, lat], i) => {
          const x = lngToX(lng), y = latToY(lat);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
    }
    ctx.stroke();

    // ── Coastlines: dark stroke on land hexes bordering ocean ────────────
    ctx.strokeStyle = 'rgba(20, 30, 40, 0.55)';
    ctx.lineWidth = 4 * SCALE;
    ctx.beginPath();
    for (let row = 0; row < ROWS; row++) {
      for (let col = C0; col < C1; col++) {
        const me = cell(col, row);
        if (!me || me.terrain === 'ocean') continue;
        const ring = hexPolygon(col, row);
        for (const { nc, nr, ea, eb } of allNeighbours(col, row)) {
          const nd = cell(nc, nr);
          if (!nd || nd.terrain === 'ocean') {
            ctx.moveTo(lngToX(ring[ea][0]), latToY(ring[ea][1]));
            ctx.lineTo(lngToX(ring[eb][0]), latToY(ring[eb][1]));
          }
        }
      }
    }
    ctx.stroke();

    // ── Mountain carets ───────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(50, 40, 28, 0.72)';
    ctx.lineWidth = 2.5 * SCALE;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let row = 0; row < ROWS; row++) {
      for (let col = C0; col < C1; col++) {
        if (cell(col, row)?.terrain !== 'mountain') continue;
        const [lng, lat] = hexCenter(col, row);
        const x = lngToX(lng), y = latToY(lat);
        const wc = wrapCol(col);
        const s = (18 + 10 * noiseB(wc * 1.7, row * 1.7, 1)) * SCALE;
        ctx.beginPath();
        ctx.moveTo(x - s, y + s * 0.55);
        ctx.lineTo(x,     y - s * 0.75);
        ctx.lineTo(x + s, y + s * 0.55);
        ctx.stroke();
      }
    }

    // ── Country borders ───────────────────────────────────────────────────
    // Walk every hex and every one of its six neighbours; draw the shared edge
    // whenever the two belong to different countries. Dedupe each edge so it is
    // stroked exactly once (this is what makes west/east borders consistent).
    if (political) {
      const seen = new Set();
      const path2 = new Path2D();
      for (let row = 0; row < ROWS; row++) {
        for (let col = C0; col < C1; col++) {
          const me = cell(col, row)?.faction;
          if (!me) continue;
          const ring = hexPolygon(col, row);
          for (const { nc, nr, ea, eb } of allNeighbours(col, row)) {
            const nf = cell(nc, nr)?.faction ?? null;
            if (me === nf) continue;
            const ax = ring[ea][0].toFixed(2), ay = ring[ea][1].toFixed(2);
            const bx = ring[eb][0].toFixed(2), by = ring[eb][1].toFixed(2);
            const key = ax < bx || (ax === bx && ay < by)
              ? `${ax},${ay}|${bx},${by}` : `${bx},${by}|${ax},${ay}`;
            if (seen.has(key)) continue;
            seen.add(key);
            path2.moveTo(lngToX(ring[ea][0]), latToY(ring[ea][1]));
            path2.lineTo(lngToX(ring[eb][0]), latToY(ring[eb][1]));
          }
        }
      }
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // Dark casing.
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 13 * SCALE;
      ctx.stroke(path2);
      // White dashed line on top.
      ctx.strokeStyle = 'rgba(245, 240, 225, 0.96)';
      ctx.lineWidth = 7 * SCALE;
      ctx.setLineDash([22 * SCALE, 10 * SCALE]);
      ctx.stroke(path2);
      ctx.setLineDash([]);
    }

    // ── Solid white poles ON TOP of the ice hexes ───────────────────────────
    // Fill all the way to the pole (y=0) with opaque white so there is never any
    // blue at the cap; feather the lower edge so it blends into the ice hexes.
    // A slightly wavy lower edge keeps the cap from being a perfect circle.
    const capWhite = '#f4f9ff';
    function paintCap(north) {
      const edgeLat = 51;              // where the solid white starts to fade
      const baseY = latToY(north ? edgeLat : -edgeLat);
      const poleY = north ? 0 : TH;
      const grad = ctx.createLinearGradient(0, poleY, 0, baseY);
      grad.addColorStop(0, capWhite);
      grad.addColorStop(0.82, capWhite);
      grad.addColorStop(1, 'rgba(244,249,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, Math.min(poleY, baseY), TW, Math.abs(baseY - poleY));
      // Wavy fringe of white blobs just below the solid edge for an irregular rim.
      ctx.fillStyle = capWhite;
      for (let i = 0; i <= 96; i++) {
        const lng = -180 + (i / 96) * 360;
        const wob = (iceN(i * 0.3, north ? 1 : 9, 2) - 0.5) * 6;
        const lat = (north ? 1 : -1) * (edgeLat - 2 + wob);
        const x = lngToX(lng), y = latToY(lat);
        ctx.beginPath();
        ctx.arc(x, y, 34 * SCALE, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    paintCap(true);
    paintCap(false);

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping; // seamless east-west wrap (fixes seam clip)
    tex.anisotropy = 16; // clamped to GPU max by the driver
    return tex;
  }

  // Build both textures (blocking, ~1-2s, done once).
  const texPolitical = buildTexture(true);
  const texTerrain   = buildTexture(false);

  // ── Three.js scene setup ────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.id = 'globe-canvas';
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  // Camera state: lateral pan (panX/panY) lets the planet sit off-centre so you
  // can zoom into a region near the edge of the screen. camZ is the dolly.
  const MAX_Z = 5.2;          // furthest zoom-out allowed
  let panX = 0, panY = 0, camZ = 3.9; // start zoomed out at the nation-label level
  function applyCamera() {
    camera.position.set(panX, panY, camZ);
    camera.up.set(0, 1, 0);
    camera.lookAt(panX, panY, 0);
    camera.updateProjectionMatrix();
  }
  applyCamera();

  // Use BasicMaterial so the baked texture renders exactly as painted.
  // Default to the political/country map; the toggle switches to physical terrain.
  const material = new THREE.MeshBasicMaterial({ map: texPolitical });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 160), material);
  scene.add(sphere);

  // ── Drifting cloud layer ────────────────────────────────────────────────────
  // A slightly larger transparent sphere with a soft, horizontally-tileable cloud
  // texture that rotates independently of the planet.
  const cloudTex = (() => {
    const w = 2048, h = 1024, rad = 4.2;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    const img = x.createImageData(w, h);
    const d = img.data;
    const cn = makeNoise(881);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const ang = (i / w) * 2 * Math.PI;
        const cx = Math.cos(ang) * rad + 30, cz = Math.sin(ang) * rad + 60;
        // fade clouds out toward the poles so the caps stay clear
        const polar = Math.abs(j / h - 0.5) * 2;        // 0 at equator, 1 at pole
        const fade = Math.max(0, 1 - Math.pow(polar, 2.2) * 1.2);
        let n = cn(cx, j * 0.028, 5) * 0.7 + cn(cx * 2.3 + 11, j * 0.07 + 5, 3) * 0.3;
        n = Math.max(0, n - 0.30) / 0.45;                 // broad, soft cloud masses
        const a = Math.min(220, Math.round(Math.pow(Math.min(1, n), 1.1) * 220 * fade));
        const k = (j * w + i) * 4;
        d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = a;
      }
    }
    x.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  })();
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.015, 96, 96),
    new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.82, depthWrite: false })
  );
  sphere.add(clouds); // ride along with the planet, plus their own drift

  // Thin atmosphere rim (additive blend so it glows).
  const atmoMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { color: { value: new THREE.Color(0x5aaade) } },
    vertexShader: `
      varying float fresnel;
      void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        fresnel = 1.0 - abs(dot(n, vec3(0,0,1)));
        gl_Position = projectionMatrix * mvPos;
      }`,
    fragmentShader: `
      uniform vec3 color;
      varying float fresnel;
      void main() {
        float f = pow(fresnel, 2.5);
        gl_FragColor = vec4(color * f, f * 0.45);
      }`,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 64), atmoMat);
  scene.add(atmo);

  // ── lng/lat → 3D point on unit sphere (matching Three's SphereGeometry UV) ─
  function lnglatToVec3(lng, lat, R = 1) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);
    return new THREE.Vector3(
      -R * Math.sin(phi) * Math.cos(theta),
       R * Math.cos(phi),
       R * Math.sin(phi) * Math.sin(theta));
  }

  // Rotation.y that places a given longitude facing the camera (+Z axis).
  function yRotFor(lng) {
    return Math.PI / 2 - (lng + 180) * Math.PI / 180;
  }
  sphere.rotation.y = yRotFor(-30); // start centred on main continent

  let width = 0, height = 0;

  function resize() {
    const r = container.getBoundingClientRect();
    width = r.width; height = r.height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    applyCamera();
    renderScene();
  }

  // ── Pin layer (DOM, projected) ────────────────────────────────────────────
  const pinLayer = document.createElement('div');
  pinLayer.id = 'pin-layer';
  container.appendChild(pinLayer);

  const TYPE_COLORS = { location: '#ffd23f', faction: '#e8a030', character: '#50c878' };
  // Label visibility by zoom, with an overlap band where both nations and cities
  // are shown: nations fade out as you zoom past NATION_HIDE; cities fade in at
  // CITY_SHOW. Between them (CITY_SHOW..NATION_HIDE inverted) both are visible.
  const NATION_HIDE = 2.3;  // nations visible while camZ > this
  const CITY_SHOW   = 3.7;  // cities visible while camZ < this
  let countryHandler = null, shipHandler = null;
  let autoRotate = true;    // spins until the first east-west drag
  let pins = [];

  // Snap a hex address to the nearest land hex so no city ends up in the sea/ice.
  const isLand = (c, r) => {
    const d = cell(c, r);
    return d && d.terrain !== 'ocean' && d.terrain !== 'ice';
  };
  function snapToLand(col, row) {
    if (isLand(col, row)) return [wrapCol(col), row];
    for (let rad = 1; rad <= 5; rad++) {
      let best = null, bestD = Infinity;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const r = row + dr, c = col + dc;
          if (r < 0 || r >= ROWS || !isLand(c, r)) continue;
          const d = dr * dr + dc * dc;
          if (d < bestD) { bestD = d; best = [wrapCol(c), r]; }
        }
      }
      if (best) return best;
    }
    return [wrapCol(col), row];
  }

  function setPins(pinData, onClick) {
    pinLayer.innerHTML = '';
    pins = pinData.map(pin => {
      const [c0, r0] = [parseInt(pin.hexAddress.slice(0, 2)), parseInt(pin.hexAddress.slice(2, 4))];
      const [col, row] = snapToLand(c0, r0);
      const el = document.createElement('div');
      el.className = `pin pin-${pin.type}`;
      const c = TYPE_COLORS[pin.type] || '#fff';
      el.innerHTML =
        `<div class="pin-dot" style="background:${c};color:${c}"></div>` +
        `<div class="pin-label">${pin.label}</div>`;
      el.addEventListener('click', e => { e.stopPropagation(); onClick(pin); });
      pinLayer.appendChild(el);
      return { el, local: lnglatToVec3(...hexCenter(col, row), 1) };
    });
    updatePinPositions();
  }

  // ── Faction labels (DOM, projected from territory centroids) ──────────────
  const labelLayer = document.createElement('div');
  labelLayer.id = 'label-layer';
  container.appendChild(labelLayer);

  const factionLabels = [];
  for (const [fk, [lng, lat]] of factionCentroids) {
    const name = FACTION_LABEL[fk] || fk;
    const el = document.createElement('div');
    el.className = 'faction-label';
    el.textContent = name; // newlines via CSS white-space
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (countryHandler) countryHandler(fk, name.replace(/\n/g, ' '));
    });
    labelLayer.appendChild(el);
    factionLabels.push({ el, local: lnglatToVec3(lng, lat, 1) });
  }

  // ── Orbiting starship (fixed in space; opens the Caladrius faction page) ────
  const orbitLayer = document.createElement('div');
  orbitLayer.id = 'orbit-layer';
  container.appendChild(orbitLayer);
  const ship = document.createElement('div');
  ship.id = 'starship';
  ship.title = 'Caladrius — orbital carrier';
  ship.innerHTML = `
    <svg viewBox="0 0 120 60" width="72" height="36" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="hull" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#cfd6e2"/><stop offset="1" stop-color="#6b7384"/>
      </linearGradient></defs>
      <g stroke="#2b3240" stroke-width="1.5" stroke-linejoin="round">
        <path d="M8 30 L78 22 L112 30 L78 38 Z" fill="url(#hull)"/>
        <rect x="30" y="17" width="34" height="6" rx="2" fill="#8a93a6"/>
        <rect x="30" y="37" width="34" height="6" rx="2" fill="#8a93a6"/>
        <path d="M78 22 L88 9 M78 38 L88 51" stroke="#3a4252" stroke-width="2"/>
        <circle cx="96" cy="30" r="6" fill="#9fd0ff"/>
      </g>
    </svg>
    <div class="ship-label">CALADRIUS</div>`;
  ship.addEventListener('click', e => {
    e.stopPropagation();
    if (shipHandler) shipHandler();
  });
  orbitLayer.appendChild(ship);
  const shipWorld = new THREE.Vector3(1.02, 0.6, 0.15); // fixed orbital point just off the limb

  function updateShip() {
    const p = shipWorld.clone().project(camera);
    ship.style.left = ((p.x * 0.5 + 0.5) * width) + 'px';
    ship.style.top  = ((-p.y * 0.5 + 0.5) * height) + 'px';
  }

  // ── Project a local sphere-surface point to screen ─────────────────────────
  const _v = new THREE.Vector3();
  function projectLocal(local) {
    _v.copy(local).applyMatrix4(sphere.matrixWorld);
    const facing = _v.clone().normalize().dot(new THREE.Vector3(0, 0, 1));
    if (facing < 0.1) return null;
    const p = _v.clone().project(camera);
    return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height };
  }

  function updatePinPositions() {
    sphere.updateMatrixWorld();
    updateShip();
    const showCities = camZ < CITY_SHOW;
    const showNations = true; // country labels are always visible
    for (const { el, local } of pins) {
      const p = showCities ? projectLocal(local) : null;
      if (!p) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = p.x + 'px';
      el.style.top  = p.y + 'px';
    }
    for (const { el, local } of factionLabels) {
      const p = showNations ? projectLocal(local) : null;
      if (!p) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = p.x + 'px';
      el.style.top  = p.y + 'px';
    }
  }

  function renderScene() {
    renderer.render(scene, camera);
    updatePinPositions();
  }

  // ── Interaction: east-west drag, wheel zoom-to-cursor ────────────────────
  let dragging = false, lastX = 0;

  canvas.addEventListener('pointerdown', e => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    if (Math.abs(dx) > 1) autoRotate = false; // first east-west drag stops the spin
    sphere.rotation.y += dx * 0.005;
    lastX = e.clientX;
    renderScene();
  });
  canvas.addEventListener('pointerup', e => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  });

  // Zoom toward the cursor so the planet can sit off-centre.
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / width) * 2 - 1;
    const ndcY = -(((e.clientY - rect.top) / height) * 2 - 1);
    const tan = Math.tan((camera.fov * Math.PI / 180) / 2);
    const wx = panX + ndcX * tan * camZ * camera.aspect;
    const wy = panY + ndcY * tan * camZ;
    camZ *= e.deltaY < 0 ? 0.9 : 1.111;
    camZ = Math.max(1.3, Math.min(MAX_Z, camZ));
    // Keep the point under the cursor fixed (no pan when fully zoomed out).
    if (camZ >= MAX_Z) { panX = 0; panY = 0; }
    else {
      panX = wx - ndcX * tan * camZ * camera.aspect;
      panY = wy - ndcY * tan * camZ;
      const lim = 1.3;
      panX = Math.max(-lim, Math.min(lim, panX));
      panY = Math.max(-lim, Math.min(lim, panY));
    }
    applyCamera();
    renderScene();
  }, { passive: false });

  // Continuous loop: clouds always drift; planet auto-rotates until first drag.
  (function animate() {
    requestAnimationFrame(animate);
    clouds.rotation.y += 0.00022;            // slow independent cloud drift
    if (autoRotate && !dragging) sphere.rotation.y += 0.0009;
    renderScene();
  })();

  function panTo(lng) {
    let target = yRotFor(lng);
    const cur = sphere.rotation.y;
    target += Math.round((cur - target) / (2 * Math.PI)) * 2 * Math.PI;
    const t0 = performance.now(), dur = 700;
    (function step(now) {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      sphere.rotation.y = cur + (target - cur) * e;
      renderScene();
      if (t < 1) requestAnimationFrame(step);
    })(t0);
  }

  window.addEventListener('resize', resize);
  resize();

  let political = true; // default: political/country map
  return {
    toggleTint() {
      political = !political;
      material.map = political ? texPolitical : texTerrain;
      material.needsUpdate = true;
      renderScene();
      return political;
    },
    onCountry(cb) { countryHandler = cb; },
    onShip(cb) { shipHandler = cb; },
    setPins,
    panTo,
    panToHex(address) {
      panTo(hexCenter(parseInt(address.slice(0, 2)), parseInt(address.slice(2, 4)))[0]);
    },
    invalidateSize: resize,
  };
}
