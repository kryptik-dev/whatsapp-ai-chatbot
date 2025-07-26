import axios from 'axios';
import https from 'https';
import path from 'path';
import pkg from 'uuid';
const { v4: uuidv4 } = pkg;
import { systemPrompt } from './system_prompt.js';

// Remove all proxy-related imports and code
// const HttpsProxyAgent = require('https-proxy-agent');
// const { SocksProxyAgent } = require('socks-proxy-agent');

// Remove proxy configuration
// const MUBENG_PROXY = 'http://127.0.0.1:8089';
// const TOR_SOCKS_PROXY = 'socks5://localhost:9050';
// const GEONODE_URL = 'https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc';
// let proxies = [];

// Remove proxy fetching functions
// async function fetchProxies() { ... }
// fetchProxies();
// setInterval(fetchProxies, 5 * 60 * 1000);

// Keep only the core Venice API functionality
export async function sendToVeniceFull(prompt) {
    try {
        const response = await axios.post('https://api.venice.ai/v1/chat/completions', {
            model: 'gpt-4',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1000,
            temperature: 0.7
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.VENICE_API_KEY}`
            },
            timeout: 30000
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Venice API error:', error.response?.data || error.message);
        throw error;
    }
}

export async function generateVeniceImage({
  prompt,
  userId = VENICE_USER_ID,
  bearerToken = VENICE_BEARER_TOKEN,
  overrides = {}
}) {
  const uuid = uuidv4();
  const payload = {
    aspectRatio: "1:1",
    cfgScale: 5,
    clientProcessingTime: 4,
    customSeed: "",
    embedExifMetadata: true,
    enhanceCreativity: 0.35,
    favoriteImageStyles: [],
    format: "webp",
    height: 1024,
    hideWatermark: true,
    imageToImageCfgScale: 15,
    imageToImageStrength: 33,
    isConstrained: true,
    isCustomSeed: false,
    isDefault: true,
    loraStrength: 75,
    matureFilter: false,
    messageId: uuid,
    modelType: "image",
    negativePrompt: "",
    parentMessageId: null,
    prompt,
    recentImageStyles: [],
    replication: 0.35,
    requestId: uuid,
    seed: Math.floor(Math.random() * 1e8),
    simpleMode: false,
    steps: 20,
    stylePreset: "None",
    stylesTab: 0,
    type: "image",
    upscaleEnhance: true,
    upscaleScale: 1,
    userId,
    variants: 1,
    width: 1024,
    ...overrides
  };
  const headers = {
    "Content-Type": "application/json",
    ...(bearerToken ? { "Authorization": `Bearer ${bearerToken}` } : {}),
    "Origin": "https://venice.ai",
    "Referer": "https://venice.ai/"
  };
  const response = await axios.post(VENICE_IMAGE_ENDPOINT, payload, {
    headers,
    responseType: 'arraybuffer'
  });
  return { buffer: response.data, headers: response.headers };
}

// --- Simple Express server and UI for testing ---
import express from 'express';
import bodyParser from 'body-parser';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Serve a simple HTML UI
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Venice AI Tester</title>
      <style>
        body { font-family: Arial, sans-serif; background: #f7f7f7; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px #0001; padding: 24px; }
        h1 { text-align: center; }
        #response { white-space: pre-line; background: #f0f0f0; border-radius: 4px; padding: 12px; min-height: 60px; margin-top: 16px; }
        #sendBtn { margin-left: 8px; }
        #modeToggle { margin-bottom: 16px; display: block; }
        #response img { max-width: 100%; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Venice AI Tester</h1>
        <button id="modeToggle">Switch to Image Gen</button>
        <form id="aiForm">
          <input type="text" id="userInput" placeholder="Type your message..." style="width:70%" required />
          <button type="submit" id="sendBtn">Send</button>
        </form>
        <div id="response"></div>
      </div>
      <script>
        let mode = 'text';
        const form = document.getElementById('aiForm');
        const input = document.getElementById('userInput');
        const responseDiv = document.getElementById('response');
        const modeToggle = document.getElementById('modeToggle');
        function updateModeUI() {
          if (mode === 'text') {
            modeToggle.textContent = 'Switch to Image Gen';
            input.placeholder = 'Type your message...';
            responseDiv.innerHTML = '';
          } else {
            modeToggle.textContent = 'Switch to Text Gen';
            input.placeholder = 'Describe your image prompt...';
            responseDiv.innerHTML = '';
          }
        }
        modeToggle.onclick = (e) => {
          mode = mode === 'text' ? 'image' : 'text';
          updateModeUI();
        };
        form.onsubmit = async (e) => {
          e.preventDefault();
          responseDiv.textContent = 'Loading...';
          const userMessage = input.value;
          if (mode === 'text') {
            const res = await fetch('/api/ai', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: userMessage })
            });
            const data = await res.json();
            responseDiv.textContent = data.response || '[No output]';
          } else {
            const res = await fetch('/api/image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: userMessage })
            });
            if (res.ok) {
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              responseDiv.innerHTML = '<img src="' + url + '" alt="Generated image" />';
            } else {
              const err = await res.json();
              responseDiv.textContent = err.error || '[Image generation error]';
            }
          }
        };
        updateModeUI();
      </script>
    </body>
    </html>
  `);
});

let aiRequestLock = Promise.resolve();

// API endpoint for AI
app.post('/api/ai', async (req, res) => {
  const userMessage = req.body.message;
  // Chain requests to ensure only one is processed at a time
  aiRequestLock = aiRequestLock.then(async () => {
    try {
      const aiResponse = await sendToVeniceFull(userMessage);
      res.json({ response: aiResponse });
    } catch (err) {
      res.json({ response: '[Error: ' + (err.message || 'Unknown error') + ']' });
    }
  });
});

app.post('/api/image', async (req, res) => {
  const { prompt, overrides } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  try {
    const { buffer, headers } = await generateVeniceImage({ prompt, overrides });
    // Log blurring/content violation headers if present
    if (headers) {
      console.log('x-venice-is-blurred:', headers['x-venice-is-blurred']);
      console.log('x-venice-is-content-violation:', headers['x-venice-is-content-violation']);
    }
    res.set('Content-Type', 'image/webp');
    res.send(buffer);
  } catch (err) {
    // Detailed error logging
    console.error('Image generation error:', err);
    if (err.response) {
      let veniceData = err.response.data;
      if (Buffer.isBuffer(veniceData)) {
        try {
          veniceData = veniceData.toString('utf8');
          console.error('Venice API response data (decoded):', veniceData);
        } catch (e) {
          console.error('Failed to decode Venice API response data buffer.');
        }
      } else {
        console.error('Venice API response data:', veniceData);
      }
      console.error('Venice API response status:', err.response.status);
      console.error('Venice API response headers:', err.response.headers);
      if (err.response && err.response.headers) {
        console.error('x-venice-is-blurred:', err.response.headers['x-venice-is-blurred']);
        console.error('x-venice-is-content-violation:', err.response.headers['x-venice-is-content-violation']);
      }
    }
    res.status(500).json({
      error: err.message || 'Unknown error',
      veniceApi: err.response ? {
        status: err.response.status,
        data: Buffer.isBuffer(err.response.data) ? err.response.data.toString('utf8') : err.response.data,
        headers: err.response.headers
      } : undefined
    });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`Venice AI Tester running at http://localhost:${PORT}`);
  });
}

export { sendToVeniceFull as sendToVeniceWithPrompt }; 