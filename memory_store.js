const fs = require('fs').promises;
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'user_memories.json');
const MAX_HISTORY_LENGTH = 100;

// Load all memories from disk
async function loadMemories() {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        const memories = JSON.parse(data);
        // Ensure all user memories conform to the new structure
        for (const userId in memories) {
            if (Array.isArray(memories[userId])) {
                // This is the old format, convert it
                memories[userId] = {
                    history: memories[userId],
                    summary: "" 
                };
            }
        }
        return memories;
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
    await fs.writeFile(MEMORY_FILE, JSON.stringify(memories, null, 2), 'utf8');
}

// Get a user's entire memory object { history, summary }
async function getUserMemory(userId) {
    const memories = await loadMemories();
    if (!memories[userId]) {
        return { history: [], summary: "" };
    }
    return memories[userId];
}

// Add a message to a user's history
async function addMessage(userId, message) {
    const memories = await loadMemories();
    if (!memories[userId]) {
        memories[userId] = { history: [], summary: "" };
    }
    memories[userId].history.push(message);
    if (memories[userId].history.length > MAX_HISTORY_LENGTH) {
        memories[userId].history = memories[userId].history.slice(-MAX_HISTORY_LENGTH);
    }
    await saveMemories(memories);
}

// Update a user's summary
async function updateUserSummary(userId, summary) {
    const memories = await loadMemories();
    if (!memories[userId]) {
        memories[userId] = { history: [], summary: "" };
    }
    memories[userId].summary = summary;
    await saveMemories(memories);
}


module.exports = {
    getUserMemory,
    addMessage,
    updateUserSummary
}; 