import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    try {
        const inpDataB64 = process.argv.find((a) => a.startsWith('--input-data')).replace('--input-data=', '');
        const inputData = JSON.parse(Buffer.from(inpDataB64, 'base64').toString());

        const browser = await puppeteer.launch({
            args: [
                ...chromium.args,
                '--start-fullscreen',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-infobars',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials',
                '--disable-features=BlockInsecurePrivateNetworkRequests'
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(
                'https://github.com/SeSorKh/Chromium-Aws/raw/main/chromium-v123.0.1-pack.tar',
            ),
            headless: false, // Run in non-headless mode
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();

        let navigationRetries = 3;
        while (navigationRetries > 0) {
            try {
                await page.goto(inputData.url, { waitUntil: 'networkidle2' });
                console.log('Fixed wait time for page to load');
                await sleep(5000); // Wait for 5 seconds to ensure all elements load properly
                break; // Navigation succeeded
            } catch (error) {
                console.error(`Error navigating: ${error.message}`);
                if (error.message.includes('Navigating frame was detached') && navigationRetries > 0) {
                    console.log('Retrying navigation...');
                    navigationRetries--;
                    await sleep(2000); // Wait before retrying
                } else {
                    throw error; // Other errors should not be retried
                }
            }
        }

        const attemptAltS = async () => {
            console.log('Simulating Alt+S...');
            await page.keyboard.down('AltLeft');
            await page.keyboard.press('S');
            await page.keyboard.up('AltLeft');
        };

        await attemptAltS();
        await sleep(5000); // Wait for the new tab to open

        const pages = await browser.pages();
        const newTab = pages[pages.length - 1];
        const newTabUrl = await newTab.url();

        // Kill the browser process instead of closing it gracefully
        const browserProcess = browser.process();
        if (browserProcess) {
            browserProcess.kill();
        }

        process.send({ newTabUrl });
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.send({ error: JSON.stringify(error, Object.getOwnPropertyNames(error)) });
        process.exit(1);
    }
})();
