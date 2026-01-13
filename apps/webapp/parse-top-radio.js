import fetch from 'node-fetch';

// Mapping from Radio Browser station names/URLs to top-radio.ru slugs
const TOP_RADIO_MAPPING = {
    'kazak.fm': 'kazak-fm',
    'казак': 'kazak-fm',
    // Add more mappings as needed
};

function getTopRadioSlug(stationName, streamUrl) {
    // Try to match by URL
    for (const [key, slug] of Object.entries(TOP_RADIO_MAPPING)) {
        if (streamUrl?.toLowerCase().includes(key) || stationName?.toLowerCase().includes(key)) {
            return slug;
        }
    }
    return null;
}

async function fetchFromTopRadio(slug) {
    const url = `https://top-radio.ru/playlist/${slug}`;

    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (!res.ok) return null;

        const html = await res.text();

        // Find the playList section
        const playlistMatch = html.match(/id="playList"[^>]*>([\s\S]*?)<\/ul>/i);
        if (!playlistMatch) return null;

        // Get the first track (most recent)
        const firstTrack = playlistMatch[1].match(/<li[^>]*>([\s\S]*?)<\/li>/i);
        if (!firstTrack) return null;

        // Extract artist and song from the track
        const artistMatch = firstTrack[1].match(/class="artist"[^>]*>([^<]+)/i);
        const songMatch = firstTrack[1].match(/class="song"[^>]*>([^<]+)/i);

        if (artistMatch && songMatch) {
            const artist = artistMatch[1].trim();
            const song = songMatch[1].trim();
            return `${artist} - ${song}`;
        }

        // Fallback: try to extract from text pattern
        const textMatch = firstTrack[1].replace(/<[^>]+>/g, ' ').match(/\d{1,2}:\d{2}\s+&shy;\s+(.+)/);
        if (textMatch) {
            return textMatch[1].trim();
        }

    } catch (e) {
        console.log('TopRadio error:', e.message);
    }

    return null;
}

// Test
async function test() {
    const track = await fetchFromTopRadio('kazak-fm');
    console.log('Current track:', track);
}

test();
