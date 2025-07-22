require('dotenv').config({ path: './.env' });
const { Client: DiscordClient, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, ChannelType, PermissionsBitField, ActivityType } = require('discord.js');
const { Client: WhatsAppClient, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const { systemPrompt } = require('./system_prompt');
const { getUserMemory, addMessage, updateUserSummary } = require('./memory_store');
const { isImageRequest, extractImagePrompt } = require('./image_utils');
const FreeGPT3 = require('freegptjs');
const openai = new FreeGPT3();
const token = process.env.DISCORD_TOKEN;
const mainChatChannelId = process.env.MAIN_CHAT_CHANNEL_ID;
const yourUserId = process.env.YOUR_USER_ID;
const geminiApiKey = process.env.GEMINI_API;
const veniceOpenrouterApiKey = process.env.VENICE_OPENROUTER_API;
const axios = require('axios');
const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const PING_USERS_FILE = path.join(__dirname, 'ping_users.json');
function loadPingUsers() {
    if (!fs.existsSync(PING_USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(PING_USERS_FILE, 'utf8'));
}
function savePingUsers(users) {
    fs.writeFileSync(PING_USERS_FILE, JSON.stringify(users, null, 2));
}

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>WhatsApp Discord Bot</title></head>
            <body style="font-family: sans-serif; text-align: center; margin-top: 10%;">
                <h1>🤖 WhatsApp Discord Bot is running!</h1>
                <p>If you see this page, the bot server is online and healthy.</p>
            </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
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


async function summarizeConversation(conversationText) {
    if (!conversationText) return "";
    try {
        const summaryPrompt = `Based on the following conversation, create a concise, 1-2 paragraph summary of the key facts, topics, and important user preferences mentioned. Focus on information that would be essential for maintaining context in a future conversation (e.g., current events, games being played, important names, user's stated likes/dislikes).

Conversation:
${conversationText}

Summary:`;

        const geminiRes = await axios.post(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
            { contents: [{ parts: [{ text: summaryPrompt }] }] },
            { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey } }
        );
        return geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (error) {
        console.error('Error summarizing conversation:', error);
        return ""; // Return empty string on error
    }
}


function processAndSplitText(text) {
    // 1. Split by newlines first
    let chunks = text.split('\n').map(c => c.trim()).filter(Boolean);
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

        await chat.sendMessage(chunk);

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

        // --- Interruption Logic ---
        if (outgoingMessageQueues.has(phoneNumber)) {
            outgoingMessageQueues.delete(phoneNumber);
        }

        // Prevent bot from replying to its own messages
        if (message.fromMe) return;

        // --- Cooldown Logic ---
        // Removed cooldown logic

        // Add user message and then get the fresh memory
        await addMessage(phoneNumber, { role: 'user', content: message.body });
        let memory = await getUserMemory(phoneNumber);

        // --- Summarization with FreeGPT3 ---
        const currentCount = (userMessageCount.get(phoneNumber) || 0) + 1;
        userMessageCount.set(phoneNumber, currentCount);
        if (currentCount % 20 === 0) { // Every 20 messages
            const historyToSummarize = memory.history.slice(-40).map(msg => `${msg.role}: ${msg.content}`).join('\n');
            const summaryPrompt = `Summarize the following WhatsApp conversation in 1-2 paragraphs, focusing on key facts, topics, and user preferences.\n\nConversation:\n${historyToSummarize}\n\nSummary:`;
            openai.chat.completions.create({
                messages: [{ role: 'user', content: summaryPrompt }],
                model: 'gpt-3.5-turbo',
            }).then(chatCompletion => {
                const summary = chatCompletion.choices?.[0]?.message?.content || '';
                if (summary) updateUserSummary(phoneNumber, summary);
            }).catch(err => {
                console.error('FreeGPT3 summarization error:', err);
            });
        }

        // --- Removed Automatic Summarization Logic ---
        // Instead, always use last 20 messages for context
        const recentHistory = memory.history.slice(-20); // Use last 20 messages for immediate context
        const formattedHistory = recentHistory.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n');

        const prompt = `${systemPrompt}\n\n--- Recent Conversation ---\n${formattedHistory}\nUser: ${message.body}\nAssistant:`;

        let aiResponse = null;
        try {
            // Use OpenRouter Dolphin Mistral model
            const openRouterRes = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...recentHistory.map(msg => ({ role: msg.role, content: msg.content })),
                        { role: 'user', content: message.body }
                    ]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${veniceOpenrouterApiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            aiResponse = openRouterRes.data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
        } catch (err) {
            console.error('OpenRouter API error:', err?.response?.data || err.message);
            aiResponse = 'Sorry, there was an error with the AI service.';
        }

        await addMessage(phoneNumber, { role: 'assistant', content: aiResponse });

        // --- DYNAMIC & INTERRUPTIBLE MESSAGE SENDING ---
        if (aiResponse) {
            const chunks = processAndSplitText(aiResponse);

            if (chunks.length > 1) {
                // If the message should be split, queue it up and start sending
                outgoingMessageQueues.set(phoneNumber, chunks);
                sendNextChunk(phoneNumber, chat);
            } else {
                // Otherwise, send as a single message with a normal typing delay
                const typingDuration = Math.max(2000, Math.min(15000, aiResponse.length * 50));
                if (typeof chat.sendStateTyping === 'function') {
                    await chat.sendStateTyping();
                    await new Promise(res => setTimeout(res, typingDuration));
                }
                await chat.sendMessage(aiResponse);
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
            await whatsappClient.sendMessage(recipientId, message.content);
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
            await whatsappClient.sendMessage(recipientId, text);

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
            const openRouterRes = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: prompt }
                    ]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${veniceOpenrouterApiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            const aiMessage = openRouterRes.data.choices?.[0]?.message?.content?.trim() || 'hey';
            const cleanNumber = phoneNumber.replace(/^[+]/, '');
            const chatId = `${cleanNumber}@c.us`;
            await whatsappClient.sendMessage(chatId, aiMessage);
        } catch (err) {
            console.error(`Failed to send random WhatsApp message to ${phoneNumber}:`, err);
        }
    }
} 