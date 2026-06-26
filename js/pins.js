import { hexAddressToPixel } from './hexgrid.js';

const TYPE_COLORS = {
  location: '#4a9eff',
  faction: '#e8a030',
  character: '#50c878',
};

export async function initPins(map, config, wiki) {
  const pins = await fetch('data/pins.json').then(r => r.json());

  for (const pin of pins) {
    let px, py;
    if (pin.pixelX != null && pin.pixelY != null) {
      px = pin.pixelX;
      py = pin.pixelY;
    } else {
      const center = hexAddressToPixel(pin.hexAddress, config);
      px = center.x;
      py = center.y;
    }

    const color = TYPE_COLORS[pin.type] || '#ffffff';

    const icon = L.divIcon({
      className: `pin pin-${pin.type}`,
      html: `<div class="pin-dot" style="background:${color};color:${color}"></div>`
          + `<div class="pin-label">${pin.label}</div>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    });

    L.marker([-py, px], { icon, title: pin.label })
      .addTo(map)
      .on('click', () => {
        wiki.open(pin.type, pin.slug, pin.label);
        wiki.panelOpen();
      });
  }
}
