import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const handler = async (event) => {
    console.time('Total time');
    console.log('Handler function started');
    const body = JSON.parse(event.body);
    const url = body.url;

    if (!url) {
        console.timeEnd('Total time');
        console.error('URL is required');
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "URL is required" }),
        };
    }

    const childProcessPath = path.resolve(__dirname, 'puWorker.mjs');

    return new Promise((resolve, reject) => {
        const child = fork(childProcessPath, [`--input-data=${Buffer.from(JSON.stringify({ url })).toString('base64')}`]);

        child.on('message', (message) => {
            console.timeEnd('Total time');
            if (message.error) {
                reject({
                    statusCode: 500,
                    body: JSON.stringify({ error: message.error }),
                });
            } else {
                resolve({
                    statusCode: 200,
                    body: JSON.stringify(message),
                });
            }
        });

        child.on('error', (error) => {
            console.timeEnd('Total time');
            reject({
                statusCode: 500,
                body: JSON.stringify({ error: error.message }),
            });
        });

        child.on('exit', (code) => {
            if (code !== 0) {
                console.timeEnd('Total time');
                reject({
                    statusCode: 500,
                    body: JSON.stringify({ error: `Child process exited with code ${code}` }),
                });
            }
        });
    });
};
