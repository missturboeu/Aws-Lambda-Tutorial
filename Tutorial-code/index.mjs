import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { EventEmitter } from 'events';

// Increase the maximum number of listeners to avoid the warning
EventEmitter.defaultMaxListeners = 20;

const readdir = promisify(fs.readdir);
const rm = promisify(fs.rm);

const cleanUpTempFiles = async (tempDir) => {
    console.log('Cleaning up temporary files...');
    try {
        const files = await readdir(tempDir);
        for (const file of files) {
            if (file.startsWith('puppeteer_dev_chrome_profile')) {
                console.log(`Removing file: ${file}`);
                await rm(path.join(tempDir, file), { recursive: true, force: true });
            }
        }
    } catch (err) {
        console.error('Error cleaning up temporary files:', err);
    }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

    console.time('Identify environment');
    console.log('Identifying environment...');
    console.timeEnd('Identify environment');

    let browser = null;
    let listeners = [];
    let blockedRequests = 0;

    try {
        console.time('Launch browser');
        console.log('Launching browser...');
        browser = await puppeteer.launch({
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
                'https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar',
            ),
            headless: false, // Run in non-headless mode
            ignoreHTTPSErrors: true,
        });
        console.timeEnd('Launch browser');
        console.log('Browser launched');

        console.time('Open new page');
        console.log('Opening new page...');
        const page = await browser.newPage();
        console.timeEnd('Open new page');
        console.log('New page opened');

        const context = browser.defaultBrowserContext();
        console.log('Overriding permissions...');
        await context.overridePermissions(url, ['clipboard-read', 'clipboard-write']);
        console.log('Permissions overridden');

        console.log('Setting request interception...');
        await page.setRequestInterception(true);
        const requestListener = request => {
            const resourceType = request.resourceType();
            if (['image', 'stylesheet', 'font'].includes(resourceType)) {
                blockedRequests++;
                request.abort(); // Block images, stylesheets, and fonts to speed up loading
            } else {
                request.continue();
            }
        };
        page.on('request', requestListener);
        listeners.push({ emitter: page, event: 'request', listener: requestListener });

        let navigationRetries = 3;
        while (navigationRetries > 0) {
            try {
                console.time('Navigate to URL');
                console.log(`Navigating to URL: ${url}`);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                console.timeEnd('Navigate to URL');
                console.log('Navigation succeeded');
                await sleep(5000); // Wait for 5 seconds
                break; // Navigation succeeded
            } catch (error) {
                console.timeEnd('Navigate to URL');
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

        const attemptAltS = async (logMessage) => {
            console.log(logMessage);
            await page.keyboard.down('AltLeft');
            await sleep(2000); // Hold Alt for 2 seconds
            await page.keyboard.press('s');
            await page.keyboard.up('AltLeft');
        };

        const tryAltS = async (logMessage, clickCenter = false) => {
            console.log(`Starting: ${logMessage}`);
            let pagesBefore = await browser.pages();

            if (clickCenter) {
                console.log('Clicking center of the page');
                try {
                    const viewport = await page.viewport();
                    if (viewport) {
                        await page.mouse.click(viewport.width / 2, viewport.height / 2);
                    } else {
                        console.error('Viewport is null');
                    }
                } catch (viewportError) {
                    console.error('Error retrieving viewport:', viewportError);
                }
            }

            for (let i = 0; i < 3; i++) {
                console.log('Pressing Escape key');
                await page.keyboard.press('Escape');
            }

            await attemptAltS(logMessage);

            await sleep(5000);

            const pagesAfter = await browser.pages();
            if (pagesAfter.length > pagesBefore.length) {
                const newPage = pagesAfter.find(p => !pagesBefore.includes(p));
                if (newPage) {
                    const newTabUrl = await newPage.url();
                    console.log(`New tab opened successfully after ${logMessage}`);
                    console.log(`New tab URL after ${logMessage}: ${newTabUrl}`);
                    return newTabUrl;
                }
            } else {
                console.log(`No new tab opened after ${logMessage}`);
            }
            return null;
        };

        console.time('Simulate Alt+S and get new tab URL');
        console.log('Simulating Alt+S and getting new tab URL...');

        let newTabUrl = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            newTabUrl = await tryAltS(`Attempt ${attempt + 1} of Alt+S`);
            if (newTabUrl) break;
            await sleep(1000); // Wait 1 second before retrying
        }

        if (!newTabUrl) {
            for (let attempt = 2; attempt < 4; attempt++) {
                newTabUrl = await tryAltS(`Attempt ${attempt + 1} of Alt+S after clicking center`, true);
                if (newTabUrl) break;
                await sleep(1000); // Wait 1 second before retrying
            }

            if (!newTabUrl) {
                console.log('Refreshing the page and trying Alt+S one more time');
                await page.reload({ waitUntil: ["domcontentloaded"] });
                await sleep(1000); // Wait for a second before attempting again
                newTabUrl = await tryAltS(`Final attempt of Alt+S after refresh`);
            }
        }

        console.timeEnd('Simulate Alt+S and get new tab URL');
        console.timeEnd('Total time');

        if (newTabUrl) {
            console.log('New tab URL obtained successfully');
            return {
                statusCode: 200,
                body: JSON.stringify({ newTabUrl }),
            };
        } else {
            console.error('Failed to open new tab or identify new tab URL');

            let clipboardText = 'nothing';
            try {
                clipboardText = await page.evaluate(async () => {
                    const input = document.createElement('input');
                    document.body.appendChild(input);
                    input.style.position = 'fixed';
                    input.style.opacity = 0;
                    input.focus();
                    document.execCommand('paste');
                    const text = input.value;
                    document.body.removeChild(input);
                    return text;
                });
                console.log(`Clipboard content: ${clipboardText}`);
            } catch (clipboardError) {
                console.error('Error accessing clipboard:', clipboardError);
            }

            return {
                statusCode: 200,
                body: JSON.stringify({ clipboardText }),
            };
        }
    } catch (error) {
        console.error('Error:', error && error.message);
        console.timeEnd('Total time');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `An error occurred: ${error && error.message}` }),
        };
    } finally {
        if (browser) {
            console.time('Close browser using Alt+F4');
            console.log('Closing browser using Alt+F4...');
            try {
                const pages = await browser.pages();
                for (let page of pages) {
                    await page.keyboard.down('AltLeft');
                    await page.keyboard.press('F4');
                    await page.keyboard.up('AltLeft');
                }
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait briefly to ensure the browser closes
            } catch (err) {
                console.error('Error closing browser with Alt+F4:', err);
            }

            if (browser.process()) {
                console.log('Force killing the browser process');
                browser.process().kill();
            }
            console.timeEnd('Close browser using Alt+F4');
        }

        console.time('Clean up temporary files');
        console.log('Cleaning up temporary files...');
        await cleanUpTempFiles('/tmp');
        console.timeEnd('Clean up temporary files');

        // Remove all added event listeners
        listeners.forEach(({ emitter, event, listener }) => {
            if (emitter.removeListener) {
                emitter.removeListener(event, listener);
            }
        });
        console.log('Cleaned up event listeners');

        // Log summary of blocked requests
        console.log(`Total blocked requests: ${blockedRequests}`);
    }
};
