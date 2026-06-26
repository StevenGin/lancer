// ── Vanities globe: Three.js GPU sphere with baked equirectangular texture ───
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

// Physical terrain colours (tint-off mode).
const TERRAIN_COLOR = {
  ocean:      [30, 80, 130],
  polar:      [215, 228, 236],
  grassland:  [100, 135, 72],
  forest:     [58, 92, 52],
  desert:     [195, 168, 105],
  mountain:   [138, 120, 92],
  industrial: [78, 72, 86],
  urban:      [95, 78, 102],
  coastal:    [75, 138, 148],
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
  const dLat = 180 / ROWS;

  // ── Hex ↔ geographic mapping ──────────────────────────────────────────────
  function hexCenter(col, row) {
    const lng = -180 + (col + 0.5 * (row % 2) + 0.5) * dLng;
    return [lng, Math.max(-89.9, Math.min(89.9, 90 - (row + 0.5) * dLat))];
  }

  // Return the 6 vertex [lng, lat] positions of a pointy-top hex.
  function hexPolygon(col, row) {
    const [clng, clat] = hexCenter(col, row);
    const Sx = dLng / Math.sqrt(3);  // half-width in longitude degrees
    const Sy = dLat / 1.5;           // half-height in latitude degrees
    const ring = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      ring.push([clng + Sx * Math.cos(a),
                 Math.max(-90, Math.min(90, clat + Sy * Math.sin(a)))]);
    }
    return ring;
  }

  // ── Territory lookup ────────────────────────────────────────────────────────
  const lookup = new Map();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let entry = { terrain: 'ocean', faction: null };
      for (const z of zones) {
        if (row >= z.rMin && row <= z.rMax && col >= z.cMin && col <= z.cMax)
          entry = { terrain: z.terrain, faction: z.faction || null };
      }
      lookup.set(`${col},${row}`, entry);
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
  const TW = 4096, TH = 2048;
  const lngToX = lng => ((lng + 180) / 360) * TW;
  const latToY = lat => ((90 - lat) / 180) * TH;

  const noiseA = makeNoise(73);
  const noiseB = makeNoise(131);
  const noiseC = makeNoise(47);

  // Per-hex colour with individual noise variation (makes each hex visually distinct).
  function hexBaseColor(col, row, rgb) {
    const n = noiseA(col * 1.5, row * 1.5, 2);
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

  // Correct neighbour → shared-edge mapping for odd-r pointy-top grid.
  // Vertex winding order (from hexPolygon, 60*i-30, clockwise in screen space):
  //   0=upper-right, 1=lower-right, 2=bottom, 3=lower-left, 4=upper-left, 5=top
  // Shared edges:
  //   right   → edge [0, 1]
  //   lower-r → edge [1, 2]
  //   lower-l → edge [2, 3]
  function forwardNeighbours(col, row) {
    const odd = row % 2 === 1;
    return [
      { nc: col + 1, nr: row,     ea: 0, eb: 1 },          // E
      { nc: col + (odd ? 1 : 0), nr: row + 1, ea: 1, eb: 2 }, // SE
      { nc: col + (odd ? 0 : -1), nr: row + 1, ea: 2, eb: 3 }, // SW
    ];
  }

  // Rivers defined as [lng, lat] waypoints, flowing from highlands toward ocean.
  const RIVERS = [
    // Stoneview mountains → Eastern Sea
    [[112.5, 4.9], [118.1, 0], [135, -4.9], [140.6, -9.7], [152, -14]],
    // Northreach highlands → Cerulean Sea
    [[-78.75, 53.5], [-73.1, 48.6], [-56.25, 43.8], [-50.6, 38.9], [-33.75, 34.1]],
    // Greenvale heartland → Silvermere Bay
    [[-22.5, 14.6], [-33.75, 4.9], [-33.75, -4.9], [-39.4, -19.5], [-39.4, -29.2]],
    // Duneward desert → western ocean
    [[-106.9, 19.5], [-112.5, 4.9], [-118.1, 0], [-118.1, -14.6]],
  ];

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

    // ── Land hex fills (each with per-hex noise variation) ──────────────
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const d = lookup.get(`${col},${row}`);
        if (d.terrain === 'ocean') continue;
        const rgb = (political && d.faction) ? FACTION_COLOR[d.faction] : TERRAIN_COLOR[d.terrain];
        fillHex(ctx, col, row, rgb || TERRAIN_COLOR.grassland);
      }
    }

    // ── Per-pixel noise overlay (texture variation, avoids uniform blobs) ─
    const imgData = ctx.getImageData(0, 0, TW, TH);
    const px = imgData.data;
    for (let y = 0; y < TH; y++) {
      for (let x = 0; x < TW; x++) {
        const i = (y * TW + x) * 4;
        const isOcean = px[i + 2] > 110 && px[i] < 80;
        const nx = x / TW, ny = y / TH;
        if (isOcean) {
          // Ocean: gentle luminance variation for depth.
          const w = 0.9 + 0.2 * noiseA(nx * 30, ny * 15, 3);
          px[i] = Math.min(255, px[i] * w);
          px[i+1] = Math.min(255, px[i+1] * w);
          px[i+2] = Math.min(255, px[i+2] * w);
        } else {
          // Land: painterly multi-octave variation.
          const n = noiseB(nx * 80, ny * 80, 3) * 0.5 + noiseC(nx * 20, ny * 20, 2) * 0.5;
          const v = 0.85 + 0.30 * n;
          px[i] = Math.min(255, px[i] * v);
          px[i+1] = Math.min(255, px[i+1] * v);
          px[i+2] = Math.min(255, px[i+2] * v);
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // ── Hex grid outlines (thin, dark – shows the hex character) ─────────
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const d = lookup.get(`${col},${row}`);
        if (d.terrain === 'ocean') continue; // skip ocean hexes
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
    ctx.strokeStyle = 'rgba(20, 30, 40, 0.6)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const me = lookup.get(`${col},${row}`);
        if (me.terrain === 'ocean') continue;
        const ring = hexPolygon(col, row);
        for (const { nc, nr, ea, eb } of forwardNeighbours(col, row)) {
          const nd = lookup.get(`${nc},${nr}`);
          if (!nd || nd.terrain === 'ocean') {
            ctx.moveTo(lngToX(ring[ea][0]), latToY(ring[ea][1]));
            ctx.lineTo(lngToX(ring[eb][0]), latToY(ring[eb][1]));
          }
        }
        // Also check backward edges for coastlines at boundary hexes
        const odd = row % 2 === 1;
        const backward = [
          { nc: col - 1, nr: row },
          { nc: col + (odd ? 0 : -1), nr: row - 1 },
          { nc: col + (odd ? 1 : 0), nr: row - 1 },
        ];
        const backEdges = [[3, 4], [4, 5], [5, 0]];
        backward.forEach(({ nc, nr }, idx) => {
          const nd = lookup.get(`${nc},${nr}`);
          if (!nd || nd.terrain === 'ocean') {
            const [ea, eb] = backEdges[idx];
            ctx.moveTo(lngToX(ring[ea][0]), latToY(ring[ea][1]));
            ctx.lineTo(lngToX(ring[eb][0]), latToY(ring[eb][1]));
          }
        });
      }
    }
    ctx.stroke();

    // ── Rivers ────────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(60, 130, 195, 0.82)';
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const r of RIVERS) {
      ctx.beginPath();
      r.forEach(([lng, lat], i) => {
        const x = lngToX(lng), y = latToY(lat);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // ── Mountain carets ───────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(50, 40, 28, 0.72)';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (lookup.get(`${col},${row}`).terrain !== 'mountain') continue;
        const [lng, lat] = hexCenter(col, row);
        const x = lngToX(lng), y = latToY(lat);
        const s = 18 + 10 * noiseB(col * 1.7, row * 1.7, 1);
        ctx.beginPath();
        ctx.moveTo(x - s, y + s * 0.55);
        ctx.lineTo(x,     y - s * 0.75);
        ctx.lineTo(x + s, y + s * 0.55);
        ctx.stroke();
      }
    }

    // ── Faction borders (thick white dashed, all in one stroke call) ──────
    if (political) {
      // Softer shadow pass first.
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 14;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const me = lookup.get(`${col},${row}`).faction;
          if (!me) continue;
          const ring = hexPolygon(col, row);
          for (const { nc, nr, ea, eb } of forwardNeighbours(col, row)) {
            const nf = lookup.get(`${nc},${nr}`)?.faction ?? null;
            if (me !== nf) {
              ctx.moveTo(lngToX(ring[ea][0]), latToY(ring[ea][1]));
              ctx.lineTo(lngToX(ring[eb][0]), latToY(ring[eb][1]));
            }
          }
        }
      }
      ctx.stroke();

      // White dashed border pass.
      ctx.strokeStyle = 'rgba(245, 240, 225, 0.95)';
      ctx.lineWidth = 8;
      ctx.setLineDash([22, 10]);
      ctx.lineDashOffset = 0;
      ctx.beginPath();
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const me = lookup.get(`${col},${row}`).faction;
          if (!me) continue;
          const ring = hexPolygon(col, row);
          for (const { nc, nr, ea, eb } of forwardNeighbours(col, row)) {
            const nf = lookup.get(`${nc},${nr}`)?.faction ?? null;
            if (me !== nf) {
              ctx.moveTo(lngToX(ring[ea][0]), latToY(ring[ea][1]));
              ctx.lineTo(lngToX(ring[eb][0]), latToY(ring[eb][1]));
            }
          }
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Polar ice caps – large, soft, radial gradient ────────────────────
    // North cap: centered at top edge of texture.
    const capNPx = TH * 0.22; // extends ~22% of image height from top
    const gnCap = ctx.createRadialGradient(TW / 2, 0, 0, TW / 2, 0, capNPx);
    gnCap.addColorStop(0,    'rgba(248,252,255,1)');
    gnCap.addColorStop(0.45, 'rgba(235,245,252,0.92)');
    gnCap.addColorStop(0.72, 'rgba(215,232,244,0.72)');
    gnCap.addColorStop(0.88, 'rgba(200,220,236,0.40)');
    gnCap.addColorStop(1,    'rgba(190,210,228,0)');
    ctx.fillStyle = gnCap;
    ctx.fillRect(0, 0, TW, capNPx * 1.1);

    // South cap: centered at bottom edge.
    const capSPx = TH * 0.14;
    const gsCap = ctx.createRadialGradient(TW / 2, TH, 0, TW / 2, TH, capSPx);
    gsCap.addColorStop(0,    'rgba(248,252,255,1)');
    gsCap.addColorStop(0.5,  'rgba(235,245,252,0.85)');
    gsCap.addColorStop(0.8,  'rgba(215,232,244,0.50)');
    gsCap.addColorStop(1,    'rgba(200,220,236,0)');
    ctx.fillStyle = gsCap;
    ctx.fillRect(0, TH - capSPx * 1.1, TW, capSPx * 1.1);

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 8;
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
  camera.position.set(0, 0, 3.0);

  // Use BasicMaterial so the baked texture renders exactly as painted.
  const material = new THREE.MeshBasicMaterial({ map: texPolitical });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), material);
  scene.add(sphere);

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
    camera.updateProjectionMatrix();
    renderScene();
  }

  // ── Pin layer (DOM, projected) ────────────────────────────────────────────
  const pinLayer = document.createElement('div');
  pinLayer.id = 'pin-layer';
  container.appendChild(pinLayer);

  const TYPE_COLORS = { location: '#4a9eff', faction: '#e8a030', character: '#50c878' };
  let pins = [];

  function setPins(pinData, onClick) {
    pinLayer.innerHTML = '';
    pins = pinData.map(pin => {
      const [col, row] = [parseInt(pin.hexAddress.slice(0, 2)), parseInt(pin.hexAddress.slice(2, 4))];
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
    labelLayer.appendChild(el);
    factionLabels.push({ el, local: lnglatToVec3(lng, lat, 1) });
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
    for (const { el, local } of pins) {
      const p = projectLocal(local);
      if (!p) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = p.x + 'px';
      el.style.top  = p.y + 'px';
    }
    for (const { el, local } of factionLabels) {
      const p = projectLocal(local);
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

  // ── Interaction: east-west drag only, mouse wheel zoom ───────────────────
  let dragging = false, lastX = 0;

  canvas.addEventListener('pointerdown', e => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    sphere.rotation.y += (e.clientX - lastX) * 0.005;
    lastX = e.clientX;
    renderScene();
  });
  canvas.addEventListener('pointerup', e => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    camera.position.z *= e.deltaY < 0 ? 0.92 : 1.09;
    camera.position.z = Math.max(1.4, Math.min(5.5, camera.position.z));
    renderScene();
  }, { passive: false });

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

  let political = true;
  return {
    toggleTint() {
      political = !political;
      material.map = political ? texPolitical : texTerrain;
      material.needsUpdate = true;
      renderScene();
      return political;
    },
    setPins,
    panTo,
    panToHex(address) {
      panTo(hexCenter(parseInt(address.slice(0, 2)), parseInt(address.slice(2, 4)))[0]);
    },
    invalidateSize: resize,
  };
}
