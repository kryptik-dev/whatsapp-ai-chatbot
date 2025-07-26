const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { systemPrompt } = require('./system_prompt');
const HttpsProxyAgent = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const net = require('net');
const { spawn } = require('child_process');
const os = require('os');
const torControl = require('node-tor-control');
const { connect, tor } = require('node-tor-control');
const path = require('path');

const MUBENG_PROXY = 'http://127.0.0.1:8089';

const TOR_RETRY_LIMIT = 5;
const TOR_SOCKS_PROXY = 'socks5://localhost:9050'; // Default Tor SOCKS proxy

const GEONODE_URL = 'https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc';
let proxies = [];

async function fetchProxies() {
  try {
    console.log('[Venice Proxy] Fetching proxy list from GeoNode...');
    const res = await axios.get(GEONODE_URL);
    if (Array.isArray(res.data.data)) {
      proxies = res.data.data
        .filter(p =>
          p.protocols.includes('socks4') &&
          p.upTimeSuccessCount > 1000 &&
          p.speed <= 10
        )
        .map(p => `socks4://${p.ip}:${p.port}`);
      console.log(`[Venice Proxy] Loaded ${proxies.length} filtered SOCKS4 proxies from GeoNode.`);
    } else {
      console.warn('[Venice Proxy] Proxy list from GeoNode is not an array. No proxies loaded.');
    }
  } catch (err) {
    console.warn('[Venice Proxy] Failed to fetch proxy list from GeoNode.', err.message);
  }
}

// Initial fetch and refresh every 5 minutes
fetchProxies();
setInterval(fetchProxies, 5 * 60 * 1000);

const VENICE_SESSION_COOKIE = process.env.VENICE_SESSION_COOKIE; // __session=...
const VENICE_USER_ID = process.env.VENICE_USER_ID; // user_xxx
const VENICE_MODEL_ID = process.env.VENICE_MODEL_ID || 'dolphin-3.0-mistral-24b-1dot1';
const VENICE_BEARER_TOKEN = process.env.VENICE_BEARER_TOKEN; // Bearer <token>
const VENICE_BEARER_TOKEN_2 = process.env.VENICE_BEARER_TOKEN_2; // Second Bearer <token>
const VENICE_BEARER_TOKEN_3 = process.env.VENICE_BEARER_TOKEN_3; // Third Bearer <token>
const VENICE_USER_ID_2 = process.env.VENICE_USER_ID_2; // userId for token 2
const VENICE_USER_ID_3 = process.env.VENICE_USER_ID_3; // userId for token 3
const VENICE_IMAGE_ENDPOINT = "https://outerface.venice.ai/api/inference/image";

const GEMINI_API = process.env.GEMINI_API;

let veniceRateLimitedUntil = 0;
let veniceMessageCounter = 0;

// Removed Gemini fallback function

async function callGeminiWithFallback(promptText) {
  try {
    // Try Gemini Pro first
    const proRes = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
      { contents: [{ parts: [{ text: promptText }] }] },
      { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API } }
    );
    return proRes.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (proErr) {
    // On error or rate limit, fall back to Flash
    try {
      const flashRes = await axios.post(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        { contents: [{ parts: [{ text: promptText }] }] },
        { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API } }
      );
      return flashRes.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (flashErr) {
      console.error('Gemini API error (pro & flash):', flashErr?.response?.data || flashErr.message);
      return '[All AI models are currently rate limited. Please try again later.]';
    }
  }
}

// Accepts a user message string and optional chat history (array of {role, content})
async function sendToVeniceFull(userMessage, history = [], _forceIndex = null, _tried = []) {
  // Use full system prompt from system_prompt.js
  const systemPromptString = typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt, null, 2);

  // Circuit breaker: skip Venice if recently rate limited
  if (Date.now() < veniceRateLimitedUntil) {
    console.log('[Venice] Venice is rate limited, falling back to Gemini until', new Date(veniceRateLimitedUntil).toLocaleString());
    return await callGeminiWithFallback(
      typeof userMessage === 'string' ? userMessage : (userMessage?.content || '[No prompt]')
    );
  }

  // Prepare tokens and userIds as arrays for round-robin
  const tokens = [VENICE_BEARER_TOKEN, VENICE_BEARER_TOKEN_2, VENICE_BEARER_TOKEN_3].filter(Boolean);
  const userIds = [VENICE_USER_ID, VENICE_USER_ID_2, VENICE_USER_ID_3].filter(Boolean);
  // Pick index: round-robin unless forced
  let idx;
  if (_forceIndex !== null) {
    idx = _forceIndex;
  } else {
    idx = veniceMessageCounter % tokens.length;
    veniceMessageCounter = (veniceMessageCounter + 1) % tokens.length;
  }
  const currentBearerToken = tokens[idx];
  const currentUserId = userIds[idx] || VENICE_USER_ID;

  // Build the prompt array: history, then user message (NO system prompt in prompt array)
  let prompt = [
    ...history,
    { role: 'user', content: userMessage }
  ];
  // Filter out assistant error messages
  prompt = prompt.filter(
    m => !(m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('error with the AI service'))
  );
  // Truncate to last 6 messages
  if (prompt.length > 6) {
    prompt = prompt.slice(-6);
  }
  // Sanity check: ensure all message contents are strings and roles are valid
  for (const msg of prompt) {
    if (typeof msg.content !== 'string') {
      throw new Error(`Message content for role '${msg.role}' is not a string: ${JSON.stringify(msg.content)}`);
    }
    if (!['system', 'user', 'assistant'].includes(msg.role)) {
      throw new Error(`Invalid role: ${msg.role}`);
    }
  }
  // Generate a single UUID for id, messageId, and requestId
  const uuid = uuidv4();
  const payload = {
    characterId: "",
    clientProcessingTime: 4,
    conversationType: "text",
    id: uuid,
    includeVeniceSystemPrompt: true,
    isCharacter: false,
    messageId: uuid,
    modelId: VENICE_MODEL_ID,
    modelName: "Venice Uncensored 1.1",
    modelType: "text",
    prompt,
    reasoning: true,
    requestId: uuid,
    simpleMode: false,
    systemPrompt: systemPromptString,
    temperature: 0.7,
    textToSpeech: { voiceId: "af_sky", speed: 1 },
    topP: 0.3,
    type: "text",
    userId: currentUserId,
    webEnabled: true
  };

  // Define headers for Venice API request
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.9",
    ...(currentBearerToken
      ? { "Authorization": `Bearer ${currentBearerToken}` }
      : { "Cookie": VENICE_SESSION_COOKIE }),
    "Origin": "https://venice.ai",
    "Referer": "https://venice.ai/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Det": "empty"
  };

  try {
    const response = await axios.post(
      "https://outerface.venice.ai/api/inference/chat",
      payload,
      {
        headers,
        responseType: 'text',
      }
    );
    const chunks = response.data.trim().split('\n');
    let fullResponse = '';
    for (const chunk of chunks) {
      try {
        const parsed = JSON.parse(chunk);
        if (parsed.kind === 'content' && parsed.content) {
          fullResponse += parsed.content;
        }
      } catch (e) {
        // Ignore parse errors for non-JSON lines
      }
    }
    return fullResponse || '[No output]';
  } catch (error) {
    if (error.response && error.response.status === 429) {
      // Set circuit breaker for 1 hour
      veniceRateLimitedUntil = Date.now() + 60 * 60 * 1000;
      console.log('[Venice] Venice API rate limited (429). Disabling Venice for 1 hour. Falling back to Gemini.');
      return await callGeminiWithFallback(
        typeof userMessage === 'string' ? userMessage : (userMessage?.content || '[No prompt]')
      );
    }
    console.error('[Venice] Venice request failed:', error.message);
    // Fallback to Gemini if needed
    const geminiResponse = await callGeminiWithFallback(
      typeof userMessage === 'string' ? userMessage : (userMessage?.content || '[No prompt]')
    );
    return geminiResponse || '[All AI models are currently rate limited. Please try again later.]';
  }
}

async function generateVeniceImage({
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
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Venice AI Tester running at http://localhost:${PORT}`);
  });
}

module.exports = { sendToVeniceFull, sendToVeniceWithPrompt: sendToVeniceFull }; 