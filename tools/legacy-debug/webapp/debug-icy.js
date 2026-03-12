import fetch from 'node-fetch';

const STREAM_TITLE = /StreamTitle='([^']+)'/i;

async function checkIcy(url) {
    console.log(`Checking Icy Metadata for ${url}...`);
    try {
        const controller = new AbortController();
        const response = await fetch(url, {
            headers: { 'Icy-MetaData': '1', 'User-Agent': 'VLC/3.0.0' },
            signal: controller.signal
        });

        const metaint = response.headers.get('icy-metaint');
        console.log('MetaInt:', metaint);

        if (!metaint) {
            console.log('No metadata interval found.');
            controller.abort();
            return;
        }

        const reader = response.body;
        let bytesRead = 0;
        const interval = parseInt(metaint);

        reader.on('data', (chunk) => {
            // console.log(`Received chunk ${chunk.length}`);
            // This is a naive check just to see if we get *some* data
            // For a proper test we'd need a buffer parser like in the app
            // But let's just see if we can find the string "StreamTitle" in the raw dump
            // (It might be slightly misaligned but it usually shows up)

            const str = chunk.toString('utf8'); // naive decoding
            const match = str.match(STREAM_TITLE);
            if (match) {
                console.log('✅ FOUND TITLE:', match[1]);
                controller.abort();
                process.exit(0);
            }
            bytesRead += chunk.length;
            if (bytesRead > 200000) { // stop after 200kb
                console.log('Gave up after 200KB');
                controller.abort();
                process.exit(0);
            }
        });

    } catch (e) {
        console.log('Error:', e.message);
    }
}

checkIcy('https://radio.kazak.fm/kazak_fm.mp3');
