const fs = require('fs').promises;
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'user_memories.json');
const MAX_HISTORY_LENGTH = 100;

// Load all memories from disk (or initialize if missing)
async function loadMemories() {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            await fs.writeFile(MEMORY_FILE, '{}');
            return {};
        }
        throw err;
    }
}

// Save all memories to disk
async function saveMemories(memories) {
    await fs.writeFile(MEMORY_FILE, JSON.stringify(memories, null, 2));
}

// Get a user's conversation history
async function getUserHistory(userId) {
    const memories = await loadMemories();
    return memories[userId] || [];
}

// Add a message to a user's history
async function addMessage(userId, message) {
    const memories = await loadMemories();
    if (!memories[userId]) memories[userId] = [];
    memories[userId].push(message);
    if (memories[userId].length > MAX_HISTORY_LENGTH) {
        memories[userId] = memories[userId].slice(-MAX_HISTORY_LENGTH);
    }
    await saveMemories(memories);
}

module.exports = {
    getUserHistory,
    addMessage,
}; 