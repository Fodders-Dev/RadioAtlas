import fetch from 'node-fetch';

async function scanMetadata(url) {
    console.log(`Scanning metadata for ${url}...`);
    try {
        const controller = new AbortController();
        const response = await fetch(url, {
            headers: {
                'Icy-MetaData': '1',
                'User-Agent': 'VLC/3.0.0'
            },
            signal: controller.signal,
            redirect: 'manual'
        });

        if (response.status >= 300 && response.status < 400) {
            console.log(`Redirect to: ${response.headers.get('location')}`);
            // Follow manually if needed
            return;
        }

        const metaintHeader = response.headers.get('icy-metaint');
        if (!metaintHeader) {
            console.log('No metadata interval.');
            return;
        }

        const metaint = parseInt(metaintHeader);
        console.log(`MetaInt: ${metaint}`);

        let buffer = Buffer.alloc(0);
        const body = response.body;
        let blockCount = 0;

        body.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);

            while (buffer.length > metaint) {
                const lengthByte = buffer[metaint];
                const metaLen = lengthByte * 16;

                if (buffer.length < metaint + 1 + metaLen) {
                    break;
                }

                blockCount++;
                const metaBytes = buffer.slice(metaint + 1, metaint + 1 + metaLen);
                const text = metaBytes.toString('utf8').replace(/\0/g, '');

                if (metaLen > 0) {
                    console.log(`#${blockCount}: [${text}]`);
                } else {
                    // empty
                }

                buffer = buffer.slice(metaint + 1 + metaLen);

                if (blockCount > 5) {
                    console.log('\nDone scanning.');
                    controller.abort();
                    process.exit(0);
                }
            }
        });

    } catch (e) {
        console.log('Error:', e.message);
    }
}

scanMetadata('http://radio.kazak.fm/kazak_fm.mp3');
