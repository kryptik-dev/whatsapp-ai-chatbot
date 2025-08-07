import googleIt from 'google-it';

export async function googleSearch(query) {
    try {
        const results = await googleIt({ query });
        if (Array.isArray(results) && results.length > 0) {
            // Prefer snippet, fallback to link
            return results[0].snippet || results[0].link || 'No result found.';
        } else {
            return "Sorry, I couldn't find an answer to your question.";
        }
    } catch (e) {
        console.error('[Web Search] Error:', e);
        return "Sorry, there was an error searching Google.";
    }
}

export async function googleSearchMultiple(queries) {
    for (const query of queries) {
        try {
            const result = await googleSearch(query);
            if (result && result.length > 10 && !result.includes('Sorry, I couldn\'t find')) {
                return result;
            }
        } catch (e) {
            console.error(`[Web Search] Error with query "${query}":`, e);
            continue;
        }
    }
    return "Sorry, I couldn't find an answer to your question.";
} 