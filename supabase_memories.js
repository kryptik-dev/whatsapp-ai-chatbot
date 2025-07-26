require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API });

// Helper: Normalize embedding vector
function normalize(vec) {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => v / norm);
}

// Generate embedding for text
async function embedText(text) {
  const response = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: [text],
    outputDimensionality: 768, // must be a number, not a string
  });
  return normalize(response.embeddings[0].values);
}

// Add a memory (text + embedding) to Supabase
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
  const { error } = await supabase.from('memories').insert([{ text, embedding }]);
  if (error) {
    console.error('Error adding memory to Supabase:', error);
    throw error;
  }
}

// Fetch top N relevant memories for a query
async function fetchRelevantMemories(query, topN = 5) {
  const queryEmbedding = await embedText(query);
  const { data, error } = await supabase.rpc('match_memories', {
    query_embedding: queryEmbedding,
    match_threshold: 0.7,
    match_count: topN
  });

  if (error) {
    console.error('Error fetching memories from Supabase:', error);
    return [];
  }

  return data || [];
}

// Check database size (approximate)
async function getDatabaseSize() {
  const { data, error } = await supabase
    .from('memories')
    .select('id')
    .limit(1);
  
  if (error) {
    console.error('Error checking database size:', error);
    return 0;
  }

  // Get total count
  const { count, error: countError } = await supabase
    .from('memories')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('Error getting count:', countError);
    return 0;
  }

  // Rough estimate: each memory ~1KB (text + embedding)
  const estimatedSizeMB = (count * 1024) / (1024 * 1024);
  return { count, estimatedSizeMB };
}

// Clean old memories (keep only recent N)
async function cleanOldMemories(keepCount = 1000) {
  const { data, error } = await supabase
    .from('memories')
    .select('id')
    .order('id', { ascending: false })
    .limit(keepCount);

  if (error) {
    console.error('Error getting recent memories:', error);
    return;
  }

  if (data.length < keepCount) {
    console.log('Database has fewer than', keepCount, 'memories, no cleanup needed');
    return;
  }

  const oldestIdToKeep = data[data.length - 1].id;

  const { error: deleteError } = await supabase
    .from('memories')
    .delete()
    .lt('id', oldestIdToKeep);

  if (deleteError) {
    console.error('Error deleting old memories:', deleteError);
  } else {
    console.log('Cleaned old memories, kept', data.length, 'recent ones');
  }
}

// Export memories to JSON file
async function exportMemoriesToJson(filename = 'memories_backup.json') {
  const { data, error } = await supabase
    .from('memories')
    .select('text')
    .order('id', { ascending: true });

  if (error) {
    console.error('Error exporting memories:', error);
    return;
  }

  const memories = data.map(row => ({ text: row.text }));
  fs.writeFileSync(filename, JSON.stringify(memories, null, 2));
  console.log('Exported', memories.length, 'memories to', filename);
}

// Auto-cleanup when approaching limit
async function checkAndCleanupIfNeeded() {
  const { count, estimatedSizeMB } = await getDatabaseSize();
  
  console.log(`Database has ${count} memories (~${estimatedSizeMB.toFixed(2)}MB)`);
  
  if (count > 10000) { // Clean when we have more than 10,000 messages
    console.log('Approaching message limit, cleaning old memories...');
    await cleanOldMemories(10000); // Keep 10,000 most recent
  }
}

module.exports = { 
  addMemory, 
  fetchRelevantMemories, 
  getDatabaseSize, 
  cleanOldMemories, 
  exportMemoriesToJson,
  checkAndCleanupIfNeeded
}; 