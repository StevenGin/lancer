#!/usr/bin/env node
// Usage: node scripts/new-page.js <type> "<Title>"
// Example: node scripts/new-page.js location "New Settlement"
// Types: location, faction, character

const fs = require('fs');
const path = require('path');

const [, , type, title] = process.argv;

if (!type || !title) {
  console.error('Usage: node scripts/new-page.js <type> "<Title>"');
  console.error('Types: location, faction, character');
  process.exit(1);
}

if (!['location', 'faction', 'character'].includes(type)) {
  console.error('Type must be: location, faction, or character');
  process.exit(1);
}

const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dir = path.join(__dirname, '..', 'data', type + 's');
const filePath = path.join(dir, `${slug}.md`);

if (fs.existsSync(filePath)) {
  console.error(`File already exists: ${filePath}`);
  process.exit(1);
}

const TEMPLATES = {
  location: `---
type: location
title: "${title}"
hexAddress: "0000"
status: controlled
controllingFaction:
population: "unknown"
terrainType: urban
notableFeatures: []
---

## Overview

Add location description here.

## Notes

Add your campaign notes here.
`,
  faction: `---
type: faction
title: "${title}"
shortName: ""
allegiance: independent
territory: []
resources: medium
mechManufacturer: false
status: active
---

## Overview

Add faction description here.

## Military

Describe military strength and doctrine.

## Relations

- **Other Faction**: Describe relationship.

## Notes

Add your campaign notes here.
`,
  character: `---
type: character
title: "${title}"
callsign: ""
role: pilot
affiliation:
currentLocation: "0000"
mech: ""
licenseLevel: 0
status: active
---

## Background

Add character background here.

## Notes

Add your campaign notes here.
`,
};

fs.writeFileSync(filePath, TEMPLATES[type]);

// Also add to index.json
const indexPath = path.join(dir, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
if (!index.find(e => e.id === slug)) {
  index.push({ id: slug, title, tags: [] });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`Added to ${type}s/index.json`);
}

console.log(`Created: ${filePath}`);
console.log(`Next steps:`);
console.log(`  1. Edit ${filePath} to fill in the details`);
console.log(`  2. Update the hexAddress field with the correct hex coordinate`);
console.log(`  3. Add a pin to data/pins.json`);
console.log(`  4. Run: node scripts/build-index.js`);
