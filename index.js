import { systemPrompt } from './system_prompt.js';
import { addMemory, fetchRelevantMemories, getPinnedMemories, getMemoryContext, getDatabaseSize, cleanOldMemories, exportMemoriesToJson, checkAndCleanupIfNeeded } from './supabase_memories.js';
import { getConversationHistory, addMessageToHistory } from './conversation_history.js';
import FreeGPT3 from 'freegptjs';
import { Client as DiscordClient, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, ChannelType, PermissionsBitField, ActivityType } from 'discord.js';
import pkg from 'whatsapp-web.js';
const { Client: WhatsAppClient, LocalAuth, MessageMedia } = pkg;
import QRCode from 'qrcode';
import { googleSearch } from './web_search.js';
import os from 'os';
import fs from 'fs';
import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API });



dotenv.config();

const token = process.env.DISCORD_TOKEN;
const mainChatChannelId = process.env.MAIN_CHAT_CHANNEL_ID;
const yourUserId = process.env.YOUR_USER_ID;
const geminiApiKey = process.env.GEMINI_API;
const PORT = process.env.PORT || 3000;
const AMAAN_NUMBER = '27766934588'; // Only this number is treated as Amaan

const app = express();

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>WhatsApp Discord Bot</title>
                <style>
                    body { font-family: sans-serif; text-align: center; margin: 5% auto; max-width: 600px; }
                    .model-info { background: #f0f0f0; padding: 20px; border-radius: 10px; margin: 20px 0; }
                    .model-button { 
                        background: #007bff; color: white; border: none; padding: 10px 20px; 
                        margin: 5px; border-radius: 5px; cursor: pointer; 
                    }
                    .model-button:hover { background: #0056b3; }
                    .model-button.active { background: #28a745; }
                    .capabilities { font-size: 0.9em; color: #666; margin-top: 10px; }
                </style>
            </head>
            <body>
                <h1>🤖 WhatsApp Discord Bot</h1>
                <p>Bot server is online and healthy.</p>
                
                <div class="model-info">
                    <h3>AI Model Status</h3>
                    <p>Primary Model: <strong>Gemini 2.5 Pro</strong></p>
                    <p>Fallback Model: <strong>Gemini 2.5 Flash</strong></p>
                    <div class="capabilities">
                        <strong>Capabilities:</strong><br>
                        <span>Text, Images, Videos, Audio, Web Search</span>
                    </div>
                </div>


            </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Express server listening on port ${PORT}`);
});

if (!token || !mainChatChannelId || !yourUserId) {
    throw new Error('One or more required environment variables are not set.');
}

// Discord Bot Setup
const discordClient = new DiscordClient({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// WhatsApp Client Setup
const whatsappClient = new WhatsAppClient({
    authStrategy: new LocalAuth({ clientId: "bot-account-main" }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

const stalkedUsers = new Set();
const outgoingMessageQueues = new Map();
const userMessageCount = new Map(); // Track message count for summarization
let offlineTimer = null;
let isWhatsAppReady = false;
let whatsappMessageQueue = [];
const openai = new FreeGPT3();

// AI Model Configuration
// Always uses Gemini 2.5 Pro with Gemini 2.5 Flash fallback



whatsappClient.on('ready', () => {
    console.log('WhatsApp client is ready!');
    isWhatsAppReady = true;
    // Send any queued messages
    for (const fn of whatsappMessageQueue) {
        fn();
    }
    whatsappMessageQueue = [];
    
    // Check database size and cleanup if needed
    checkAndCleanupIfNeeded().catch(err => {
        console.error('Error during database cleanup check:', err);
    });
});

const tempDir = path.join(process.cwd(), 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// Load and save ping users functions
function loadPingUsers() {
    const pingUsersFile = path.join(process.cwd(), 'ping_users.json');
    if (!fs.existsSync(pingUsersFile)) return [];
    return JSON.parse(fs.readFileSync(pingUsersFile, 'utf8'));
}

function savePingUsers(users) {
    const pingUsersFile = path.join(process.cwd(), 'ping_users.json');
    fs.writeFileSync(pingUsersFile, JSON.stringify(users, null, 2));
}

// Function to randomly decide if we should reply to a message
function shouldReplyToMessage() {
    // 5% chance to reply to the message instead of sending a new message (reduced from 8%)
    return Math.random() < 0.05;
}

// Track recently replied messages to avoid spam
const recentlyRepliedMessages = new Set();
const MAX_REPLIED_MESSAGES = 10; // Keep track of last 10 messages

function shouldReplyToThisMessage(messageId) {
    // Don't reply if we've already replied to this message recently
    if (recentlyRepliedMessages.has(messageId)) {
        return false;
    }
    
    // Clean up old entries if we have too many
    if (recentlyRepliedMessages.size >= MAX_REPLIED_MESSAGES) {
        const firstEntry = recentlyRepliedMessages.values().next().value;
        recentlyRepliedMessages.delete(firstEntry);
    }
    
    // Add this message to tracked list
    recentlyRepliedMessages.add(messageId);
    
    return shouldReplyToMessage();
}

// ---  Connection Stability & Auto-Restart ---
whatsappClient.on('disconnected', (reason) => {
    console.log('❌ WhatsApp client was logged out:', reason);
    console.log('🔄 Attempting to reconnect...');
    whatsappClient.initialize().catch(err => {
        console.error('Failed to re-initialize WhatsApp client after disconnection:', err);
    });
});

discordClient.on('ready', () => {
    console.log(`Logged in as ${discordClient.user.tag}!`);
    discordClient.user.setPresence({
        activities: [{ name: "Online", type: ActivityType.Playing }],
        status: 'online',
    });
    // Set timer to go offline after initial startup
    offlineTimer = setTimeout(() => {
        discordClient.user.setPresence({
            activities: [{ name: "Offline", type: ActivityType.Playing }],
            status: 'idle'
        });
    }, 2 * 60 * 1000);
    scheduleDailyWhatsAppMessages();
});


// Gemini fallback helper
async function callGeminiWithFallback(promptText) {
    const groundingTool = { googleSearch: {} };
    const config = { tools: [groundingTool] };
    
    try {
        // Always try Gemini 2.5 Pro first
        console.log('[AI] Trying Gemini 2.5 Pro...');
        const proRes = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: promptText,
            config,
        });
        const proText = proRes.text || '';
        if (proText.trim()) {
            console.log('[AI] Gemini 2.5 Pro response successful');
            return proText;
        } else {
            console.log('[AI] Gemini 2.5 Pro returned empty response');
        }
    } catch (proErr) {
        console.log('[AI] Gemini 2.5 Pro failed:', proErr?.message || 'Unknown error');
        
        // Fallback to Gemini 2.5 Flash
        try {
            console.log('[AI] Trying Gemini 2.5 Flash as fallback...');
            const flashRes = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: promptText,
                config,
            });
            const flashText = flashRes.text || '';
            if (flashText.trim()) {
                console.log('[AI] Gemini 2.5 Flash fallback successful');
                return flashText;
            } else {
                console.log('[AI] Gemini 2.5 Flash fallback returned empty response');
            }
        } catch (flashErr) {
            console.error('[AI] Gemini 2.5 Flash fallback also failed:', flashErr?.message || 'Unknown error');
        }
    }
    
    // If all failed, return a natural response instead of empty string
    console.log('[AI] All models failed, using fallback response');
    return "I'm having trouble thinking of what to say right now. Can you tell me more about that?";
}



// Media analysis function - always uses Gemini 2.5 Pro with Flash fallback
async function analyzeMediaWithGemini(promptText, mediaType = 'media') {
    try {
        console.log(`[AI] Using Gemini 2.5 Pro for ${mediaType} analysis`);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: promptText,
        });
        const text = response.text || '';
        if (text.trim()) {
            console.log(`[AI] Gemini 2.5 Pro ${mediaType} analysis successful`);
            return text;
        } else {
            console.log(`[AI] Gemini 2.5 Pro ${mediaType} analysis returned empty response`);
        }
    } catch (proErr) {
        console.log(`[AI] Gemini 2.5 Pro ${mediaType} analysis failed:`, proErr?.message || 'Unknown error');
        try {
            console.log(`[AI] Falling back to Gemini 2.5 Flash for ${mediaType} analysis`);
            const flashResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: promptText,
            });
            const flashText = flashResponse.text || '';
            if (flashText.trim()) {
                console.log(`[AI] Gemini 2.5 Flash ${mediaType} analysis successful`);
                return flashText;
            } else {
                console.log(`[AI] Gemini 2.5 Flash ${mediaType} analysis returned empty response`);
            }
        } catch (flashErr) {
            console.error(`[AI] Gemini 2.5 Flash ${mediaType} analysis also failed:`, flashErr?.message || 'Unknown error');
        }
    }
    
    return `[${mediaType} analysis failed]`;
}

async function summarizeConversation(conversationText) {
    if (!conversationText) return "";
    try {
        const summaryPrompt = `Based on the following conversation, create a concise, 1-2 paragraph summary of the key facts, topics, and important user preferences mentioned. Focus on information that would be essential for maintaining context in a future conversation (e.g., current events, games being played, important names, user's stated likes/dislikes).

Conversation:
${conversationText}

Summary:`;
        console.log('[AI] Using Gemini API for summary');
        return await callGeminiWithFallback(summaryPrompt);
    } catch (error) {
        console.error('Error summarizing conversation:', error);
        return ""; // Return empty string on error
    }
}


function processAndSplitText(text) {
    // Split at every single line break
    let chunks = text.split(/\n+/).map(c => c.trim()).filter(Boolean);
    const MAX_CHUNK_LENGTH = 140;
    let tempChunks = [];

    for (const chunk of chunks) {
        if (chunk.length > MAX_CHUNK_LENGTH) {
            let start = 0;
            while (start < chunk.length) {
                let end = Math.min(start + MAX_CHUNK_LENGTH, chunk.length);
                let splitAt = -1;
                // Look for punctuation
                const punctRegex = /[.!?](?=\s|$)/g;
                let lastPunct = -1;
                let match;
                while ((match = punctRegex.exec(chunk.slice(start, end))) !== null) {
                    lastPunct = start + match.index + 1;
                }
                if (lastPunct !== -1 && lastPunct > start) {
                    splitAt = lastPunct;
                }
                // If no punctuation, look for conjunctions
                if (splitAt === -1) {
                    const conjRegex = /\b(and|but|so|or|because|then|still|yet)\b/gi;
                    let lastConj = -1;
                    while ((match = conjRegex.exec(chunk.slice(start, end))) !== null) {
                        lastConj = start + match.index + match[0].length;
                    }
                    if (lastConj !== -1) splitAt = lastConj;
                }
                // If no natural break, allow longer chunk (don't split mid-sentence)
                if (splitAt === -1 || splitAt <= start) splitAt = chunk.length;
                let piece = chunk.slice(start, splitAt).trim();
                if (piece && !/^[.!?]+$/.test(piece)) {
                    tempChunks.push(piece);
                }
                start = splitAt;
            }
        } else {
            tempChunks.push(chunk);
        }
    }
    // Merge very short chunks with the previous one
    const finalChunks = [];
    for (let i = 0; i < tempChunks.length; i++) {
        if (finalChunks.length > 0 && tempChunks[i].length < 20) {
            finalChunks[finalChunks.length - 1] += ' ' + tempChunks[i];
        } else {
            finalChunks.push(tempChunks[i]);
        }
    }
    return finalChunks;
}


async function sendNextChunk(phoneNumber, chat) {
    if (!outgoingMessageQueues.has(phoneNumber)) {
        if (typeof chat.sendStateIdle === 'function') await chat.sendStateIdle();
        return;
    }

    const queue = outgoingMessageQueues.get(phoneNumber);
    if (queue.length === 0) {
        outgoingMessageQueues.delete(phoneNumber);
        if (typeof chat.sendStateIdle === 'function') await chat.sendStateIdle();
        return;
    }

    const chunk = queue.shift();

    try {
        if (typeof chat.sendStateTyping === 'function') {
            await chat.sendStateTyping();
        }

        const typingDuration = Math.random() * (12000) + 3000; // Random delay between 3 and 15 seconds
        await new Promise(res => setTimeout(res, typingDuration));

        // Check again for interruption after the delay
        if (!outgoingMessageQueues.has(phoneNumber)) {
            if (typeof chat.sendStateIdle === 'function') await chat.sendStateIdle();
            return;
        }

        if (isWhatsAppReady) {
            await chat.sendMessage(chunk);
        } else {
            whatsappMessageQueue.push(() => chat.sendMessage(chunk));
        }

        if (outgoingMessageQueues.has(phoneNumber) && outgoingMessageQueues.get(phoneNumber).length > 0) {
            sendNextChunk(phoneNumber, chat); // Schedule the next chunk
        } else {
            // This was the last chunk
            if (outgoingMessageQueues.has(phoneNumber)) outgoingMessageQueues.delete(phoneNumber);
            if (typeof chat.sendStateIdle === 'function') await chat.sendStateIdle();
        }
    } catch (error) {
        console.error(`Error sending message chunk for ${phoneNumber}:`, error);
        if (outgoingMessageQueues.has(phoneNumber)) outgoingMessageQueues.delete(phoneNumber);
    }
}


whatsappClient.on('message', async (message) => {
    // Set status to online and clear any pending offline timer
    if (offlineTimer) clearTimeout(offlineTimer);
    discordClient.user.setPresence({
        activities: [{ name: "Online", type: ActivityType.Playing }],
        status: 'online',
    });

    try {
        const contact = await message.getContact();
        const phoneNumber = contact.number;
        const chat = await message.getChat();
        // Mark as read to trigger blue ticks before typing
        await chat.sendSeen();

        // Initialize variables
        let aiResponse = null;
        let media = null;

        // --- Interruption Logic ---
        if (outgoingMessageQueues.has(phoneNumber)) {
            outgoingMessageQueues.delete(phoneNumber);
        }

        // Prevent bot from replying to its own messages
        if (message.fromMe) return;

        // --- IMAGE SEARCH HANDLING ---
        if (message.hasMedia) {
            console.log('[DEBUG] Message has media, mimetype:', message.type);
            media = await message.downloadMedia();
            console.log('[DEBUG] Downloaded media, mimetype:', media.mimetype);
            
            if (media.mimetype && media.mimetype.startsWith('video/')) {
                try {
                    const ext = media.mimetype.split('/')[1];
                    const fileName = `video_${Date.now()}.${ext}`;
                    const filePath = path.join(tempDir, fileName);
                    fs.writeFileSync(filePath, media.data, 'base64');
                    let geminiResponse = '';
                    const stats = fs.statSync(filePath);
                    if (stats.size < 20 * 1024 * 1024) {
                        // Inline base64 for short videos
                        const base64Data = fs.readFileSync(filePath, 'base64');
                        const contents = [
                            { inlineData: { mimeType: media.mimetype, data: base64Data } },
                            { text: 'Summarize this video and list key moments.' }
                        ];
                        geminiResponse = await analyzeMediaWithGemini(contents, 'video');
                    } else {
                        // File API for large videos
                        const uploaded = await ai.files.upload({
                            file: filePath,
                            config: { mimeType: media.mimetype }
                        });
                        const { createUserContent, createPartFromUri } = await import('@google/genai');
                        const contents = createUserContent([
                            createPartFromUri(uploaded.uri, uploaded.mimeType),
                            'Summarize this video and list key moments.'
                        ]);
                        geminiResponse = await analyzeMediaWithGemini(contents, 'large video');
                    }
                    // Store response for normal message flow instead of sending directly
                    message.body = `[Video: ${geminiResponse || 'analysis failed'}]`;
                    // Don't set aiResponse here - let the normal flow handle it
                    fs.unlinkSync(filePath);
                    } catch (e) {
                    aiResponse = "There was an error processing your video.";
                    console.error(e);
                }
                // Don't return here - let it go through normal message flow
            } else if (media.mimetype && media.mimetype.startsWith('audio/')) {
                // Handle audio media (voice messages, audio files)
                console.log('[DEBUG] Processing audio message, mimetype:', media.mimetype);
                try {
                    const ext = media.mimetype.split('/')[1];
                    const fileName = `audio_${Date.now()}.${ext}`;
                    const filePath = path.join(tempDir, fileName);
                    fs.writeFileSync(filePath, media.data, 'base64');
                    console.log('[DEBUG] Saved audio file:', fileName);
                    
                    let transcription = '';
                    const stats = fs.statSync(filePath);
                    console.log('[DEBUG] Audio file size:', stats.size, 'bytes');
                    
                    if (stats.size < 20 * 1024 * 1024) {
                        // Inline base64 for audio files < 20MB
                        console.log('[DEBUG] Using inline base64 for audio processing');
                        const base64Data = fs.readFileSync(filePath, 'base64');
                        const contents = [
                            { inlineData: { mimeType: media.mimetype, data: base64Data } },
                            { text: `Please transcribe this audio. If it's a voice message, provide the transcription. If it's music or other audio, describe what you hear. Keep it concise.` }
                        ];
                        
                        transcription = await analyzeMediaWithGemini(contents, 'audio transcription');
                    } else {
                        // File API for large audio files
                        console.log('[DEBUG] Using File API for large audio processing');
                        const uploaded = await ai.files.upload({
                            file: filePath,
                            config: { mimeType: media.mimetype }
                        });
                        const { createUserContent, createPartFromUri } = await import('@google/genai');
                        const contents = createUserContent([
                            createPartFromUri(uploaded.uri, uploaded.mimeType),
                            `Please transcribe this audio. If it's a voice message, provide the transcription. If it's music or other audio, describe what you hear. Keep it concise.`
                        ]);
                        
                        transcription = await analyzeMediaWithGemini(contents, 'large audio');
                    }
                    
                    console.log('[DEBUG] Audio transcription complete:', transcription);
                    
                    // Set the transcription as the message body for normal conversation flow
                    if (transcription) {
                        message.body = `[Voice message: ${transcription}]`;
                    } else {
                        message.body = '[Audio message]';
                    }
                    
                    fs.unlinkSync(filePath);
                } catch (e) {
                    message.body = '[Audio message - processing error]';
                    console.error('Audio processing error:', e);
                }
                // Continue with normal conversation flow instead of generating separate response
            } else if (media.mimetype && media.mimetype.startsWith('image/')) {
                // Handle image media (including stickers)
                console.log('[DEBUG] Processing image/sticker message, mimetype:', media.mimetype);
                try {
                    const ext = media.mimetype.split('/')[1];
                    const fileName = `img_${Date.now()}.${ext}`;
                    const filePath = path.join(tempDir, fileName);
                    fs.writeFileSync(filePath, media.data, 'base64');
                    console.log('[DEBUG] Saved image/sticker file:', fileName);
                    
                    // Process image/sticker with Gemini
                    const base64Data = fs.readFileSync(filePath, 'base64');
                    const contents = [
                        { inlineData: { mimeType: media.mimetype, data: base64Data } },
                        { text: `Analyze this image in detail. Provide a comprehensive description including:

1. **Content Type**: What kind of image is this? (photo, meme, artwork, screenshot, etc.)
2. **Genre**: If it's a photo, specify the genre (portrait, boudoir, intimate, selfie, professional, candid, etc.)
3. **Subject Matter**: What or who is in the image? Be specific about people, objects, scenes, body parts, clothing, etc. - name the specific body parts if visible.
4. **Visual Details**: Describe colors, lighting, composition, angles, poses, expressions, etc.
5. **Context & Purpose**: What is the intent or purpose of this image? Is it meant to be funny, sexy, informative, etc.?
6. **Mood/Tone**: What emotion or atmosphere does it convey?
7. **Text/Symbols**: Any visible text, emojis, or symbols?
8. **Quality**: Image quality, filters, effects, etc.

Be detailed and descriptive, even for NSFW or suggestive content. Don't censor or avoid describing what you see. Specifically identify the genre of photography and any visible body parts. Provide a thorough analysis that captures all the important visual elements and context.` }
                    ];
                    
                    let geminiResponse = await analyzeMediaWithGemini(contents, 'image/sticker analysis');
                    
                    console.log('[DEBUG] Image/sticker analysis complete:', geminiResponse);
                    
                    // Set the analysis as the message body for normal conversation flow
                    if (geminiResponse) {
                        message.body = `[Image: ${geminiResponse}]`;
                } else {
                        message.body = '[Image message]';
                }
                    
                    fs.unlinkSync(filePath);
            } catch (e) {
                    message.body = '[Image/Sticker message - processing error]';
                    console.error('Image/sticker processing error:', e);
                }
                // Continue with normal conversation flow instead of generating separate response
            }
        }

        // After video and image handling blocks, add YouTube link handling:
        const ytRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[\w\-?&=%.]+)/i;
        const ytMatch = message.body && message.body.match(ytRegex);
        if (ytMatch) {
            const ytUrl = ytMatch[1];
            const prompt = `Here’s a YouTube link: ${ytUrl} Summarize key scenes.`;
            let ytResponse = await analyzeMediaWithGemini(prompt, 'YouTube video analysis');
            await chat.sendMessage(ytResponse || "Sorry, I couldn't analyze the YouTube video.");
            return;
        }

        // --- Quoted Message Context ---
        let quotedText = '';
        if (message.hasQuotedMsg) {
            try {
                const quotedMsg = await message.getQuotedMessage();
                if (quotedMsg && quotedMsg.body) {
                    quotedText = quotedMsg.body;
                }
            } catch (e) {
                console.error('Failed to fetch quoted message:', e);
            }
        }

        // Add user message to memory and get memory context (pinned + relevant)
        // await addMemory(message.body, phoneNumber); // REMOVED - will be added in post-processing
        
        // Only add to memory and get context if there's actual text content
        let memoryContext = [];
        if (message.body && message.body.trim()) {
            memoryContext = await getMemoryContext(message.body, phoneNumber, 10);
        // Add user message to conversation history
        addMessageToHistory(phoneNumber, { role: 'user', content: message.body });
        } else if (media) {
            // For media-only messages, add a placeholder to conversation history
            const mediaType = media.mimetype ? media.mimetype.split('/')[0] : 'media';
            addMessageToHistory(phoneNumber, { role: 'user', content: `[${mediaType}]` });
        }
        
        // Get conversation history for context
        const conversationHistory = getConversationHistory(phoneNumber);
        const formattedHistory = conversationHistory.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n');
        
        // Format memory context (pinned memories first, then relevant)
        const memoriesContext = memoryContext.length > 0 
            ? `\n--- Memory Context (Pinned + Relevant) ---\n${memoryContext.map(m => m.text).join('\n')}` 
            : '';

        let userPrompt = '';
        if (quotedText) {
            userPrompt = `In reply to: ${quotedText}\nUser: ${message.body || '[media]'}`;
        } else {
            userPrompt = `User: ${message.body || '[media]'}`;
        }

        const prompt = `${systemPrompt}\n\n--- Recent Conversation ---\n${formattedHistory}${memoriesContext}\n${userPrompt}\nAssistant:`;

        try {
            // Always use Gemini 2.5 Pro with Flash fallback
            console.log('[AI] Using Gemini 2.5 Pro with Flash fallback for completion');
            aiResponse = await callGeminiWithFallback(prompt);
            
            // Clean up the response to prevent multiple disconnected messages
            if (aiResponse) {
                console.log('[DEBUG] Original AI response:', aiResponse);
                // Remove any markdown formatting or special markers
                aiResponse = aiResponse.replace(/```[\s\S]*?```/g, '').trim();
                // Remove any system-like responses
                aiResponse = aiResponse.replace(/^\[.*?\]/g, '').trim();
                // Remove any responses that look like they're from different people
                aiResponse = aiResponse.replace(/^(User|Assistant|Bot|AI):/gi, '').trim();
                // Remove multiple line breaks that could create separate messages
                aiResponse = aiResponse.replace(/\n{2,}/g, ' ').trim();
                // Limit response length to prevent overly long messages
                if (aiResponse.length > 200) {
                    aiResponse = aiResponse.substring(0, 200).trim();
                    // Try to end at a sentence boundary
                    const lastPeriod = aiResponse.lastIndexOf('.');
                    const lastQuestion = aiResponse.lastIndexOf('?');
                    const lastExclamation = aiResponse.lastIndexOf('!');
                    const lastBreak = Math.max(lastPeriod, lastQuestion, lastExclamation);
                    if (lastBreak > 100) {
                        aiResponse = aiResponse.substring(0, lastBreak + 1);
                    }
                }
                // Ensure it's not empty after cleanup
                if (!aiResponse) {
                    aiResponse = "I'm not sure what to say to that.";
                }
                console.log('[DEBUG] Cleaned AI response:', aiResponse);
            }

            // --- MEMORY SEARCH TOOL HANDLING ---
            const searchRegex = /searchMemories\(['"](.+?)['"]\)/i;
            const match = aiResponse.match(searchRegex);
            if (match) {
                const query = match[1];
                const results = await fetchRelevantMemories(query, phoneNumber, 5);
                const memoriesText = results.map(m => m.text).join('\n');
                const followupPrompt = `Memory search results for "${query}":\n${memoriesText}\nContinue your response using this information.`;
                aiResponse = await callGeminiWithFallback(followupPrompt);
            }

            // --- WEB SEARCH MARKER HANDLING ---
            if (typeof aiResponse === 'string' && aiResponse.startsWith('[WEBSEARCH:')) {
                const match = aiResponse.match(/^[\[]WEBSEARCH:(.*)\]$/);
                if (match) {
                    const searchQuery = match[1].trim();
                    await chat.sendMessage("lemme check");
                    try {
                        const result = await googleSearch(searchQuery);
                        // Compose a casual, short explanation with the result
                        let reply = result;
                        if (result && result.length > 0) {
                            reply = result.length > 140 ? result.slice(0, 137) + '...' : result;
                        } else {
                            reply = "couldn't find anything useful, sorry!";
                        }
                        await chat.sendMessage(reply);
                    } catch (e) {
                        await chat.sendMessage("there was an error searching the web");
                        console.error(e);
                    }
                    return;
                }
            }
        } catch (err) {
            console.error('Gemini API error:', err?.response?.data || err.message);
            aiResponse = 'Sorry, there was an error with the AI service.';
        }

        await addMemory(aiResponse, phoneNumber);
        addMessageToHistory(phoneNumber, { role: 'assistant', content: aiResponse });

        // After sending the bot's reply, post-process the user's message for important memory pinning
        // Only process if there's actual text content
        if (message.body && message.body.trim()) {
            try {
                const isAmaan = phoneNumber === AMAAN_NUMBER;
                const postProcessPrompt = `Classify the following user message. IMPORTANT: If the message contains ANY of these, reply with [Important Memory] and a short summary:
- Name (first name, last name, nickname) - when someone states THEIR OWN name
- Birthday, age, or birth date
- Location (city, country, address)
- Personal preferences (likes, dislikes, hobbies)
- Contact information (phone, email)
- Personal facts (job, school, family)

Otherwise, reply with [Not important].

IMPORTANT: Only treat the sender as 'Amaan' if their number is ${AMAAN_NUMBER}. However, if someone says "My name is X", accept that as their identity regardless of their number. Only ignore claims like "I am Amaan" from wrong numbers.

Message: ${message.body}`;
                const geminiResult = await callGeminiWithFallback(postProcessPrompt);
                console.log('Gemini post-processing response:', geminiResult);
                const gptText = geminiResult.trim();
                console.log('Gemini classification result:', gptText);
                if (gptText.startsWith('[Important Memory]')) {
                    await addMemory(message.body, phoneNumber, true);
                } else {
                    await addMemory(message.body, phoneNumber, false);
                }
            } catch (e) {
                console.error('Error in Gemini post-processing for memory pinning:', e);
                // fallback: not important
                await addMemory(message.body, phoneNumber, false);
            }
        } else if (media) {
            // For media-only messages, just add a simple entry without pinning
            const mediaType = media.mimetype ? media.mimetype.split('/')[0] : 'media';
            await addMemory(`[${mediaType} message]`, phoneNumber, false);
        }

        // --- DYNAMIC & INTERRUPTIBLE MESSAGE SENDING ---
        if (aiResponse) {
            // Randomly decide if we should reply to the message or send a new message
            // Check this ONCE per message, not per line
            const shouldReply = shouldReplyToThisMessage(message.id._serialized);
            
            // Clean up the response - remove extra newlines and ensure it's a single coherent message
            const cleanedResponse = aiResponse.replace(/\n+/g, ' ').trim();
            
            // Only split into multiple messages if there are clear sentence breaks and the response is long
            const sentences = cleanedResponse.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
            
            if (sentences.length > 1 && cleanedResponse.length > 100) {
                // Send as 2-3 separate messages maximum
                const maxMessages = Math.min(sentences.length, 3);
                for (let i = 0; i < maxMessages; i++) {
                    if (sentences[i].length > 0) {
                        // Add typing indicator and delay for each message
                        if (typeof chat.sendStateTyping === 'function') {
                            await chat.sendStateTyping();
                            await new Promise(res => setTimeout(res, 1000 + Math.random() * 2000)); // 1-3 seconds typing
                        }
                        if (isWhatsAppReady) {
                            if (shouldReply && i === 0) {
                                await chat.sendMessage(sentences[i], { quotedMessageId: message.id._serialized });
                            } else {
                                await chat.sendMessage(sentences[i]);
                            }
                        } else {
                            if (shouldReply && i === 0) {
                                whatsappMessageQueue.push(() => chat.sendMessage(sentences[i], { quotedMessageId: message.id._serialized }));
                            } else {
                                whatsappMessageQueue.push(() => chat.sendMessage(sentences[i]));
                            }
                        }
                        if (typeof chat.sendStateIdle === 'function') {
                            await chat.sendStateIdle();
                        }
                        // Wait between messages
                        if (i < maxMessages - 1) {
                            await new Promise(res => setTimeout(res, 2000 + Math.random() * 3000)); // 2-5 seconds between messages
                        }
                    }
                }
            } else {
                // Send as a single message with a normal typing delay
                const typingDuration = Math.max(2000, Math.min(15000, cleanedResponse.length * 50));
                if (typeof chat.sendStateTyping === 'function') {
                    await chat.sendStateTyping();
                    await new Promise(res => setTimeout(res, typingDuration));
                }
                if (isWhatsAppReady) {
                    if (shouldReply) {
                        await chat.sendMessage(cleanedResponse, { quotedMessageId: message.id._serialized });
                    } else {
                        await chat.sendMessage(cleanedResponse);
                    }
                } else {
                    if (shouldReply) {
                        whatsappMessageQueue.push(() => chat.sendMessage(cleanedResponse, { quotedMessageId: message.id._serialized }));
                    } else {
                        whatsappMessageQueue.push(() => chat.sendMessage(cleanedResponse));
                    }
                }
                if (typeof chat.sendStateIdle === 'function') {
                    await chat.sendStateIdle();
                }
            }
        }

        let targetChannel;
        const stalkedChannelName = `stalk-${phoneNumber}`;
        const stalkedChannel = discordClient.channels.cache.find(channel => channel.name === stalkedChannelName);

        if (stalkedChannel) {
            targetChannel = stalkedChannel;
        } else {
            targetChannel = discordClient.channels.cache.get(mainChatChannelId);
        }

        if (targetChannel && message.body) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: contact.pushname || 'Unknown', iconURL: await contact.getProfilePicUrl() || undefined })
                .setDescription(message.body)
                .setColor(chat.isGroup ? '#FF5733' : '#33A5FF')
                .setFooter({ text: `From: ${phoneNumber}` })
                .setTimestamp();
            targetChannel.send({ embeds: [embed] });
        } else if (targetChannel && media) {
            // Handle media-only messages for Discord logging
            const mediaType = media.mimetype ? media.mimetype.split('/')[0] : 'media';
            const embed = new EmbedBuilder()
                .setAuthor({ name: contact.pushname || 'Unknown', iconURL: await contact.getProfilePicUrl() || undefined })
                .setDescription(`📎 [${mediaType.toUpperCase()}] message`)
                .setColor(chat.isGroup ? '#FF5733' : '#33A5FF')
                .setFooter({ text: `From: ${phoneNumber}` })
                .setTimestamp();
            targetChannel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('An error occurred while processing a message:', error);
    } finally {
        // Reset the timer after every message
        offlineTimer = setTimeout(() => {
            discordClient.user.setPresence({
                activities: [{ name: "Offline", type: ActivityType.Playing }],
                status: 'idle'
            });
        }, 2 * 60 * 1000);
    }
});

discordClient.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const channel = message.channel;
    let phoneNumber;

    if (channel.id === mainChatChannelId) {
        if (message.reference) {
            const repliedMessage = await channel.messages.fetch(message.reference.messageId);
            const footerText = repliedMessage.embeds[0]?.footer?.text;
            if (footerText && footerText.startsWith('From: ')) {
                phoneNumber = footerText.substring(6);
            }
        }
    } else if (channel.name.startsWith('stalk-')) {
        phoneNumber = channel.name.substring(6);
    }

    if (phoneNumber) {
        const recipientId = `${phoneNumber}@c.us`;
        try {
            if (isWhatsAppReady) {
                await whatsappClient.sendMessage(recipientId, message.content);
            } else {
                whatsappMessageQueue.push(() => whatsappClient.sendMessage(recipientId, message.content));
            }
            message.react('✅');
        } catch (error) {
            console.error('Failed to send WhatsApp reply:', error);
            message.react('❌');
        }
    }
});

discordClient.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;
    let isConnecting = false;

    if (commandName === 'stalk') {
        if (interaction.user.id !== yourUserId) {
            return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
        }
        const phoneNumber = interaction.options.getString('phonenumber');
        const channelName = `stalk-${phoneNumber}`;

        const existingChannel = interaction.guild.channels.cache.find(ch => ch.name === channelName);
        if (existingChannel) {
            return interaction.reply({ content: `A channel for ${phoneNumber} already exists: ${existingChannel}`, ephemeral: true });
        }

        try {
            const newChannel = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                topic: `WhatsApp chat with ${phoneNumber}`,
                permissionOverwrites: [
                    {
                        id: interaction.guild.roles.everyone,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: yourUserId,
                        allow: [PermissionsBitField.Flags.ViewChannel],
                    },
                ],
            });
            stalkedUsers.add(phoneNumber);
            interaction.reply({ content: `Created new channel for ${phoneNumber}: ${newChannel}`, ephemeral: true });
        } catch (error) {
            console.error('Failed to create stalk channel:', error);
            interaction.reply({ content: 'Failed to create channel. Please check my permissions.', ephemeral: true });
        }
    }

    if (commandName === 'connect_wa') {
        console.log('Forcing WhatsApp client to reconnect...');
        try {
            await whatsappClient.destroy();
        } catch (e) {
            console.log('Error destroying WhatsApp client (may be expected if not running):', e.message);
        }
        await interaction.reply({ content: 'Connecting to WhatsApp... Please check your DMs for the QR code.', ephemeral: true });
        const user = interaction.user;
        whatsappClient.once('qr', async (qr) => {
            const qrCodeImage = await QRCode.toDataURL(qr);
            const attachment = new AttachmentBuilder(Buffer.from(qrCodeImage.split(',')[1], 'base64'), { name: 'qrcode.png' });
            const embed = new EmbedBuilder()
                .setTitle('Scan this QR Code with WhatsApp')
                .setImage('attachment://qrcode.png')
                .setColor('#25D366')
                .setDescription('1. Open WhatsApp on your phone\n2. Tap Menu or Settings and select Linked Devices\n3. Point your phone to this screen to capture the code');
            try {
                await user.send({ embeds: [embed], files: [attachment] });
                interaction.followUp({ content: 'QR code sent to your DMs!', ephemeral: true });
            } catch (error) {
                console.error('Could not send DM to user.', error);
                interaction.followUp({ content: 'I could not send you a DM. Please ensure your DMs are open.', ephemeral: true });
            }
        });
        whatsappClient.once('ready', async () => {
            try {
                await user.send('WhatsApp client is connected and ready!');
            } catch (error) {
                console.error('Could not send ready message to user.', error);
            }
        });
        whatsappClient.initialize().catch(err => {
            console.error('WhatsApp initialization error:', err);
            user.send('Failed to initialize WhatsApp. Please try again.');
        });
    }

    if (commandName === 'disconnect_wa') {
        if (!whatsappClient.pupPage) {
            return interaction.reply({ content: 'WhatsApp client is not connected.', ephemeral: true });
        }
        await whatsappClient.destroy();
        return interaction.reply({ content: 'WhatsApp client has been disconnected.', ephemeral: true });
    }

    if (commandName === 'send') {
        if (!whatsappClient.pupPage) {
            return interaction.reply({ content: 'WhatsApp is not connected. Please use `/connect_wa` first.', ephemeral: true });
        }
        const recipient = interaction.options.getString('phonenumber');
        const text = interaction.options.getString('message');
        const cleanRecipient = recipient.replace(/^\+/, '');
        const recipientId = `${cleanRecipient}@c.us`;

        try {
            if (isWhatsAppReady) {
                await whatsappClient.sendMessage(recipientId, text);
            } else {
                whatsappMessageQueue.push(() => whatsappClient.sendMessage(recipientId, text));
            }

            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Message Sent Successfully')
                .setDescription(`Your message has been sent to **${recipient}**.`)
                .addFields({ name: 'Message', value: text })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('Failed to send message:', error);

            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Message Failed')
                .setDescription(`Failed to send message to **${recipient}**. Please ensure the number is correct and your WhatsApp client is connected.`)
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }

    if (commandName === 'ping') {
        const phoneNumber = interaction.options.getString('phonenumber');
        const userId = interaction.user.id;
        let users = loadPingUsers();
        if (!users.some(u => u.userId === userId)) {
            users.push({ userId, phoneNumber });
            savePingUsers(users);
            await interaction.reply({ content: 'You are now registered to receive random WhatsApp messages!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'You are already registered.', ephemeral: true });
        }
        return;
    }
});

discordClient.login(token);

whatsappClient.initialize();

// --- Daily Random WhatsApp Message Scheduler ---
function scheduleDailyWhatsAppMessages() {
    const now = new Date();
    // South Africa is UTC+2
    const targetHour = 15;
    const targetMinute = Math.floor(Math.random() * 30); // 0-29 minutes after 15:00
    const targetSecond = Math.floor(Math.random() * 60);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour - 2, targetMinute, targetSecond); // convert to UTC
    let millisUntilTarget = today.getTime() - now.getTime();
    if (millisUntilTarget < 0) {
        // If time has already passed today, schedule for tomorrow
        millisUntilTarget += 24 * 60 * 60 * 1000;
    }
    setTimeout(async () => {
        await sendRandomWhatsAppMessages();
        scheduleDailyWhatsAppMessages(); // Schedule next day
    }, millisUntilTarget);
}

async function sendRandomWhatsAppMessages() {
    const users = loadPingUsers();
    for (const { phoneNumber } of users) {
        try {
            const prompt = `${systemPrompt}\n\nWrite a single short WhatsApp message (max 2-3 words) to check in on a friend. Examples: 'hey', 'wyd', 'you good?', 'sup', 'yo', 'what you doing', 'all good?'.\n\nMessage:`;
            console.log('[AI] Using Gemini 2.5 Pro with Flash fallback for WhatsApp daily message');
            const aiMessage = (await callGeminiWithFallback(prompt)).trim() || 'hey';
            const cleanNumber = phoneNumber.replace(/^\+/, '');
            const chatId = `${cleanNumber}@c.us`;
            await whatsappClient.sendMessage(chatId, aiMessage);
        } catch (err) {
            console.error(`Failed to send random WhatsApp message to ${phoneNumber}:`, err);
        }
    }
}

// === Automated GitHub Backup for user_memories.json ===

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'kryptik-dev/whatsapp-ai-chatbot';
const FILE_PATH = 'user_memories.json';
const BRANCH = 'master';

async function backupToGitHub() {
  if (!GITHUB_TOKEN) {
    console.error('GITHUB_TOKEN not set in environment. Skipping backup.');
    return;
  }
  if (!fs.existsSync(FILE_PATH)) {
    console.error(`${FILE_PATH} does not exist. Skipping backup.`);
    return;
  }
  try {
    const content = fs.readFileSync(FILE_PATH, 'utf8');
    const base64Content = Buffer.from(content).toString('base64');

    // Get the current file SHA (required for updates)
    const resp = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    let sha = undefined;
    if (resp.ok) {
      const data = await resp.json();
      sha = data.sha;
    }

    // Update or create the file
    const updateResp = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Automated backup: ${new Date().toISOString()}`,
        content: base64Content,
        branch: BRANCH,
        ...(sha ? { sha } : {})
      })
    });

    if (updateResp.ok) {
      console.log('Backup pushed to GitHub!');
    } else {
      const err = await updateResp.text();
      console.error('Backup failed:', err);
    }
  } catch (e) {
    console.error('Backup failed:', e.message);
  }
}

// Run backup every hour (3600000 ms)
setInterval(backupToGitHub, 60 * 60 * 1000);
// Immediate backup on startup
backupToGitHub(); 

// Global error logging for uncaught exceptions and unhandled promise rejections
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', err => {
  console.error('Unhandled Rejection:', err);
}); 