import fetch from 'node-fetch';

async function findStations() {
    const q = 'Казак';
    console.log(`Searching for ${q}...`);
    const res = await fetch(`https://de1.api.radio-browser.info/json/stations/search?name=${encodeURIComponent(q)}`);
    const stations = await res.json();

    console.log(`Found ${stations.length} stations.`);
    stations.forEach(s => {
        console.log(`\nUUID: ${s.stationuuid}`);
        console.log(`Name: ${s.name}`);
        console.log(`URL: ${s.url}`);
        console.log(`Resolved: ${s.url_resolved}`);
    });
}

findStations();
