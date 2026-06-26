// ── Vanities globe: GPU-textured sphere (Three.js) ───────────────────────────
// Territory data (col,row hexes) is baked once into an equirectangular raster
// texture — painterly terrain + country colours + white borders — then mapped
// onto a sphere. The GPU handles rotation, so dragging is smooth. The sphere
// only spins east-west (about its polar axis).

// Political (per-country) colours, tuned to the reference map.
const FACTION_COLOR = {
  'northreach-confederacy': [150, 158, 96],
  'veltora-federation':     [78, 70, 80],
  'smogspire-union':        [120, 108, 132],
  'duneward-coalition':     [202, 172, 112],
  'greenvale-republic':     [112, 150, 80],
  'farreach-league':        [118, 138, 112],
  'stoneview-commonwealth': [142, 122, 96],
  'brightmarch-union':      [172, 110, 90],
  'rustcoast-confederacy':  [184, 122, 70],
  'lakeside-union':         [86, 150, 162],
  'southpoint-league':      [122, 162, 122],
};

// Physical terrain colours (shown when political tint is toggled off).
const TERRAIN_COLOR = {
  ocean:      [34, 84, 128],
  polar:      [222, 228, 234],
  grassland:  [104, 134, 76],
  forest:     [62, 96, 58],
  desert:     [200, 172, 112],
  mountain:   [140, 122, 96],
  industrial: [82, 76, 88],
  urban:      [98, 80, 106],
  coastal:    [80, 142, 152],
};

const OCEAN = [30, 74, 116];
const RIVERS = [
  [[-120, 55], [-110, 40], [-95, 28], [-88, 12], [-92, -4]],
  [[-30, 48], [-18, 34], [-10, 18], [-14, 2], [-6, -14]],
  [[60, 40], [72, 26], [80, 10], [76, -8], [84, -22]],
  [[10, -30], [22, -42], [34, -54], [30, -66]],
];

// ── Value-noise (fbm) for painterly texture, no external deps ─────────────────
function makeNoise(seed) {
  function hash(x, y) {
    let n = x * 374761393 + y * 668265263 + seed * 982451653;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  }
  const smooth = t => t * t * (3 - 2 * t);
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const tl = hash(xi, yi), tr = hash(xi + 1, yi);
    const bl = hash(xi, yi + 1), br = hash(xi + 1, yi + 1);
    const u = smooth(xf), v = smooth(yf);
    return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
  }
  return function (x, y) {
    let f = 0, amp = 0.5, fr = 1;
    for (let o = 0; o < 4; o++) { f += vnoise(x * fr, y * fr) * amp; fr *= 2; amp *= 0.5; }
    return f;
  };
}

export async function initGlobe(container, config) {
  const zones = await fetch('data/territories.json').then(r => r.json());
  const COLS = config.hex.columns;
  const ROWS = config.hex.rows;
  const dLng = 360 / COLS;
  const dLat = 180 / ROWS;

  // ── Hex ↔ geo mapping ───────────────────────────────────────────────────────
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
      let lat = Math.max(-90, Math.min(90, clat + Sy * Math.sin(a)));
      ring.push([clng + Sx * Math.cos(a), lat]);
    }
    return ring;
  }

  // ── Territory lookup ──────────────────────────────────────────────────────────
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

  // ── Texture generation (equirectangular, baked once) ─────────────────────────
  const TW = 2048, TH = 1024;
  const lngToX = lng => ((lng + 180) / 360) * TW;
  const latToY = lat => ((90 - lat) / 180) * TH;
  const noise = makeNoise(73);
  const mtnNoise = makeNoise(131);

  function neighbourKey(col, row, dir) {
    const even = row % 2 === 0;
    const D = even
      ? { right: [1, 0], dl: [-1, 1], dr: [0, 1] }
      : { right: [1, 0], dl: [0, 1], dr: [1, 1] };
    const [dc, dr] = D[dir];
    return [col + dc, row + dr];
  }

  function fillHex(ctx, col, row, rgb) {
    const ring = hexPolygon(col, row);
    ctx.beginPath();
    ring.forEach(([lng, lat], i) => {
      const x = lngToX(lng), y = latToY(lat);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx.fill();
  }

  function buildTexture(political) {
    const cv = document.createElement('canvas');
    cv.width = TW; cv.height = TH;
    const ctx = cv.getContext('2d');

    // Ocean base.
    ctx.fillStyle = `rgb(${OCEAN[0]},${OCEAN[1]},${OCEAN[2]})`;
    ctx.fillRect(0, 0, TW, TH);

    // Land/terrain hexes.
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const d = lookup.get(`${col},${row}`);
        if (d.terrain === 'ocean') continue;
        let rgb;
        if (political && d.faction) rgb = FACTION_COLOR[d.faction] || TERRAIN_COLOR.grassland;
        else rgb = TERRAIN_COLOR[d.terrain] || TERRAIN_COLOR.grassland;
        fillHex(ctx, col, row, rgb);
      }
    }

    // Painterly noise modulation over the whole sphere (breaks up flat fills).
    const img = ctx.getImageData(0, 0, TW, TH);
    const px = img.data;
    for (let y = 0; y < TH; y++) {
      for (let x = 0; x < TW; x++) {
        const i = (y * TW + x) * 4;
        const isWater = px[i] < 60 && px[i + 2] > 90 && px[i + 1] < 130;
        const n = noise(x * 0.05, y * 0.05) * 0.6 + noise(x * 0.012, y * 0.012) * 0.4;
        let f = 0.82 + 0.36 * n;
        if (isWater) {
          // gentle depth banding for the seas
          const w = 0.88 + 0.18 * noise(x * 0.02 + 50, y * 0.02 + 50);
          f = w;
        } else {
          // speckle for a hand-drawn land feel
          const sp = noise(x * 0.35, y * 0.35);
          f *= 0.94 + 0.12 * sp;
        }
        px[i] = Math.min(255, px[i] * f);
        px[i + 1] = Math.min(255, px[i + 1] * f);
        px[i + 2] = Math.min(255, px[i + 2] * f);
      }
    }
    ctx.putImageData(img, 0, 0);

    // Rivers.
    ctx.strokeStyle = 'rgba(70,120,170,0.8)';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    for (const r of RIVERS) {
      ctx.beginPath();
      r.forEach(([lng, lat], i) => {
        const x = lngToX(lng), y = latToY(lat);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Mountain carets on mountain terrain.
    ctx.strokeStyle = 'rgba(60,48,36,0.6)';
    ctx.lineWidth = 1.4;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (lookup.get(`${col},${row}`).terrain !== 'mountain') continue;
        const [lng, lat] = hexCenter(col, row);
        const x = lngToX(lng), y = latToY(lat);
        const s = 6 + 4 * mtnNoise(col, row);
        ctx.beginPath();
        ctx.moveTo(x - s, y + s * 0.6);
        ctx.lineTo(x, y - s * 0.8);
        ctx.lineTo(x + s, y + s * 0.6);
        ctx.stroke();
      }
    }

    // Coastlines: outline every land hex edge that borders ocean (subtle).
    ctx.strokeStyle = 'rgba(20,30,40,0.35)';
    ctx.lineWidth = 1.2;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const me = lookup.get(`${col},${row}`);
        if (me.terrain === 'ocean') continue;
        const ring = hexPolygon(col, row);
        const edgeFor = { right: [0, 1], dl: [3, 4], dr: [5, 0] };
        for (const dir of ['right', 'dl', 'dr']) {
          const [nc, nr] = neighbourKey(col, row, dir);
          const nd = lookup.get(`${nc},${nr}`);
          if (!nd || nd.terrain === 'ocean') {
            const [a, b] = edgeFor[dir];
            ctx.beginPath();
            ctx.moveTo(lngToX(ring[a][0]), latToY(ring[a][1]));
            ctx.lineTo(lngToX(ring[b][0]), latToY(ring[b][1]));
            ctx.stroke();
          }
        }
      }
    }

    // Country borders — thick white lines between differing factions (political only).
    if (political) {
      ctx.strokeStyle = 'rgba(245,245,240,0.92)';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const me = lookup.get(`${col},${row}`).faction;
          if (!me) continue;
          const ring = hexPolygon(col, row);
          const edgeFor = { right: [0, 1], dl: [3, 4], dr: [5, 0] };
          for (const dir of ['right', 'dl', 'dr']) {
            const [nc, nr] = neighbourKey(col, row, dir);
            const nd = lookup.get(`${nc},${nr}`);
            const nf = nd ? nd.faction : null;
            if (me !== nf) {
              const [a, b] = edgeFor[dir];
              ctx.beginPath();
              ctx.moveTo(lngToX(ring[a][0]), latToY(ring[a][1]));
              ctx.lineTo(lngToX(ring[b][0]), latToY(ring[b][1]));
              ctx.stroke();
            }
          }
        }
      }
      ctx.setLineDash([]);
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 8;
    return tex;
  }

  const texPolitical = buildTexture(true);
  const texTerrain = buildTexture(false);

  // ── Three.js scene ────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.id = 'globe-canvas';
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 3.1);

  const material = new THREE.MeshPhongMaterial({ map: texPolitical, shininess: 4, specular: 0x222233 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 120, 120), material);
  scene.add(sphere);

  // Atmosphere rim.
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.045, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x4a90d0, transparent: true, opacity: 0.16,
      side: THREE.BackSide, blending: THREE.AdditiveBlending })
  );
  scene.add(atmo);

  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const dir = new THREE.DirectionalLight(0xfff4e0, 0.55);
  dir.position.set(-1, 0.7, 1.4);
  scene.add(dir);

  // ── lng/lat → 3D (matches Three's equirectangular UV mapping) ─────────────────
  function lnglatToVec3(lng, lat, R = 1) {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lng + 180) * Math.PI / 180;
    return new THREE.Vector3(
      -R * Math.sin(phi) * Math.cos(theta),
      R * Math.cos(phi),
      R * Math.sin(phi) * Math.sin(theta)
    );
  }
  // rotation.y that brings a given longitude to the front (+Z, facing camera)
  const frontRotationFor = lng => Math.PI / 2 - (lng + 180) * Math.PI / 180;

  // Start centred on the populated mid-continent.
  sphere.rotation.y = frontRotationFor(-20);

  let width, height;
  function resize() {
    const rect = container.getBoundingClientRect();
    width = rect.width; height = rect.height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderScene();
  }

  // ── Pins (projected DOM layer) ────────────────────────────────────────────────
  const pinLayer = document.createElement('div');
  pinLayer.id = 'pin-layer';
  container.appendChild(pinLayer);
  const TYPE_COLORS = { location: '#4a9eff', faction: '#e8a030', character: '#50c878' };
  let pins = [];

  function setPins(pinData, onClick) {
    pinLayer.innerHTML = '';
    pins = pinData.map(pin => {
      const col = parseInt(pin.hexAddress.slice(0, 2), 10);
      const row = parseInt(pin.hexAddress.slice(2, 4), 10);
      const [lng, lat] = hexCenter(col, row);
      const el = document.createElement('div');
      el.className = `pin pin-${pin.type}`;
      const c = TYPE_COLORS[pin.type] || '#fff';
      el.innerHTML =
        `<div class="pin-dot" style="background:${c};color:${c}"></div>` +
        `<div class="pin-label">${pin.label}</div>`;
      el.addEventListener('click', e => { e.stopPropagation(); onClick(pin); });
      pinLayer.appendChild(el);
      return { el, local: lnglatToVec3(lng, lat, 1) };
    });
    updatePins();
  }

  const _v = new THREE.Vector3();
  function updatePins() {
    sphere.updateMatrixWorld();
    for (const { el, local } of pins) {
      _v.copy(local).applyMatrix4(sphere.matrixWorld);
      // Visible only on the near hemisphere (facing the camera at +Z).
      const facing = _v.clone().normalize().dot(camera.position.clone().normalize());
      if (facing < 0.12) { el.style.display = 'none'; continue; }
      const p = _v.clone().project(camera);
      el.style.display = '';
      el.style.left = ((p.x * 0.5 + 0.5) * width) + 'px';
      el.style.top = ((-p.y * 0.5 + 0.5) * height) + 'px';
    }
  }

  function renderScene() {
    renderer.render(scene, camera);
    updatePins();
  }

  // ── Interaction: east-west drag, wheel zoom, animated panTo ──────────────────
  let dragging = false, lastX = 0;
  canvas.addEventListener('pointerdown', e => {
    dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    sphere.rotation.y += dx * 0.005; // east-west only
    renderScene();
  });
  canvas.addEventListener('pointerup', e => {
    dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch {}
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    camera.position.z *= e.deltaY < 0 ? 0.92 : 1.08;
    camera.position.z = Math.max(1.45, Math.min(5.5, camera.position.z));
    renderScene();
  }, { passive: false });

  function panTo(lng /*, lat ignored: east-west only */) {
    let target = frontRotationFor(lng);
    const cur = sphere.rotation.y;
    // choose nearest equivalent angle
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
      const col = parseInt(address.slice(0, 2), 10);
      const row = parseInt(address.slice(2, 4), 10);
      panTo(hexCenter(col, row)[0]);
    },
    invalidateSize: resize,
  };
}
