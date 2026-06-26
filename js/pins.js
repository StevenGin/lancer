// Loads pins and hands them to the globe, which projects them onto the sphere
// and hides any that fall on the far hemisphere.
export async function initPins(globe, config, wiki) {
  const pins = await fetch('data/pins.json').then(r => r.json());
  globe.setPins(pins, pin => {
    wiki.open(pin.type, pin.slug, pin.label);
    wiki.panelOpen();
  });
}
