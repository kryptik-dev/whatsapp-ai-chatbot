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
        return "Sorry, there was an error searching Google.";
    }
} 