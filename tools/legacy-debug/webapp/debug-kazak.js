import fetch from 'node-fetch';

async function debugStation(url) {
    console.log(`\n--- Debugging ${url} ---`);

    // 1. Check Stream Headers
    try {
        const res = await fetch(url, { method: 'HEAD' });
        console.log(`Stream HEAD: ${res.status}`);
        console.log('Server:', res.headers.get('server'));
        console.log('Icy-MetaInt:', res.headers.get('icy-metaint'));
    } catch (e) {
        console.log('HEAD failed:', e.message);
    }

    const urlObj = new URL(url);
    const origin = urlObj.origin;

    // 2. Check JSON status
    const jsonUrl = `${origin}/status-json.xsl`;
    try {
        const res = await fetch(jsonUrl);
        console.log(`JSON Status (${jsonUrl}): ${res.status}`);
        if (res.ok) {
            console.log('Content-Type:', res.headers.get('content-type'));
            // console.log(await res.text()); 
        }
    } catch (e) { console.log('JSON fetch failed'); }

    // 3. Check XSL status
    const xslUrl = `${origin}/status.xsl`;
    try {
        const res = await fetch(xslUrl);
        console.log(`XSL Status (${xslUrl}): ${res.status}`);
    } catch (e) { console.log('XSL fetch failed'); }

    // 4. Check Root
    try {
        const res = await fetch(origin);
        console.log(`Root Status (${origin}): ${res.status}`);
    } catch (e) { console.log('Root fetch failed'); }

}

debugStation('https://radio.kazak.fm/kazak_fm.mp3');
