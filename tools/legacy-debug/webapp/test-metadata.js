import fetch from 'node-fetch';

const stations = [
    { name: 'Kazak FM', url: 'https://radio.kazak.fm/kazak_fm.mp3' },
    { name: 'Radio Record', url: 'https://radiorecord.hostingradio.ru/rr_main96.aacp' },
    { name: 'Nightride FM', url: 'https://stream.nightride.fm/nightride.m3u8' }, // Special case
    // Add more if needed
];

const buildTrack = (artist, title) => {
    const parts = [artist, title].filter(Boolean);
    if (!parts.length) return null;
    return parts.join(' - ');
};

const fetchWithTimeout = async (url, ms = 4000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, { signal: controller.signal });
        return res;
    } finally {
        clearTimeout(id);
    }
};

const fetchIcecast = async (origin, path) => {
    const target = `${origin}/status-json.xsl`;
    try {
        console.log(`Checking Icecast: ${target}`);
        const res = await fetchWithTimeout(target);
        if (!res.ok) return null;
        const data = await res.json();
        const source = data?.icestats?.source;
        if (!source) return null;

        const sources = Array.isArray(source) ? source : [source];
        // console.log('Sources found:', sources.length);

        // Try to match the specific mount point
        const match = sources.find((s) =>
            s.listenurl?.endsWith(path) ||
            s.listenurl?.includes(path)
        );
        const best = match || sources[0];

        if (best) {
            console.log('Icecast Match:', best.listenurl);
            if (best.artist && best.title) return buildTrack(best.artist, best.title);
            if (best.title) return best.title;
        }
    } catch (e) {
        // console.log('Icecast check failed:', e.message);
    }
    return null;
};

const fetchShoutcast = async (origin) => {
    const target = `${origin}/7.html`;
    try {
        console.log(`Checking Shoutcast: ${target}`);
        const res = await fetchWithTimeout(target);
        if (!res.ok) return null;
        const text = await res.text();

        const bodyMatch = text.match(/<body[^>]*>(.*?)<\/body>/i);
        const content = bodyMatch ? bodyMatch[1] : text;

        const parts = content.split(',');
        if (parts.length >= 7) {
            return parts[6] || null;
        }
    } catch (e) {
        // console.log('Shoutcast check failed:', e.message);
    }
    return null;
};

async function test() {
    for (const station of stations) {
        console.log(`\nTesting ${station.name} (${station.url})...`);

        try {
            const urlObj = new URL(station.url);
            const origin = urlObj.origin;
            const path = urlObj.pathname;

            const icecast = await fetchIcecast(origin, path);
            if (icecast) {
                console.log(`✅ FOUND (Icecast): ${icecast}`);
                continue;
            }

            const shoutcast = await fetchShoutcast(origin);
            if (shoutcast) {
                console.log(`✅ FOUND (Shoutcast): ${shoutcast}`);
                continue;
            }

            console.log('❌ NOT FOUND via standard status pages');
        } catch (e) {
            console.log('Error:', e.message);
        }
    }
}

test();
