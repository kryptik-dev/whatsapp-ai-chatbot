import { taskManager } from './taskManager.js';
import { gemini } from '../services/gemini.js';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { addMemory, fetchRelevantMemories, getMemoryContext } from '../supabase_memories.js';
import { getConversationHistory, addMessageToHistory } from '../conversation_history.js';
import { emailService } from '../services/email.js';
import { systemPrompt } from '../system_prompt.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API });

export async function handleMessage(message, client) {
    const userMsg = message.body?.toLowerCase() || '';
    const phoneNumber = message.from.split('@')[0];
    const chat = await message.getChat();

    // Mark as read to trigger blue ticks before typing
    await chat.sendSeen();

    // Initialize variables
    let aiResponse = null;
    let media = null;

    // --- EMAIL CHECKING ---
    if (shouldCheckEmails(userMsg)) {
        console.log('[Miles] Email check triggered');
        await handleEmailCheck(chat);
        return;
    }

    // --- MEDIA PROCESSING ---
    if (message.hasMedia) {
        console.log('[Miles] Processing media message, mimetype:', message.type);
        media = await message.downloadMedia();
        console.log('[Miles] Downloaded media, mimetype:', media.mimetype);
        
        if (media.mimetype && media.mimetype.startsWith('video/')) {
            await processVideo(message, media, chat);
            return;
        } else if (media.mimetype && media.mimetype.startsWith('audio/')) {
            await processAudio(message, media, chat);
            return;
        } else if (media.mimetype && media.mimetype.startsWith('image/')) {
            await processImage(message, media, chat);
            return;
        }
    }

    // --- YOUTUBE LINK HANDLING ---
    const ytRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[\w\-?&=%.]+)/i;
    const ytMatch = message.body && message.body.match(ytRegex);
    if (ytMatch) {
        const ytUrl = ytMatch[1];
        const prompt = `Here's a YouTube link: ${ytUrl} Summarize key scenes.`;
        let ytResponse = await analyzeMediaWithGemini(prompt, 'YouTube video analysis');
        await chat.sendMessage(ytResponse || "Sorry, I couldn't analyze the YouTube video.");
        return;
    }

    // --- TASK MANAGEMENT ---
    // Auto handle task-like messages
    if (userMsg.includes('remind me') || 
        userMsg.includes('task') || 
        userMsg.includes('homework') ||
        userMsg.includes('test') ||
        userMsg.includes('exam') ||
        userMsg.includes('due') ||
        userMsg.includes('deadline') ||
        userMsg.includes('meeting') ||
        userMsg.includes('appointment') ||
        userMsg.includes('need to') ||
        userMsg.includes('have to') ||
        userMsg.includes('should') ||
        userMsg.includes('must')) {
        
        console.log('[Miles] Detected task-like message, routing to task manager');
        await taskManager.process(message, client);
        return;
    }

    // --- SCHOOL SCHEDULE IMPORT ---
    // Check for school schedule import triggers
    if (userMsg.includes('school schedule') || 
        userMsg.includes('assessment table') || 
        userMsg.includes('project dates') ||
        userMsg.includes('academic schedule') ||
        userMsg.includes('import my') ||
        (userMsg.includes('schedule') && (userMsg.includes('school') || userMsg.includes('class') || userMsg.includes('test') || userMsg.includes('exam')))) {
        
        console.log('[Miles] Detected school schedule import request');
        await taskManager.importSchoolSchedule(message, client);
        return;
    }

    // --- REGULAR CONVERSATION PROCESSING ---
    console.log('[Miles] Processing regular message with full context');
    
    // Get quoted message context
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

    // Add user message to memory and get memory context
    let memoryContext = [];
    if (message.body && message.body.trim()) {
        memoryContext = await getMemoryContext(message.body, phoneNumber, 10);
        addMessageToHistory(phoneNumber, { role: 'user', content: message.body });
    } else if (media) {
        const mediaType = media.mimetype ? media.mimetype.split('/')[0] : 'media';
        addMessageToHistory(phoneNumber, { role: 'user', content: `[${mediaType}]` });
    }
    
    // Get conversation history for context
    const conversationHistory = getConversationHistory(phoneNumber);
    const formattedHistory = conversationHistory.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n');
    
    // Format memory context
    const memoriesContext = memoryContext.length > 0 
        ? `\n--- Memory Context (Pinned + Relevant) ---\n${memoryContext.map(m => m.text).join('\n')}` 
        : '';

    let userPrompt = '';
    if (quotedText) {
        userPrompt = `In reply to: ${quotedText}\nUser: ${message.body || '[media]'}`;
    } else {
        userPrompt = `User: ${message.body || '[media]'}`;
    }

    // Get AI response using Gemini
    const reply = await gemini.getReplyWithContext(userPrompt, formattedHistory, memoriesContext);
    
    if (reply) {
        // Check for [TASKADD] identifier in the response
        const taskAddMatch = reply.match(/\[TASKADD\]\s*(.+)/i);
        if (taskAddMatch) {
            console.log('[Miles] Detected [TASKADD] identifier:', taskAddMatch[1]);
            
            // Create a modified message object for task processing
            const taskMessage = {
                ...message,
                body: taskAddMatch[1].trim()
            };
            
            // Process the task
            await taskManager.process(taskMessage, client);
        }
        
        // Remove [TASKADD] from the response before sending
        const cleanReply = reply.replace(/\[TASKADD\]\s*.+/i, '').trim();
        
        // Add AI response to memory and conversation history
        await addMemory(cleanReply, phoneNumber);
        addMessageToHistory(phoneNumber, { role: 'assistant', content: cleanReply });
        
        // Send the response (without the [TASKADD] part)
        if (cleanReply) {
            await chat.sendMessage(cleanReply);
        }
    }

    // Post-process user message for important memory pinning
    if (message.body && message.body.trim()) {
        await postProcessForMemoryPinning(message.body, phoneNumber);
    }
}

// Email checking methods
function shouldCheckEmails(userMsg) {
    const emailTriggers = [
        'check my emails',
        'any new emails',
        'check inbox',
        'read my emails',
        'show me emails',
        'email summary',
        'unread emails',
        'recent emails',
        'check gmail',
        'email update',
        'my emails',
        'check email'
    ];
    
    return emailTriggers.some(trigger => userMsg.includes(trigger));
}

async function handleEmailCheck(chat) {
    try {
        await chat.sendMessage('Checking your emails...');
        
        const emailSummary = await emailService.checkEmails(10);
        
        if (emailSummary) {
            await chat.sendMessage(emailSummary);
        } else {
            await chat.sendMessage('No emails found or email service not configured.');
        }
    } catch (error) {
        console.error('[Miles] Error checking emails:', error);
        await chat.sendMessage('Sorry, I had trouble checking your emails.');
    }
}

// Media processing functions
async function processVideo(message, media, chat) {
    try {
        const ext = media.mimetype.split('/')[1];
        const fileName = `video_${Date.now()}.${ext}`;
        const filePath = path.join(process.cwd(), 'temp', fileName);
        fs.writeFileSync(filePath, media.data, 'base64');
        
        let geminiResponse = '';
        const stats = fs.statSync(filePath);
        
        if (stats.size < 20 * 1024 * 1024) {
            // Inline base64 for short videos
            const base64Data = fs.readFileSync(filePath, 'base64');
            const contents = [
                { inlineData: { mimeType: media.mimetype, data: base64Data } },
                { text: `You are Miles, a helpful and friendly human assistant. Analyze this video and respond naturally like a friend would.

${systemPrompt}

Now analyze this video and respond in Miles' casual, friendly style. Summarize key moments and mention any people, places, events, or cultural references you recognize. Use web search if needed for additional context.

Keep your response short and natural, like a real person texting.` }
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
                `You are Miles, a helpful and friendly human assistant. Analyze this video and respond naturally like a friend would.

${systemPrompt}

Now analyze this video and respond in Miles' casual, friendly style. Summarize key moments and mention any people, places, events, or cultural references you recognize. Use web search if needed for additional context.

Keep your response short and natural, like a real person texting.`
            ]);
            geminiResponse = await analyzeMediaWithGemini(contents, 'large video');
        }
        
        await chat.sendMessage(geminiResponse || 'Video analysis failed');
        fs.unlinkSync(filePath);
    } catch (e) {
        await chat.sendMessage("There was an error processing your video.");
        console.error(e);
    }
}

async function processAudio(message, media, chat) {
    try {
        const ext = media.mimetype.split('/')[1];
        const fileName = `audio_${Date.now()}.${ext}`;
        const filePath = path.join(process.cwd(), 'temp', fileName);
        fs.writeFileSync(filePath, media.data, 'base64');
        
        let transcription = '';
        const stats = fs.statSync(filePath);
        
        if (stats.size < 20 * 1024 * 1024) {
            // Inline base64 for audio files < 20MB
            const base64Data = fs.readFileSync(filePath, 'base64');
            const contents = [
                { inlineData: { mimeType: media.mimetype, data: base64Data } },
                { text: `You are Miles, a helpful and friendly human assistant. Transcribe this audio and respond naturally like a friend would.

${systemPrompt}

Please transcribe this audio. If it's a voice message, provide the transcription. If it's music or other audio, describe what you hear. Keep it concise and respond in Miles' casual style.` }
            ];
            transcription = await analyzeMediaWithGemini(contents, 'audio transcription');
        } else {
            // File API for large audio files
            const uploaded = await ai.files.upload({
                file: filePath,
                config: { mimeType: media.mimetype }
            });
            const { createUserContent, createPartFromUri } = await import('@google/genai');
            const contents = createUserContent([
                createPartFromUri(uploaded.uri, uploaded.mimeType),
                `You are Miles, a helpful and friendly human assistant. Transcribe this audio and respond naturally like a friend would.

${systemPrompt}

Please transcribe this audio. If it's a voice message, provide the transcription. If it's music or other audio, describe what you hear. Keep it concise and respond in Miles' casual style.`
            ]);
            transcription = await analyzeMediaWithGemini(contents, 'large audio');
        }
        
        if (transcription) {
            await chat.sendMessage(transcription);
        } else {
            await chat.sendMessage('Audio message');
        }
        
        fs.unlinkSync(filePath);
    } catch (e) {
        await chat.sendMessage('Audio processing error');
        console.error('Audio processing error:', e);
    }
}

async function processImage(message, media, chat) {
    try {
        const ext = media.mimetype.split('/')[1];
        const fileName = `img_${Date.now()}.${ext}`;
        const filePath = path.join(process.cwd(), 'temp', fileName);
        fs.writeFileSync(filePath, media.data, 'base64');
        
        // Process image with Gemini
        const base64Data = fs.readFileSync(filePath, 'base64');
        const contents = [
            { inlineData: { mimeType: media.mimetype, data: base64Data } },
            { text: `You are Miles, a helpful and friendly human assistant. Analyze this image and respond naturally like a friend would.

${systemPrompt}

Now analyze this image and respond in Miles' casual, friendly style. Be detailed but conversational. Don't censor or avoid describing what you see. Use web search if needed to identify specific people, places, or cultural references.

**SCHOOL SCHEDULE DETECTION:**
If this image contains a school schedule, assessment table, project dates, academic calendar, or any educational deadlines, extract all tasks and add [TASKADD] for each one.

Examples of what to look for:
- Test dates and times
- Project deadlines
- Assignment due dates
- Exam schedules
- Presentation dates
- Lab report deadlines
- Essay submission dates

If you detect school-related content, respond naturally and then add [TASKADD] for each task found.

Keep your response short and natural, like a real person texting.` }
        ];
        
        let geminiResponse = await analyzeMediaWithGemini(contents, 'image/sticker analysis');
        
        if (geminiResponse) {
            // Check for [TASKADD] identifier in the response
            const taskAddMatch = geminiResponse.match(/\[TASKADD\]\s*(.+)/i);
            if (taskAddMatch) {
                console.log('[Miles] Detected [TASKADD] in image response:', taskAddMatch[1]);
                
                // Create a modified message object for task processing
                const taskMessage = {
                    ...message,
                    body: taskAddMatch[1].trim()
                };
                
                // Process the task
                await taskManager.process(taskMessage, message.client);
            }
            
            // Remove [TASKADD] from the response before sending
            const cleanResponse = geminiResponse.replace(/\[TASKADD\]\s*.+/i, '').trim();
            
            if (cleanResponse) {
                await chat.sendMessage(cleanResponse);
            }
        } else {
            await chat.sendMessage('Image message');
        }
        
        fs.unlinkSync(filePath);
    } catch (e) {
        await chat.sendMessage('Image processing error');
        console.error('Image processing error:', e);
    }
}

// Gemini media analysis with fallback
async function analyzeMediaWithGemini(promptText, mediaType = 'media') {
    try {
        console.log(`[Miles] Using Gemini 2.5 Pro for ${mediaType} analysis`);
        
        // Add grounding tool for web search
        const groundingTool = { googleSearch: {} };
        const config = { tools: [groundingTool] };
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: promptText,
            config,
        });
        const text = response.text || '';
        if (text.trim()) {
            console.log(`[Miles] Gemini 2.5 Pro ${mediaType} analysis successful`);
            return text;
        } else {
            console.log(`[Miles] Gemini 2.5 Pro ${mediaType} analysis returned empty response`);
        }
    } catch (proErr) {
        console.log(`[Miles] Gemini 2.5 Pro ${mediaType} analysis failed:`, proErr?.message || 'Unknown error');
        try {
            console.log(`[Miles] Falling back to Gemini 2.5 Flash for ${mediaType} analysis`);
            
            // Add grounding tool for web search
            const groundingTool = { googleSearch: {} };
            const config = { tools: [groundingTool] };
            
            const flashResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: promptText,
                config,
            });
            const flashText = flashResponse.text || '';
            if (flashText.trim()) {
                console.log(`[Miles] Gemini 2.5 Flash ${mediaType} analysis successful`);
                return flashText;
            } else {
                console.log(`[Miles] Gemini 2.5 Flash ${mediaType} analysis returned empty response`);
            }
        } catch (flashErr) {
            console.error(`[Miles] Gemini 2.5 Flash ${mediaType} analysis also failed:`, flashErr?.message || 'Unknown error');
        }
    }
    
    return `[${mediaType} analysis failed]`;
}

// Post-process user message for memory pinning
async function postProcessForMemoryPinning(messageBody, phoneNumber) {
    try {
        const AMAAN_NUMBER = '27766934588';
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

Message: ${messageBody}`;
        
        const geminiResult = await gemini.callGeminiWithFallback(postProcessPrompt);
        const gptText = geminiResult.trim();
        
        if (gptText.startsWith('[Important Memory]')) {
            await addMemory(messageBody, phoneNumber, true);
        } else {
            await addMemory(messageBody, phoneNumber, false);
        }
    } catch (e) {
        console.error('Error in post-processing for memory pinning:', e);
        await addMemory(messageBody, phoneNumber, false);
    }
}
