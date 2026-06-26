function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else if (val === 'true') val = true;
    else if (val === 'false') val = false;
    meta[key] = val;
  }
  return { meta, body: match[2] };
}

function badge(text, cls) {
  return `<span class="status-badge status-${cls}">${text}</span>`;
}

function metaRow(label, value) {
  if (!value) return '';
  return `<div class="meta-row"><span class="meta-label">${label}</span><span class="meta-value">${value}</span></div>`;
}

function slugLink(type, slug, label) {
  if (!slug) return label || '';
  return `<a onclick="window.__wiki.open('${type}','${slug}','${label || slug}')">${label || slug}</a>`;
}

function renderLocation(meta, body) {
  const statusCls = (meta.status || 'unknown').toLowerCase();
  return `
    <div class="article-type-badge badge-location">Location</div>
    <div class="article-title">${meta.title || ''}</div>
    ${meta.hexAddress ? `<div class="article-subtitle">Hex ${meta.hexAddress}</div>` : ''}
    <div class="meta-fields">
      ${meta.status ? metaRow('Status', badge(meta.status, statusCls)) : ''}
      ${meta.controllingFaction ? metaRow('Faction', slugLink('faction', meta.controllingFaction, meta.controllingFaction)) : ''}
      ${meta.terrainType ? metaRow('Terrain', meta.terrainType) : ''}
      ${meta.population ? metaRow('Population', meta.population) : ''}
      ${Array.isArray(meta.notableFeatures) && meta.notableFeatures.length
        ? metaRow('Features', meta.notableFeatures.join(', ')) : ''}
    </div>
    <div class="wiki-body">${marked.parse(body)}</div>
  `;
}

function renderFaction(meta, body) {
  const statusCls = (meta.status || 'active').toLowerCase();
  const hexLinks = Array.isArray(meta.territory)
    ? meta.territory.map(h => `<span style="color:var(--accent);font-size:11px">${h}</span>`).join(' ')
    : (meta.territory || '');
  const figures = Array.isArray(meta.keyFigures)
    ? meta.keyFigures.map(s => slugLink('character', s, s)).join(', ')
    : (meta.keyFigures || '');
  return `
    <div class="article-type-badge badge-faction">Faction</div>
    <div class="article-title">${meta.title || ''}</div>
    ${meta.shortName ? `<div class="article-subtitle">${meta.shortName}</div>` : ''}
    <div class="meta-fields">
      ${meta.status ? metaRow('Status', badge(meta.status, statusCls)) : ''}
      ${meta.allegiance ? metaRow('Allegiance', meta.allegiance) : ''}
      ${meta.resources ? metaRow('Resources', meta.resources) : ''}
      ${hexLinks ? metaRow('Territory', hexLinks) : ''}
      ${meta.mechManufacturer === true ? metaRow('Mech Mfr.', 'Yes') : ''}
      ${figures ? metaRow('Key Figures', figures) : ''}
    </div>
    <div class="wiki-body">${marked.parse(body)}</div>
  `;
}

function renderCharacter(meta, body) {
  const statusCls = (meta.status || 'active').toLowerCase();
  return `
    <div class="article-type-badge badge-character">Character</div>
    ${meta.callsign ? `<div class="article-title">"${meta.callsign}"</div>` : ''}
    <div class="article-title" style="font-size:16px;margin-top:2px">${meta.title || ''}</div>
    <div class="meta-fields">
      ${meta.status ? metaRow('Status', badge(meta.status, statusCls)) : ''}
      ${meta.role ? metaRow('Role', meta.role) : ''}
      ${meta.affiliation ? metaRow('Affiliation', slugLink('faction', meta.affiliation, meta.affiliation)) : ''}
      ${meta.currentLocation ? metaRow('Location', `Hex ${meta.currentLocation}`) : ''}
      ${meta.mech ? metaRow('Mech Frame', meta.mech) : ''}
      ${meta.licenseLevel != null ? metaRow('License Level', meta.licenseLevel) : ''}
    </div>
    <div class="wiki-body">${marked.parse(body)}</div>
  `;
}

const RENDERERS = {
  location: renderLocation,
  faction: renderFaction,
  character: renderCharacter,
};

export function initWiki(map, config) {
  const panel = document.getElementById('panel');
  const content = document.getElementById('wiki-content');
  const tab = document.getElementById('panel-tab');
  const closeBtn = document.getElementById('panel-close');

  const history = [];

  const wiki = {
    panelOpen() {
      panel.classList.add('open');
      setTimeout(() => map.invalidateSize(), 310);
    },
    panelClose() {
      panel.classList.remove('open');
      setTimeout(() => map.invalidateSize(), 310);
    },
    async open(type, slug, label) {
      history.push({ type, slug, label });
      await wiki._render(type, slug);
      wiki.panelOpen();
    },
    async _render(type, slug) {
      content.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:20px">Loading…</div>';
      try {
        const text = await fetch(`data/${type}s/${slug}.md`).then(r => {
          if (!r.ok) throw new Error('Not found');
          return r.text();
        });
        const { meta, body } = parseFrontmatter(text);
        const renderer = RENDERERS[type] || (() => `<div class="wiki-body">${marked.parse(body)}</div>`);
        const backBtn = history.length > 1
          ? `<button class="article-back" id="back-btn">← Back</button>`
          : '';
        content.innerHTML = `
          <div class="wiki-article">
            ${backBtn}
            <div class="article-header">${renderer(meta, body)}</div>
          </div>`;
        document.getElementById('back-btn')?.addEventListener('click', () => {
          history.pop();
          const prev = history[history.length - 1];
          if (prev) wiki._render(prev.type, prev.slug);
          else wiki.showHome();
        });
      } catch (e) {
        content.innerHTML = `<div class="wiki-body"><p style="color:var(--text-dim)">Entry not found.</p></div>`;
      }
    },
    showHome() {
      history.length = 0;
      content.innerHTML = `
        <div class="wiki-home">
          <h1 class="planet-name">Vanities</h1>
          <p class="planet-subtitle">Class: Terrestrial · Diameter: 10,230 km · Gravity: 1.05 G</p>
          <p class="planet-subtitle">Day: 28.7 hrs · Year: 421 Days · Population: 18.7 Billion</p>
          <div class="home-categories">
            <div class="home-category" data-category="locations"><span class="cat-icon">◎</span><span>Locations</span></div>
            <div class="home-category" data-category="factions"><span class="cat-icon">⬡</span><span>Factions</span></div>
            <div class="home-category" data-category="characters"><span class="cat-icon">◈</span><span>Characters</span></div>
          </div>
        </div>`;
      document.querySelectorAll('.home-category').forEach(btn => {
        btn.addEventListener('click', () => wiki.showCategory(btn.dataset.category));
      });
    },
    async showCategory(category) {
      history.length = 0;
      try {
        const index = await fetch(`data/${category}/index.json`).then(r => r.json());
        const typeKey = category.slice(0, -1); // remove trailing 's'
        const items = index.map(item => `
          <div class="category-list-item" data-type="${typeKey}" data-slug="${item.id}">
            <span class="item-title">${item.title}</span>
            ${item.tags ? `<span class="item-sub">${(Array.isArray(item.tags) ? item.tags : [item.tags]).slice(0, 2).join(' · ')}</span>` : ''}
          </div>`).join('');
        content.innerHTML = `
          <button class="category-list-back" id="cat-back">← Home</button>
          <div class="category-list-title">${category.charAt(0).toUpperCase() + category.slice(1)}</div>
          <div class="category-list">${items}</div>`;
        document.getElementById('cat-back').addEventListener('click', () => wiki.showHome());
        document.querySelectorAll('.category-list-item').forEach(el => {
          el.addEventListener('click', () => wiki.open(el.dataset.type, el.dataset.slug, el.querySelector('.item-title').textContent));
        });
      } catch {
        content.innerHTML = `<div class="wiki-body"><p style="color:var(--text-dim)">No entries found.</p></div>`;
      }
    },
  };

  tab.addEventListener('click', () => {
    if (panel.classList.contains('open')) wiki.panelClose();
    else wiki.panelOpen();
  });

  closeBtn.addEventListener('click', () => wiki.panelClose());

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') wiki.panelClose();
  });

  // Expose for inline onclick handlers
  window.__wiki = wiki;

  return wiki;
}
