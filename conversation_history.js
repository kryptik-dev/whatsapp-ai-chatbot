const conversationHistories = {};
const maxHistoryLength = 10; 

const getConversationHistory = (userId) => {
    if (!conversationHistories[userId]) {
        conversationHistories[userId] = [];
    }
    return conversationHistories[userId];
};

const addMessageToHistory = (userId, message) => {
    const history = getConversationHistory(userId);
    history.push(message);
    if (history.length > maxHistoryLength) {
        history.shift(); 
    }
};

module.exports = {
    getConversationHistory,
    addMessageToHistory,
}; 