require('dotenv').config({ path: './.env' });
const { Client: DiscordClient, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const { Client: WhatsAppClient, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const { systemPrompt } = require('./system_prompt');
const { getUserHistory, addMessage } = require('./memory_store');
const { isImageRequest, extractImagePrompt } = require('./image_utils');
const token = process.env.DISCORD_TOKEN;
const mainChatChannelId = process.env.MAIN_CHAT_CHANNEL_ID;
const yourUserId = process.env.YOUR_USER_ID;
const geminiApiKey = process.env.GEMINI_API;
const axios = require('axios');
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
    res.status(200).send('Bot is running');
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
    authStrategy: new LocalAuth({ clientId: "bot-account-main" })
});

const stalkedUsers = new Set();
const outgoingMessageQueues = new Map();

discordClient.on('ready', () => {
    console.log(`Logged in as ${discordClient.user.tag}!`);
});

function processAndSplitText(text) {
    // 1. Prioritize splitting by newlines, as these are intentional breaks.
    let chunks = text.split('\n').map(c => c.trim()).filter(Boolean);

    const finalChunks = [];
    const MAX_CHUNK_LENGTH = 150; // Allow slightly longer chunks

    // 2. If a chunk is still too long, split it further by words.
    for (const chunk of chunks) {
        if (chunk.length > MAX_CHUNK_LENGTH) {
            const words = chunk.split(' ');
            let currentSubChunk = "";
            for (const word of words) {
                if (currentSubChunk.length + word.length + 1 > MAX_CHUNK_LENGTH) {
                    finalChunks.push(currentSubChunk);
                    currentSubChunk = word;
                } else {
                    currentSubChunk = currentSubChunk ? `${currentSubChunk} ${word}` : word;
                }
            }
            if (currentSubChunk) {
                finalChunks.push(currentSubChunk);
            }
        } else {
            finalChunks.push(chunk);
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

        // Get and update persistent conversation history
        const history = await getUserHistory(phoneNumber);
        await addMessage(phoneNumber, { role: 'user', content: message.body });

        // Use only the last 30 messages for context
        const recentHistory = history.slice(-30);
        const formattedHistory = recentHistory.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n');
        const prompt = `${systemPrompt}\n\n${formattedHistory}\nUser: ${message.body}\nAssistant:`;

        let aiResponse = null;
        try {
            const geminiRes = await axios.post(
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent',
                {
                    contents: [{ parts: [{ text: prompt }] }]
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': geminiApiKey
                    }
                }
            );
            aiResponse = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';
        } catch (err) {
            console.error('Gemini API error:', err?.response?.data || err.message);
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
        const recipientId = `${recipient}@c.us`;

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
});

discordClient.login(token);

whatsappClient.initialize(); 