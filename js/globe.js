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

  // ── Territory lookup (warped for organic, non-rigid shapes) ──────────────────
  const warpA = makeNoise(211), warpB = makeNoise(307);
  function sampleZone(col, row) {
    // Warp the sampling position with low-frequency noise so faction/terrain
    // boundaries undulate instead of following rigid rectangles.
    const wx = (warpA(col * 0.16, row * 0.16, 2) - 0.5) * 6.5;
    const wy = (warpB(col * 0.16, row * 0.16, 2) - 0.5) * 5.0;
    const sc = col + wx, sr = row + wy;
    let entry = { terrain: 'ocean', faction: null };
    for (const z of zones) {
      if (sr >= z.rMin && sr <= z.rMax && sc >= z.cMin && sc <= z.cMax)
        entry = { terrain: z.terrain, faction: z.faction || null };
    }
    return entry;
  }
  // Above this latitude the surface is polar ice — actual white hexes, no content.
  const ICE_LAT = 44;
  const lookup = new Map();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const lat = hexCenter(col, row)[1];
      if (Math.abs(lat) >= ICE_LAT) lookup.set(`${col},${row}`, { terrain: 'ice', faction: null });
      else lookup.set(`${col},${row}`, sampleZone(col, row));
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

  // Pre-render a painterly noise tile once; applied as a soft-light overlay
  // (far cheaper than a per-pixel loop over the full 8K texture).
  const noiseTile = (() => {
    const w = 1536, h = 768;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    const img = x.createImageData(w, h);
    const d = img.data;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const n = noiseB(i * 0.05, j * 0.05, 4) * 0.6 + noiseA(i * 0.014, j * 0.014, 2) * 0.4;
        const g = Math.max(0, Math.min(255, 128 + (n - 0.5) * 165));
        const k = (j * w + i) * 4;
        d[k] = d[k + 1] = d[k + 2] = g; d[k + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  })();

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

    // ── Land hex fills (each with per-hex noise variation) ──────────────
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const d = lookup.get(`${col},${row}`);
        if (d.terrain === 'ocean') continue;
        const rgb = (political && d.faction) ? FACTION_COLOR[d.faction] : TERRAIN_COLOR[d.terrain];
        fillHex(ctx, col, row, rgb || TERRAIN_COLOR.grassland);
      }
    }

    // ── Painterly noise overlay (soft-light, cheap) ─────────────────────
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.8;
    ctx.drawImage(noiseTile, 0, 0, TW, TH);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(noiseTile, TW * 0.13, TH * 0.07, TW, TH); // second offset octave
    ctx.restore();

    // ── Hex grid outlines (thin, dark – shows the hex character) ─────────
    ctx.strokeStyle = 'rgba(0,0,0,0.26)';
    ctx.lineWidth = 2.5 * SCALE;
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
    ctx.strokeStyle = 'rgba(20, 30, 40, 0.55)';
    ctx.lineWidth = 4 * SCALE;
    ctx.beginPath();
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const me = lookup.get(`${col},${row}`);
        if (me.terrain === 'ocean') continue;
        const ring = hexPolygon(col, row);
        for (const { nc, nr, ea, eb } of allNeighbours(col, row)) {
          const nd = lookup.get(`${nc},${nr}`);
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
      for (let col = 0; col < COLS; col++) {
        if (lookup.get(`${col},${row}`).terrain !== 'mountain') continue;
        const [lng, lat] = hexCenter(col, row);
        const x = lngToX(lng), y = latToY(lat);
        const s = (18 + 10 * noiseB(col * 1.7, row * 1.7, 1)) * SCALE;
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
      ctx.lineWidth = 14 * SCALE;
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
      ctx.lineWidth = 8 * SCALE;
      ctx.setLineDash([22 * SCALE, 10 * SCALE]);
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

    // (Ice caps are now real white hexes baked above; no gradient overlay.)

    const tex = new THREE.CanvasTexture(cv);
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
  camera.position.set(0, 0, 3.7);

  // Use BasicMaterial so the baked texture renders exactly as painted.
  // Default to the physical/terrain map; the toggle switches to political colours.
  const material = new THREE.MeshBasicMaterial({ map: texTerrain });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 160), material);
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

  const TYPE_COLORS = { location: '#ffd23f', faction: '#e8a030', character: '#50c878' };
  // Camera distance beyond which we show country labels (far) instead of city pins
  // (near). Set high so cities appear after only a small zoom-in, while the whole
  // planet is still comfortably in view.
  const ZOOM_FAR = 3.5;
  let countryHandler = null;
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
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (countryHandler) countryHandler(fk, name.replace(/\n/g, ' '));
    });
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
    const far = camera.position.z >= ZOOM_FAR;
    // Far zoom → country labels; near zoom → city pins. They swap.
    for (const { el, local } of pins) {
      const p = far ? null : projectLocal(local);
      if (!p) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = p.x + 'px';
      el.style.top  = p.y + 'px';
    }
    for (const { el, local } of factionLabels) {
      const p = far ? projectLocal(local) : null;
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

  let political = false; // default: physical/terrain map
  return {
    toggleTint() {
      political = !political;
      material.map = political ? texPolitical : texTerrain;
      material.needsUpdate = true;
      renderScene();
      return political;
    },
    onCountry(cb) { countryHandler = cb; },
    setPins,
    panTo,
    panToHex(address) {
      panTo(hexCenter(parseInt(address.slice(0, 2)), parseInt(address.slice(2, 4)))[0]);
    },
    invalidateSize: resize,
  };
}
