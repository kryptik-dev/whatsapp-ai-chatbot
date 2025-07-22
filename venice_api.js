const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { systemPrompt } = require('./system_prompt');

const VENICE_SESSION_COOKIE = process.env.VENICE_SESSION_COOKIE; // __session=...
const VENICE_USER_ID = process.env.VENICE_USER_ID; // user_xxx
const VENICE_MODEL_ID = process.env.VENICE_MODEL_ID || 'dolphin-3.0-mistral-24b-1dot1';
const GEMINI_API_KEY = process.env.GEMINI_API;

let veniceRateLimitedUntil = 0;

async function callGeminiFallback(userMessage, history, systemPromptString) {
  try {
    const geminiPrompt = [
      { role: 'system', content: systemPromptString },
      ...history,
      { role: 'user', content: userMessage }
    ].map(m => `${m.role === 'system' ? '' : m.role + ': '}${m.content}`).join('\n');
    const geminiRes = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      { contents: [{ parts: [{ text: geminiPrompt }] }] },
      { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY } }
    );
    return geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || '[No output from Gemini]';
  } catch (geminiError) {
    console.error('Gemini API error:', geminiError.toJSON ? geminiError.toJSON() : geminiError);
    return '[No output from Venice or Gemini]';
  }
}

// Accepts a user message string and optional chat history (array of {role, content})
async function sendToVeniceFull(userMessage, history = []) {
  // Use full system prompt from system_prompt.js
  const systemPromptString = typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt, null, 2);

  // Circuit breaker: skip Venice if recently rate limited
  if (Date.now() < veniceRateLimitedUntil) {
    return await callGeminiFallback(userMessage, history, systemPromptString);
  }

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
    userId: VENICE_USER_ID,
    webEnabled: true
  };

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.9",
    "Cookie": VENICE_SESSION_COOKIE,
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
      { headers, responseType: 'text' }
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
    console.error("Venice API error raw:", error.toJSON ? error.toJSON() : error);
    // Check for rate limit (HTTP 429 or known error message)
    const isRateLimit = error.response?.status === 429 ||
      (typeof error.response?.data === 'string' && error.response.data.includes('rate limit')) ||
      (typeof error.response?.data === 'object' && JSON.stringify(error.response.data).toLowerCase().includes('rate limit'));
    if (isRateLimit) {
      veniceRateLimitedUntil = Date.now() + 60 * 60 * 1000; // 1 hour
      console.warn('Venice rate limited. Falling back to Gemini for 1 hour.');
      return await callGeminiFallback(userMessage, history, systemPromptString);
    }
    // Fallback to Gemini for other errors
    return await callGeminiFallback(userMessage, history, systemPromptString);
  }
}

module.exports = { sendToVeniceFull, sendToVeniceWithPrompt: sendToVeniceFull }; 