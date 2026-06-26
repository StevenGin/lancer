import { initHexGrid } from './hexgrid.js';
import { initPins } from './pins.js';
import { initWiki } from './wiki.js';
import { initSearch } from './search.js';

async function main() {
  const config = await fetch('data/config.json').then(r => r.json());

  const { globe: g, mapWidth: W, mapHeight: H } = config;

  const map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: config.minZoom ?? -3,
    maxZoom: config.maxZoom ?? 3,
    zoomControl: true,
    attributionControl: false,
  });

  // Globe hemisphere view: zoom so globe height fills ~90% of screen height,
  // then only ~half the globe width is visible at once. East-west panning reveals more.
  const globeDiameter = g.r * 2;
  const initZoom = Math.log2((window.innerHeight * 0.9) / globeDiameter);
  map.setView(L.latLng(-g.cy, g.cx), initZoom);

  // Constrain north-south to just beyond the globe; east-west to one globe-width of padding
  const vPad = 40, hPad = g.r * 0.6;
  map.setMaxBounds([
    [-(g.cy + g.r + vPad), g.cx - g.r - hPad],
    [-(g.cy - g.r - vPad), g.cx + g.r + hPad],
  ]);

  // Hide pin labels when zoomed out far
  map.on('zoomend', () => {
    const el = document.getElementById('map');
    if (map.getZoom() < (config.labelZoomThreshold ?? -1)) {
      el.classList.add('labels-hidden');
    } else {
      el.classList.remove('labels-hidden');
    }
  });

  const wiki = initWiki(map, config);

  const hexGrid = await initHexGrid(map, config);

  // Tint toggle button
  const tintBtn = document.getElementById('tint-toggle');
  if (tintBtn) {
    tintBtn.addEventListener('click', () => {
      const on = hexGrid.toggleTint();
      tintBtn.classList.toggle('active', on);
      tintBtn.title = on ? 'Hide faction tint' : 'Show faction tint';
    });
  }
  await initPins(map, config, wiki);
  await initSearch(wiki);

  // Home category buttons
  document.querySelectorAll('.home-category').forEach(btn => {
    btn.addEventListener('click', () => {
      wiki.showCategory(btn.dataset.category);
    });
  });

  // Dev mode: click map to get hex address
  const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isDev) {
    const tooltip = document.getElementById('dev-tooltip');
    map.on('click', e => {
      const px = e.latlng.lng;
      const py = -e.latlng.lat;
      const addr = pixelToHexAddress(px, py, config);
      const cx = hexCenter(addr, config);
      tooltip.style.display = 'block';
      tooltip.innerHTML = `<strong>[DEV]</strong> hex: <strong>${addr}</strong> &nbsp; pixel: ${Math.round(cx.x)}, ${Math.round(cx.y)}`;
      setTimeout(() => { tooltip.style.display = 'none'; }, 4000);
    });
  }
}

// Exposed globally for dev mode use
function pixelToHexAddress(px, py, config) {
  const { circumradius: R, originPixelX: ox, originPixelY: oy } = config.hex;
  const colSpacing = R * Math.sqrt(3);
  const rowSpacing = R * 1.5;
  const row = Math.round((py - oy) / rowSpacing);
  const rowClamped = Math.max(0, Math.min(config.hex.rows - 1, row));
  const offset = (rowClamped % 2) * (colSpacing / 2);
  const col = Math.round((px - ox - offset) / colSpacing);
  const colClamped = Math.max(0, Math.min(config.hex.columns - 1, col));
  return String(colClamped).padStart(2, '0') + String(rowClamped).padStart(2, '0');
}

function hexCenter(address, config) {
  const col = parseInt(address.slice(0, 2));
  const row = parseInt(address.slice(2, 4));
  const { circumradius: R, originPixelX: ox, originPixelY: oy } = config.hex;
  const colSpacing = R * Math.sqrt(3);
  const rowSpacing = R * 1.5;
  return {
    x: ox + col * colSpacing + (row % 2) * (colSpacing / 2),
    y: oy + row * rowSpacing,
  };
}

main().catch(console.error);
