import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const geminiApiKey = process.env.GEMINI_API;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const genAI = new GoogleGenAI({ apiKey: geminiApiKey });

// Function to detect if a message is about user identity
function isIdentityMessage(text) {
    const identityPatterns = [
        /^(?:i'?m|i am|my name is|call me)\s+/i,
        /^(?:this is|it's me)\s+/i,
        /^(?:i'm|i am)\s+[a-zA-Z]+/i,
        /^(?:my name is)\s+[a-zA-Z]+/i,
        /^(?:call me)\s+[a-zA-Z]+/i
    ];
    
    return identityPatterns.some(pattern => pattern.test(text.trim()));
}

// Function to embed text using Gemini
async function embedText(text) {
    try {
        const response = await genAI.models.embedContent({
            model: 'gemini-embedding-001',
            contents: [text], // correct param name
            outputDimensionality: 3072, // Use 3072 dimensions to match our Supabase table
        });
        return response.embeddings[0].values; // extract from first embedding
    } catch (error) {
        console.error('Error embedding text:', error);
        return null;
    }
}

// Function to add memory to Supabase
export async function addMemory(text, isPinned = false) {
    try {
        // Skip error messages and system messages
        if (text.includes('Sorry, there was an error') || 
            text.includes('Sorry, I could not generate') ||
            text.includes('Memory search results for') ||
            text.startsWith('[AI]') ||
            text.startsWith('[Venice]')) {
            return;
        }

        // Check if this is an identity message
        const shouldPin = isPinned || isIdentityMessage(text);
        
        const embedding = await embedText(text);
        if (!embedding) {
            console.error('Failed to generate embedding for:', text);
            return;
        }

        const { data, error } = await supabase
            .from('memories')
            .insert([
                {
                    text: text,
                    embedding: embedding,
                    pinned: shouldPin
                }
            ]);

        if (error) {
            console.error('Error adding memory to Supabase:', error);
        } else {
            console.log(`Memory added${shouldPin ? ' (PINNED)' : ''}:`, text.substring(0, 50) + '...');
        }
    } catch (error) {
        console.error('Error in addMemory:', error);
    }
}

// Function to fetch relevant memories
export async function fetchRelevantMemories(query, limit = 10) {
    try {
        const queryEmbedding = await embedText(query);
        if (!queryEmbedding) {
            console.error('Failed to generate query embedding');
            return [];
        }

        const { data, error } = await supabase.rpc('match_memories', {
            query_embedding: queryEmbedding,
            match_threshold: 0.3,
            match_count: limit
        });

        if (error) {
            console.error('Error fetching relevant memories:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Error in fetchRelevantMemories:', error);
        return [];
    }
}

// Function to get pinned memories
export async function getPinnedMemories() {
    try {
        const { data, error } = await supabase.rpc('get_pinned_memories');
        
        if (error) {
            console.error('Error fetching pinned memories:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Error in getPinnedMemories:', error);
        return [];
    }
}

// Function to get all memories for context (pinned + relevant)
export async function getMemoryContext(query, limit = 10) {
    try {
        // Get pinned memories first
        const pinnedMemories = await getPinnedMemories();
        
        // Get relevant memories
        const relevantMemories = await fetchRelevantMemories(query, limit);
        
        // Combine and deduplicate (pinned memories take priority)
        const pinnedIds = new Set(pinnedMemories.map(m => m.id));
        const nonPinnedRelevant = relevantMemories.filter(m => !pinnedIds.has(m.id));
        
        // Return pinned first, then relevant (up to limit)
        const combined = [...pinnedMemories, ...nonPinnedRelevant.slice(0, limit - pinnedMemories.length)];
        
        return combined;
    } catch (error) {
        console.error('Error in getMemoryContext:', error);
        return [];
    }
}

// Function to get database size
export async function getDatabaseSize() {
    try {
        const { count, error } = await supabase
            .from('memories')
            .select('*', { count: 'exact', head: true });

        if (error) {
            console.error('Error getting database size:', error);
            return { count: 0, estimatedSizeMB: 0 };
        }

        // Estimate size: each memory is roughly 0.025MB (768 dimensions * 4 bytes + text)
        const estimatedSizeMB = count * 0.025;
        return { count, estimatedSizeMB };
    } catch (error) {
        console.error('Error in getDatabaseSize:', error);
        return { count: 0, estimatedSizeMB: 0 };
    }
}

// Function to clean old memories
export async function cleanOldMemories(keepCount = 10000) {
    try {
        const { count } = await getDatabaseSize();
        
        if (count <= keepCount) {
            console.log('No cleanup needed, under limit');
            return;
        }

        const deleteCount = count - keepCount;
        console.log(`Cleaning ${deleteCount} old memories...`);

        // Delete oldest non-pinned memories first
        const { error } = await supabase
            .from('memories')
            .delete()
            .lt('id', 
                supabase
                    .from('memories')
                    .select('id')
                    .order('id', { ascending: false })
                    .limit(1)
                    .offset(keepCount - 1)
            )
            .eq('pinned', false);

        if (error) {
            console.error('Error cleaning old memories:', error);
        } else {
            console.log(`Cleaned ${deleteCount} old memories`);
        }
    } catch (error) {
        console.error('Error in cleanOldMemories:', error);
    }
}

// Function to export memories to JSON
export async function exportMemoriesToJson() {
    try {
        const { data, error } = await supabase
            .from('memories')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error exporting memories:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error in exportMemoriesToJson:', error);
        return null;
    }
}

// Auto-cleanup when approaching limit
export async function checkAndCleanupIfNeeded() {
    const { count, estimatedSizeMB } = await getDatabaseSize();
    
    console.log(`Database has ${count} memories (~${estimatedSizeMB.toFixed(2)}MB)`);
    
    if (count > 10000) { // Clean when we have more than 10,000 messages
        console.log('Approaching message limit, cleaning old memories...');
        await cleanOldMemories(10000); // Keep 10,000 most recent
    }
} 