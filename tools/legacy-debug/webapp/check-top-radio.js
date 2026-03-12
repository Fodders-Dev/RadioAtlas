import fetch from 'node-fetch';

async function checkTopRadio() {
    const stationSlug = 'kazak-fm';
    const baseUrl = 'https://top-radio.ru';

    // Try common API patterns
    const endpoints = [
        `${baseUrl}/api/station/${stationSlug}`,
        `${baseUrl}/api/nowplaying/${stationSlug}`,
        `${baseUrl}/api/playlist/${stationSlug}`,
        `${baseUrl}/krasnodar/kazak-fm/playlist.json`,
        `${baseUrl}/krasnodar/kazak-fm/now.json`,
    ];

    for (const url of endpoints) {
        try {
            console.log(`Checking: ${url}`);
            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            console.log(`  Status: ${res.status}`);
            if (res.ok) {
                const text = await res.text();
                console.log(`  Response: ${text.slice(0, 500)}`);
            }
        } catch (e) {
            console.log(`  Error: ${e.message}`);
        }
    }

    // Also fetch the main page and look for XHR/fetch calls
    console.log('\nFetching main page to analyze...');
    try {
        const res = await fetch(`${baseUrl}/krasnodar/kazak-fm`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const html = await res.text();

        // Look for API endpoints in the HTML/JS
        const apiMatches = html.match(/["'](\/api\/[^"']+)["']/g);
        console.log('Found API patterns:', apiMatches ? [...new Set(apiMatches)].slice(0, 10) : 'None');

        // Look for JSON data embedded
        const jsonMatches = html.match(/\{[^{}]*"now_playing"[^{}]*\}/g);
        console.log('Found now_playing JSON:', jsonMatches ? jsonMatches[0]?.slice(0, 200) : 'None');

        // Look for playlist data
        const playlistMatch = html.match(/playlist['":\s]+(\[[^\]]+\])/i);
        console.log('Found playlist array:', playlistMatch ? playlistMatch[0].slice(0, 200) : 'None');

    } catch (e) {
        console.log('Error:', e.message);
    }
}

checkTopRadio();
