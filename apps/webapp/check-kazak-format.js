import fetch from 'node-fetch';

async function checkMetadataFormat(url) {
    console.log(`Inspecting metadata for ${url}...`);
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
        console.log('MetaInt:', metaintHeader);

        if (!metaintHeader) {
            console.log('No metadata interval found.');
            controller.abort();
            return;
        }

        const metaint = parseInt(metaintHeader);
        const body = response.body;

        let buffer = Buffer.alloc(0);

        body.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);

            if (buffer.length > metaint + 256) {
                // We have enough data to find the metadata block
                const lengthByte = buffer[metaint];
                const metaLen = lengthByte * 16;

                console.log(`\n--- Metadata Block Info ---`);
                console.log(`Byte at offset ${metaint} is: ${lengthByte} (0x${lengthByte.toString(16)})`);
                console.log(`Calculated Meta Length: ${metaLen} bytes`);

                if (metaLen > 0) {
                    if (buffer.length >= metaint + 1 + metaLen) {
                        const metaBytes = buffer.slice(metaint + 1, metaint + 1 + metaLen);
                        console.log('\nRaw RAW (Hex):');
                        console.log(metaBytes.toString('hex'));
                        console.log('\nRaw RAW (String):');
                        console.log(`"${metaBytes.toString('utf8')}"`);

                        controller.abort();
                        process.exit(0);
                    }
                } else {
                    console.log('Metadata block is empty (len=0). Waiting for next block is hard in this simple script.');
                    // In a real stream, we'd slice off the first block and audio and wait for the next `metaint` bytes.
                    // But for this debug, maybe we just got unlucky and hit an empty block.
                    // Let's try to advance? No, easier to just run it again maybe.
                    controller.abort();
                    process.exit(0);
                }
            }
        });

    } catch (e) {
        console.log('Error:', e.message);
    }
}

checkMetadataFormat('https://radio.kazak.fm/kazak_fm.mp3');
