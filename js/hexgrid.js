export function hexAddressToPixel(address, config) {
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

function hexVertices(col, row, config) {
  const { circumradius: R, originPixelX: ox, originPixelY: oy } = config.hex;
  const colSpacing = R * Math.sqrt(3);
  const rowSpacing = R * 1.5;
  const cx = ox + col * colSpacing + (row % 2) * (colSpacing / 2);
  const cy = oy + row * rowSpacing;
  const verts = [];
  for (let i = 0; i < 6; i++) {
    // Pointy-top: first vertex at 30° (top-right)
    const angle = (Math.PI / 180) * (60 * i - 30);
    // Convert pixel (cx + dx, cy + dy) to Leaflet latLng(-py, px)
    verts.push([-(cy + R * Math.sin(angle)), cx + R * Math.cos(angle)]);
  }
  return verts;
}

export function initHexGrid(map, config) {
  const { circumradius: R, originPixelX: ox, originPixelY: oy, columns, rows } = config.hex;
  const colSpacing = R * Math.sqrt(3);
  const rowSpacing = R * 1.5;
  const HEX_ZOOM_THRESHOLD = config.hexZoomThreshold ?? -1;

  const hexLayer = L.layerGroup().addTo(map);
  let drawTimeout = null;

  function redraw() {
    hexLayer.clearLayers();
    if (map.getZoom() < HEX_ZOOM_THRESHOLD) return;

    const b = map.getBounds();
    const minX = b.getWest();
    const maxX = b.getEast();
    const minY = -b.getNorth();
    const maxY = -b.getSouth();

    // Compute visible row/col range
    const rowMin = Math.max(0, Math.floor((minY - oy - R) / rowSpacing));
    const rowMax = Math.min(rows - 1, Math.ceil((maxY - oy + R) / rowSpacing));

    for (let row = rowMin; row <= rowMax; row++) {
      const offset = (row % 2) * (colSpacing / 2);
      const colMin = Math.max(0, Math.floor((minX - ox - offset - R) / colSpacing));
      const colMax = Math.min(columns - 1, Math.ceil((maxX - ox - offset + R) / colSpacing));

      for (let col = colMin; col <= colMax; col++) {
        L.polygon(hexVertices(col, row, config), {
          color: '#c9a84c',
          weight: 0.6,
          opacity: 0.2,
          fill: false,
          interactive: false,
        }).addTo(hexLayer);
      }
    }
  }

  map.on('moveend zoomend', () => {
    clearTimeout(drawTimeout);
    drawTimeout = setTimeout(redraw, 80);
  });

  redraw();
}
