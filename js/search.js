export async function initSearch(wiki) {
  let index = [];
  try {
    index = await fetch('data/search-index.json').then(r => r.json());
  } catch {
    return;
  }

  const fuse = new Fuse(index, {
    keys: ['title', 'tags', 'excerpt'],
    threshold: 0.35,
    minMatchCharLength: 2,
  });

  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = input.value.trim();
      if (!q) { results.classList.remove('visible'); return; }
      const hits = fuse.search(q).slice(0, 12);
      if (!hits.length) { results.classList.remove('visible'); return; }
      results.innerHTML = hits.map(({ item }) => `
        <div class="search-result" data-type="${item.type}" data-slug="${item.id}">
          <span class="result-type-badge badge-${item.type}">${item.type}</span>
          <span>${item.title}</span>
        </div>`).join('');
      results.classList.add('visible');
    }, 150);
  });

  results.addEventListener('click', e => {
    const el = e.target.closest('.search-result');
    if (!el) return;
    wiki.open(el.dataset.type, el.dataset.slug, el.querySelector('span:last-child').textContent);
    results.classList.remove('visible');
    input.value = '';
  });

  document.addEventListener('click', e => {
    if (!document.getElementById('search-wrap').contains(e.target)) {
      results.classList.remove('visible');
    }
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { results.classList.remove('visible'); input.value = ''; }
  });
}
