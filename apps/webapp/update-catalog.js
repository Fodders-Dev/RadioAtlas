import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, 'public');

// Multiple endpoints to try
const SERVERS = [
    'https://de1.api.radio-browser.info',
    'https://nl1.api.radio-browser.info',
    'https://at1.api.radio-browser.info'
];

async function fetchCatalog() {
    console.log('Fetching radio catalog...');

    let data = null;
    for (const server of SERVERS) {
        try {
            console.log(`Trying ${server}...`);
            const response = await fetch(`${server}/json/stations/search?limit=100000&hidebroken=true&order=clickcount&reverse=true`, {
                timeout: 30000
            });
            if (response.ok) {
                data = await response.json();
                console.log(`Success! Fetched ${data.length} stations from ${server}`);
                break;
            }
        } catch (e) {
            console.error(`Failed ${server}: ${e.message}`);
        }
    }

    if (!data || !data.length) {
        console.error('Could not fetch stations from any server.');
        process.exit(1);
    }

    // Filter valid items
    const cleanData = data.filter(s => s.url && s.name && s.stationuuid).map(s => ({
        stationuuid: s.stationuuid,
        name: s.name.trim(),
        url: s.url,
        url_resolved: s.url_resolved || s.url,
        homepage: s.homepage,
        favicon: s.favicon,
        tags: s.tags,
        country: s.country,
        countrycode: s.countrycode,
        language: s.language,
        votes: s.votes,
        codec: s.codec,
        bitrate: s.bitrate
    }));

    // Save Full Catalog (Top 100k)
    const fullPath = path.join(PUBLIC_DIR, 'catalog-full.json');
    fs.writeFileSync(fullPath, JSON.stringify(cleanData));
    console.log(`Saved ${cleanData.length} stations to ${fullPath} (${(fs.statSync(fullPath).size / 1024 / 1024).toFixed(2)} MB)`);

    // Save Fast Catalog (Top 10k)
    const fastData = cleanData.slice(0, 10000);
    const fastPath = path.join(PUBLIC_DIR, 'catalog-fast.json');
    fs.writeFileSync(fastPath, JSON.stringify(fastData));
    console.log(`Saved ${fastData.length} stations to ${fastPath}`);
}

fetchCatalog();
