import { GoogleGenAI } from '@google/genai';
import { systemPrompt } from '../system_prompt.js';
import { googleSearch } from '../web_search.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API });

class GeminiService {
    async getReply(userMessage, phoneNumber) {
        try {
            console.log('[Gemini] Getting reply for message:', userMessage);
            
            const prompt = `${systemPrompt}\n\nUser: ${userMessage}\nMiles:`;
            
            const response = await this.callGeminiWithFallback(prompt);
            
            // Clean up the response
            if (response) {
                let cleanedResponse = response.replace(/```[\s\S]*?```/g, '').trim();
                cleanedResponse = cleanedResponse.replace(/^\[.*?\]/g, '').trim();
                cleanedResponse = cleanedResponse.replace(/^(User|Assistant|Bot|AI):/gi, '').trim();
                cleanedResponse = cleanedResponse.replace(/\n{2,}/g, ' ').trim();
                
                // Limit response length
                if (cleanedResponse.length > 200) {
                    cleanedResponse = cleanedResponse.substring(0, 200).trim();
                    const lastPeriod = cleanedResponse.lastIndexOf('.');
                    const lastQuestion = cleanedResponse.lastIndexOf('?');
                    const lastExclamation = cleanedResponse.lastIndexOf('!');
                    const lastBreak = Math.max(lastPeriod, lastQuestion, lastExclamation);
                    if (lastBreak > 100) {
                        cleanedResponse = cleanedResponse.substring(0, lastBreak + 1);
                    }
                }
                
                if (!cleanedResponse) {
                    cleanedResponse = "I'm not sure what to say to that.";
                }
                
                return cleanedResponse;
            }
            
            return null;
            
        } catch (error) {
            console.error('[Gemini] Error getting reply:', error);
            return "Sorry, I'm having trouble thinking right now.";
        }
    }

    async getReplyWithContext(userPrompt, conversationHistory, memoryContext) {
        try {
            console.log('[Gemini] Getting reply with context and web search');
            
            // Check if the message needs web search
            const needsWebSearch = this.shouldUseWebSearch(userPrompt);
            
            let webSearchResults = '';
            if (needsWebSearch) {
                try {
                    console.log('[Gemini] Performing web search for:', userPrompt);
                    const searchQuery = this.extractSearchQuery(userPrompt);
                    const searchResults = await googleSearch(searchQuery);
                    if (searchResults) {
                        webSearchResults = `\n--- Web Search Results ---\n${searchResults}`;
                    }
                } catch (searchError) {
                    console.error('[Gemini] Web search failed:', searchError);
                }
            }
            
            const prompt = `${systemPrompt}\n\n--- Recent Conversation ---\n${conversationHistory}${memoryContext}${webSearchResults}\n${userPrompt}\nMiles:`;
            
            const response = await this.callGeminiWithFallback(prompt);
            
            // Clean up the response
            if (response) {
                let cleanedResponse = response.replace(/```[\s\S]*?```/g, '').trim();
                cleanedResponse = cleanedResponse.replace(/^\[.*?\]/g, '').trim();
                cleanedResponse = cleanedResponse.replace(/^(User|Assistant|Bot|AI):/gi, '').trim();
                cleanedResponse = cleanedResponse.replace(/\n{2,}/g, ' ').trim();
                
                // Limit response length
                if (cleanedResponse.length > 200) {
                    cleanedResponse = cleanedResponse.substring(0, 200).trim();
                    const lastPeriod = cleanedResponse.lastIndexOf('.');
                    const lastQuestion = cleanedResponse.lastIndexOf('?');
                    const lastExclamation = cleanedResponse.lastIndexOf('!');
                    const lastBreak = Math.max(lastPeriod, lastQuestion, lastExclamation);
                    if (lastBreak > 100) {
                        cleanedResponse = cleanedResponse.substring(0, lastBreak + 1);
                    }
                }
                
                if (!cleanedResponse) {
                    cleanedResponse = "I'm not sure what to say to that.";
                }
                
                return cleanedResponse;
            }
            
            return null;
            
        } catch (error) {
            console.error('[Gemini] Error getting reply with context:', error);
            return "Sorry, I'm having trouble thinking right now.";
        }
    }

    shouldUseWebSearch(userPrompt) {
        const searchKeywords = [
            'what is', 'who is', 'when is', 'where is', 'how to',
            'latest', 'news', 'weather', 'price', 'cost', 'review',
            'definition', 'meaning', 'history', 'facts', 'information',
            'current', 'recent', 'today', 'yesterday', 'tomorrow',
            'movie', 'film', 'show', 'game', 'book', 'restaurant',
            'hotel', 'flight', 'travel', 'destination', 'recipe',
            'tutorial', 'guide', 'instructions', 'steps', 'process'
        ];
        
        const lowerPrompt = userPrompt.toLowerCase();
        return searchKeywords.some(keyword => lowerPrompt.includes(keyword));
    }

    extractSearchQuery(userPrompt) {
        // Remove common conversation words and focus on the main topic
        const cleanPrompt = userPrompt
            .replace(/^(user|miles|assistant):/gi, '')
            .replace(/^(in reply to|responding to):/gi, '')
            .trim();
        
        // Take the first sentence or phrase as the search query
        const sentences = cleanPrompt.split(/[.!?]/);
        let searchQuery = sentences[0].trim();
        
        // If it's too short, try to get more context
        if (searchQuery.length < 10 && sentences.length > 1) {
            searchQuery = sentences.slice(0, 2).join(' ').trim();
        }
        
        // Limit search query length
        if (searchQuery.length > 100) {
            searchQuery = searchQuery.substring(0, 100).trim();
        }
        
        return searchQuery;
    }

    async getStructuredResponse(prompt) {
        try {
            console.log('[Gemini] Getting structured response for:', prompt);
            
            const response = await this.callGeminiWithFallback(prompt);
            
            if (response) {
                // Try to parse as JSON
                try {
                    const jsonMatch = response.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        return JSON.parse(jsonMatch[0]);
                    }
                } catch (parseError) {
                    console.error('[Gemini] Error parsing JSON response:', parseError);
                }
            }
            
            // Fallback to basic extraction
            return this.extractBasicTaskInfo(prompt);
            
        } catch (error) {
            console.error('[Gemini] Error getting structured response:', error);
            return this.extractBasicTaskInfo(prompt);
        }
    }

    extractBasicTaskInfo(message) {
        // Basic fallback extraction if Gemini fails
        const title = message.split(' ').slice(0, 5).join(' '); // First 5 words as title
        return {
            title: title,
            description: message,
            dueDate: null,
            priority: "medium",
            category: "other"
        };
    }

    async callGeminiWithFallback(promptText) {
        const groundingTool = { googleSearch: {} };
        const config = { tools: [groundingTool] };
        
        try {
            // Always try Gemini 2.5 Pro first
            console.log('[Gemini] Trying Gemini 2.5 Pro...');
            const proRes = await ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: promptText,
                config,
            });
            const proText = proRes.text || '';
            if (proText.trim()) {
                console.log('[Gemini] Gemini 2.5 Pro response successful');
                return proText;
            } else {
                console.log('[Gemini] Gemini 2.5 Pro returned empty response');
            }
        } catch (proErr) {
            console.log('[Gemini] Gemini 2.5 Pro failed:', proErr?.message || 'Unknown error');
            
            // Fallback to Gemini 2.5 Flash
            try {
                console.log('[Gemini] Trying Gemini 2.5 Flash as fallback...');
                const flashRes = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: promptText,
                    config,
                });
                const flashText = flashRes.text || '';
                if (flashText.trim()) {
                    console.log('[Gemini] Gemini 2.5 Flash fallback successful');
                    return flashText;
                } else {
                    console.log('[Gemini] Gemini 2.5 Flash fallback returned empty response');
                }
            } catch (flashErr) {
                console.error('[Gemini] Gemini 2.5 Flash fallback also failed:', flashErr?.message || 'Unknown error');
            }
        }
        
        // If all failed, return a natural response
        console.log('[Gemini] All models failed, using fallback response');
        return "I'm having trouble thinking of what to say right now. Can you tell me more about that?";
    }
}

export const gemini = new GeminiService();
