#!/usr/bin/env node
// Run before publishing: node scripts/build-index.js
// Reads all MD files in data/{locations,factions,characters}/
// Writes data/search-index.json

const fs = require('fs');
const path = require('path');

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
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    meta[key] = val;
  }
  return { meta, body: match[2] };
}

const TYPES = ['locations', 'countries', 'factions', 'characters'];
const SINGULAR = { locations: 'location', countries: 'country', factions: 'faction', characters: 'character' };
const dataDir = path.join(__dirname, '..', 'data');
const index = [];

for (const category of TYPES) {
  const dir = path.join(dataDir, category);
  if (!fs.existsSync(dir)) continue;
  const type = SINGULAR[category];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const id = file.replace('.md', '');
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const { meta, body } = parseFrontmatter(text);

    // Extract plain text excerpt (first 200 chars of body, stripped of Markdown)
    const excerpt = body
      .replace(/#+\s*/g, '')
      .replace(/[*_`]/g, '')
      .replace(/\n+/g, ' ')
      .trim()
      .slice(0, 200);

    const tags = meta.tags
      ? (Array.isArray(meta.tags) ? meta.tags : [meta.tags])
      : [];

    index.push({
      id,
      type,
      title: meta.title || id,
      tags,
      excerpt,
    });
  }
}

// Also pull from index.json files for any entries without MD files
for (const category of TYPES) {
  const indexFile = path.join(dataDir, category, 'index.json');
  if (!fs.existsSync(indexFile)) continue;
  const type = SINGULAR[category];
  const entries = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  for (const entry of entries) {
    if (!index.find(i => i.id === entry.id && i.type === type)) {
      index.push({
        id: entry.id,
        type,
        title: entry.title || entry.id,
        tags: Array.isArray(entry.tags) ? entry.tags : (entry.tags ? [entry.tags] : []),
        excerpt: '',
      });
    }
  }
}

const outPath = path.join(dataDir, 'search-index.json');
fs.writeFileSync(outPath, JSON.stringify(index, null, 2));
console.log(`Search index built: ${index.length} entries → ${outPath}`);
