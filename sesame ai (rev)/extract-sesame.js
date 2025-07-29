// extract-sesame.js
// Puppeteer script to extract JWT, cookies, WebSocket URLs, and payloads from Sesame AI web app

const puppeteer = require('puppeteer');

(async () => {
  // 1. Launch browser in non-headless mode for login
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();

  // 2. Go to Sesame AI app
  await page.goto('https://app.sesame.com/', { waitUntil: 'networkidle2' });

  // 3. Wait for login (or detect already logged in)
  // You can change this selector to something that only appears when logged in
  const LOGGED_IN_SELECTOR = 'body'; // Replace with a more specific selector if possible

  // Wait up to 2 minutes for login
  await page.waitForSelector(LOGGED_IN_SELECTOR, { timeout: 120000 });

  // 4. Extract tokens from localStorage and cookies
  const token = await page.evaluate(() => localStorage.getItem('id_token'));
  const cookies = await page.cookies();
  console.log('JWT Token:', token);
  console.log('Cookies:', cookies);

  // 5. Intercept WebSocket connections and payloads
  page.on('request', request => {
    if (request.url().startsWith('wss://')) {
      console.log('WebSocket URL:', request.url());
    }
  });

  // Intercept WebSocket frames (payloads)
  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    if (response) {
      if (response.opcode === 1) { // Text frame
        console.log('[WS SENT] TEXT:', response.payloadData);
      } else if (response.opcode === 2) { // Binary frame
        console.log('[WS SENT] BINARY (base64):', response.payloadData);
        try {
          const buf = Buffer.from(response.payloadData, 'base64');
          console.log('[WS SENT] BINARY (Buffer):', buf);
        } catch (e) {
          console.log('[WS SENT] BINARY (Buffer decode error):', e);
        }
      }
    }
  });
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    if (response) {
      if (response.opcode === 1) {
        console.log('[WS RECEIVED] TEXT:', response.payloadData);
      } else if (response.opcode === 2) {
        console.log('[WS RECEIVED] BINARY (base64):', response.payloadData);
        try {
          const buf = Buffer.from(response.payloadData, 'base64');
          console.log('[WS RECEIVED] BINARY (Buffer):', buf);
        } catch (e) {
          console.log('[WS RECEIVED] BINARY (Buffer decode error):', e);
        }
      }
    }
  });
  cdp.on('Network.webSocketCreated', ({ requestId, url }) => {
    console.log('[WS CREATED]', url);
  });

  // 6. Wait for you to start a call and interact
  console.log('Interact with the app (start a call, etc). All WebSocket traffic will be logged.');
  // Keep running for 10 minutes or until you close the browser
  await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000));

  await browser.close();
})(); 