import fetch from 'node-fetch';

async function checkSite() {
    console.log('Checking http status...');
    try {
        const res = await fetch('http://radio.kazak.fm/status-json.xsl');
        console.log(`HTTP status-json: ${res.status}`);
        if (res.ok) console.log(await res.text());
    } catch (e) { console.log('HTTP fail:', e.message); }

    console.log('Fetching main site...');
    try {
        const res = await fetch('https://kazak.fm');
        const text = await res.text();
        console.log(`Site length: ${text.length}`);

        const apiMatches = text.match(/https?:\/\/[^"']+\.(json|php)/g);
        console.log('Potential APIs:', apiMatches ? apiMatches.slice(0, 10) : 'None');

        // Look for "artist" or "title" or "now" keywords
        // Naive grep
    } catch (e) { console.log('Site fetch fail:', e.message); }

    // Try another common one:
    try {
        const res = await fetch('https://kazak.fm/api/nowplaying');
        console.log(`Guess /api/nowplaying: ${res.status}`);
    } catch (e) { }
}

checkSite();
