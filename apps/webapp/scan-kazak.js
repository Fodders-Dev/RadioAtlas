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
            signal: controller.signal
        });

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
                // Process one block cycle
                const lengthByte = buffer[metaint];
                const metaLen = lengthByte * 16;

                if (buffer.length < metaint + 1 + metaLen) {
                    // Need more data for the metadata block
                    break;
                }

                // Extract metadata
                blockCount++;
                const metaBytes = buffer.slice(metaint + 1, metaint + 1 + metaLen);
                const text = metaBytes.toString('utf8').replace(/\0/g, ''); // content

                if (metaLen > 0) {
                    console.log(`#${blockCount}: [${text}]`);
                } else {
                    //   process.stdout.write('.');
                }

                // Cut buffer: Remove (audio chunk + length byte + metadata bytes)
                // But wait, the standard is: [audio metaint bytes] [length byte] [metadata] [audio metaint bytes]...
                // So we slice off the processed part.
                buffer = buffer.slice(metaint + 1 + metaLen);

                if (blockCount > 20) {
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

scanMetadata('https://radio.kazak.fm/kazak_fm.mp3');
