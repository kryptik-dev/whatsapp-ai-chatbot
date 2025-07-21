require('dotenv').config({ path: './.env' });
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { SlashCommandBuilder } = require('@discordjs/builders');
const clientId = '1396845385183396002';
const guildId = '1388981256037073040';
const token = process.env.DISCORD_TOKEN;

if (!token) {
    throw new Error('DISCORD_TOKEN is not set in the .env file.');
}

const commands = [
    new SlashCommandBuilder()
        .setName('send')
        .setDescription('Sends a message to a WhatsApp number.')
        .addStringOption(option =>
            option.setName('phonenumber')
                .setDescription('The phone number to send the message to (with country code)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The message to send')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('connect_wa')
        .setDescription('Connect to WhatsApp and receive the QR code in your DMs.'),
    new SlashCommandBuilder()
        .setName('disconnect_wa')
        .setDescription('Disconnect from WhatsApp and clear the session.'),
    new SlashCommandBuilder()
        .setName('stalk')
        .setDescription('Stalk a WhatsApp user and create a dedicated channel for their chats.')
        .addStringOption(option =>
            option.setName('phonenumber')
                .setDescription('The phone number to stalk (with country code)')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Register to receive random WhatsApp messages from the bot.')
        .addStringOption(option =>
            option.setName('phonenumber')
                .setDescription('Your WhatsApp number (with country code)')
                .setRequired(true)),
].map(command => command.toJSON());

const rest = new REST({ version: '9' }).setToken(token);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})(); 