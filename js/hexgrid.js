// ── Terrain base colours (dark sci-fi palette) ──────────────────────────────
const TERRAIN_FILL = {
  ocean:      '#0c1a2e',
  polar:      '#22303e',
  grassland:  '#1e2e14',
  forest:     '#162414',
  desert:     '#312214',
  mountain:   '#221e1a',
  industrial: '#1a182a',
  urban:      '#201828',
  coastal:    '#102030',
};

// ── Faction tint colours (semi-transparent, shown when tint is on) ───────────
const FACTION_TINT = {
  'northreach-confederacy': 'rgba(55,100,28,0.42)',
  'veltora-federation':     'rgba(70,30,105,0.42)',
  'smogspire-union':        'rgba(55,50,70,0.42)',
  'duneward-coalition':     'rgba(110,75,20,0.42)',
  'greenvale-republic':     'rgba(42,85,25,0.42)',
  'farreach-league':        'rgba(24,65,30,0.42)',
  'stoneview-commonwealth': 'rgba(48,55,58,0.42)',
  'brightmarch-union':      'rgba(80,28,20,0.42)',
  'rustcoast-confederacy':  'rgba(90,45,14,0.42)',
  'lakeside-union':         'rgba(18,58,72,0.42)',
  'southpoint-league':      'rgba(22,68,55,0.42)',
};

// ── Hex math ─────────────────────────────────────────────────────────────────
export function hexAddressToPixel(address, config) {
  const col = parseInt(address.slice(0, 2));
  const row = parseInt(address.slice(2, 4));
  return hexCenter(col, row, config);
}

function hexCenter(col, row, config) {
  const { circumradius: R, originPixelX: ox, originPixelY: oy } = config.hex;
  const cs = R * Math.sqrt(3);
  return {
    x: ox + col * cs + (row % 2) * (cs / 2),
    y: oy + row * R * 1.5,
  };
}

// Returns 6 Leaflet [lat,lng] pairs (with y-flipped for CRS.Simple)
function hexVerts(col, row, config) {
  const { x: cx, y: cy } = hexCenter(col, row, config);
  const R = config.hex.circumradius;
  const verts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    verts.push([-(cy + R * Math.sin(a)), cx + R * Math.cos(a)]);
  }
  return verts;
}

// Odd-r offset neighbour directions
function neighbour(col, row, dir) {
  const even = row % 2 === 0;
  const DIRS = even
    ? [[1,0],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1]]
    : [[1,0],[1,-1],[0,-1],[-1,0],[0,1],[1,1]];
  return [col + DIRS[dir][0], row + DIRS[dir][1]];
}

// ── Territory lookup ─────────────────────────────────────────────────────────
function buildLookup(zones, config) {
  const { circumradius: R, originPixelX: ox, originPixelY: oy, columns, rows } = config.hex;
  const cs = R * Math.sqrt(3), rs = R * 1.5;
  const { cx: gcx, cy: gcy, r: gr } = config.globe;
  const map = new Map();

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const px = ox + col * cs + (row % 2) * (cs / 2);
      const py = oy + row * rs;
      const dx = px - gcx, dy = py - gcy;
      if (dx * dx + dy * dy > gr * gr) continue; // outside globe → void

      let entry = { terrain: 'ocean', faction: null };
      for (const z of zones) {
        if (row >= z.rMin && row <= z.rMax && col >= z.cMin && col <= z.cMax) {
          entry = { terrain: z.terrain, faction: z.faction || null };
        }
      }
      map.set(`${col},${row}`, entry);
    }
  }
  return map;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function initHexGrid(map, config) {
  const zones = await fetch('data/territories.json').then(r => r.json());
  const lookup = buildLookup(zones, config);

  const HEX_ZOOM_THRESHOLD = config.hexZoomThreshold ?? -1;
  const terrainLayer  = L.layerGroup().addTo(map);
  const tintLayer     = L.layerGroup().addTo(map);
  const borderLayer   = L.layerGroup().addTo(map);

  let showTint = true;
  let drawTimeout = null;

  function redraw() {
    terrainLayer.clearLayers();
    tintLayer.clearLayers();
    borderLayer.clearLayers();

    const zoom = map.getZoom();
    const b = map.getBounds();
    const { circumradius: R, originPixelX: ox, originPixelY: oy, columns, rows } = config.hex;
    const cs = R * Math.sqrt(3), rs = R * 1.5;

    // Visible row/col range
    const minX = b.getWest(), maxX = b.getEast();
    const minY = -b.getNorth(), maxY = -b.getSouth();
    const rowMin = Math.max(0, Math.floor((minY - oy - R) / rs));
    const rowMax = Math.min(rows - 1, Math.ceil((maxY - oy + R) / rs));

    const drawnBorders = new Set();

    for (let row = rowMin; row <= rowMax; row++) {
      const offset = (row % 2) * (cs / 2);
      const colMin = Math.max(0, Math.floor((minX - ox - offset - R) / cs));
      const colMax = Math.min(columns - 1, Math.ceil((maxX - ox - offset + R) / cs));

      for (let col = colMin; col <= colMax; col++) {
        const key = `${col},${row}`;
        const data = lookup.get(key);
        if (!data) continue; // void (outside globe)

        const verts = hexVerts(col, row, config);
        const fill = TERRAIN_FILL[data.terrain] || '#0c1a2e';

        // Terrain fill
        L.polygon(verts, {
          color: 'transparent', weight: 0,
          fillColor: fill, fillOpacity: 1,
          interactive: false,
        }).addTo(terrainLayer);

        // Faction tint overlay
        if (showTint && data.faction) {
          const tintCol = FACTION_TINT[data.faction] || 'rgba(255,255,255,0.1)';
          L.polygon(verts, {
            color: 'transparent', weight: 0,
            fillColor: tintCol.replace(/rgba?\([^)]+\)/, m => m),
            fillOpacity: 1,
            // Leaflet doesn't take rgba for fillColor directly — use fillColor+fillOpacity separately
            interactive: false,
          }).addTo(tintLayer);
        }

        // Hex grid lines (thin, only when zoomed in)
        if (zoom >= HEX_ZOOM_THRESHOLD) {
          L.polygon(verts, {
            color: '#1a2030', weight: 0.5, opacity: 0.4,
            fill: false, interactive: false,
          }).addTo(terrainLayer);
        }

        // Faction borders: draw edges 3,4,5 (left/lower-left/lower-right)
        // to cover each shared edge exactly once
        for (let dir = 3; dir <= 5; dir++) {
          const [nc, nr] = neighbour(col, row, dir);
          const nKey = `${nc},${nr}`;
          const nData = lookup.get(nKey);
          const nFaction = nData ? nData.faction : null;
          const myFaction = data.faction;

          const isBorder = myFaction !== nFaction && (myFaction || nFaction);
          if (!isBorder) continue;

          const edgeKey = [key, nKey].sort().join('|');
          if (drawnBorders.has(edgeKey)) continue;
          drawnBorders.add(edgeKey);

          // Edge vertices: dir=3→v3-v4, dir=4→v4-v5, dir=5→v5-v0
          const edgeIdxMap = { 3: [3, 4], 4: [4, 5], 5: [5, 0] };
          const [i0, i1] = edgeIdxMap[dir];
          L.polyline([verts[i0], verts[i1]], {
            color: '#c9a84c',
            weight: 1.8,
            opacity: 0.75,
            dashArray: '5 4',
            interactive: false,
          }).addTo(borderLayer);
        }
      }
    }
  }

  map.on('moveend zoomend', () => {
    clearTimeout(drawTimeout);
    drawTimeout = setTimeout(redraw, 80);
  });
  redraw();

  return {
    toggleTint() {
      showTint = !showTint;
      redraw();
      return showTint;
    },
  };
}
