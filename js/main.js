import { initGlobe } from './globe.js';
import { initPins } from './pins.js';
import { initWiki } from './wiki.js';
import { initSearch } from './search.js';

async function main() {
  const config = await fetch('data/config.json').then(r => r.json());

  const container = document.getElementById('map');
  const globe = await initGlobe(container, config);

  // Wiki + search operate against the globe (panTo / invalidateSize compatible API).
  const wiki = initWiki(globe, config);
  await initPins(globe, config, wiki);
  await initSearch(wiki);

  // Clicking a country label (far zoom) opens its country wiki entry.
  globe.onCountry((slug, name) => {
    wiki.open('country', slug, name);
    wiki.panelOpen();
  });

  // Clicking the orbiting starship opens the Caladrius faction page.
  globe.onShip(() => {
    wiki.open('faction', 'caladrius', 'Caladrius');
    wiki.panelOpen();
  });

  // Terrain/country toggle (default view is country colours).
  const tintBtn = document.getElementById('tint-toggle');
  if (tintBtn) {
    tintBtn.classList.add('active');
    tintBtn.title = 'Show terrain';
    tintBtn.addEventListener('click', () => {
      const on = globe.toggleTint();
      tintBtn.classList.toggle('active', on);
      tintBtn.title = on ? 'Show terrain' : 'Show country colours';
    });
  }

  // Home category buttons.
  document.querySelectorAll('.home-category').forEach(btn => {
    btn.addEventListener('click', () => wiki.showCategory(btn.dataset.category));
  });
}

main().catch(console.error);
