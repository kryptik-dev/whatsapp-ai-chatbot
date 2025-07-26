const conversationHistories = {};
const maxHistoryLength = 10; 

export const getConversationHistory = (userId) => {
    if (!conversationHistories[userId]) {
        conversationHistories[userId] = [];
    }
    return conversationHistories[userId];
};

export const addMessageToHistory = (userId, message) => {
    const history = getConversationHistory(userId);
    history.push(message);
    if (history.length > maxHistoryLength) {
        history.shift(); 
    }
}; 