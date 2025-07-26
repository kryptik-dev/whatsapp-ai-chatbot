// Gemini Embedding Memory Store
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const cosineSimilarity = require('compute-cosine-similarity');
const fs = require('fs');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API });
const MEMORIES_FILE = 'user_memories.json';

// Helper: Normalize embedding vector
function normalize(vec) {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => v / norm);
}

// Generate embedding for text
async function embedText(text) {
  const response = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: [text], // correct param name
    outputDimensionality: 768,
  });
  return normalize(response.embeddings[0].values); // extract from first embedding
}

// Add a memory (text + embedding) to JSON
async function addMemory(text) {
  // Filter out error/rate limit/empty messages
  const lower = text.toLowerCase();
  if (
    lower.includes('rate limited') ||
    lower.includes('error with the ai service') ||
    lower.includes('no output from venice') ||
    lower.includes('could not generate a response') ||
    lower.trim() === ''
  ) {
    return; // Don't add these to memory
  }
  const embedding = await embedText(text);
  let memories = [];
  if (fs.existsSync(MEMORIES_FILE)) {
    memories = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
  }
  memories.push({ text, embedding });
  fs.writeFileSync(MEMORIES_FILE, JSON.stringify(memories, null, 2));
}

// On startup, embed any memories missing an embedding
(async () => {
  if (fs.existsSync(MEMORIES_FILE)) {
    let memories = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    let updated = false;
    for (const mem of memories) {
      if (!Array.isArray(mem.embedding)) {
        mem.embedding = await embedText(mem.text);
        updated = true;
      }
    }
    if (updated) {
      fs.writeFileSync(MEMORIES_FILE, JSON.stringify(memories, null, 2));
    }
  }
})();

// Fetch top N relevant memories for a query
async function fetchRelevantMemories(query, topN = 5) {
  const queryEmbedding = await embedText(query);
  if (!fs.existsSync(MEMORIES_FILE)) return [];
  const memories = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
  const scored = memories
    .filter(mem => Array.isArray(mem.embedding))
    .map(mem => ({
      ...mem,
      similarity: cosineSimilarity(queryEmbedding, mem.embedding)
    }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topN);
}

module.exports = { addMemory, fetchRelevantMemories }; 