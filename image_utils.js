const gis = require('async-g-i-s');

// Simple keyword-based detection for image requests
function isImageRequest(message) {
    const triggers = [
        'draw',
        'generate an image',
        'show me a picture',
        'create an image',
        'make an image',
        'can you make a picture',
        'illustrate',
        'paint',
        'sketch',
        'image of',
        'picture of',
        'art of',
        'visualize',
        'render',
    ];
    const lower = message.toLowerCase();
    return triggers.some(trigger => lower.includes(trigger));
}

// Extract the image prompt from the message (basic version)
function extractImagePrompt(message) {
    // Remove trigger phrases for a cleaner prompt
    let prompt = message;
    [
        'draw',
        'generate an image',
        'show me a picture of',
        'show me a picture',
        'create an image of',
        'create an image',
        'make an image of',
        'make an image',
        'can you make a picture of',
        'can you make a picture',
        'illustrate',
        'paint',
        'sketch',
        'image of',
        'picture of',
        'art of',
        'visualize',
        'render',
    ].forEach(trigger => {
        prompt = prompt.replace(new RegExp(trigger, 'i'), '');
    });
    return prompt.trim();
}

// Search for an image using async-g-i-s
async function searchImage(query, options = {}) {
    const results = await gis(query, options);
    if (Array.isArray(results) && results.length > 0) {
        return results[0]; // Return the first image result
    }
    return null;
}

module.exports = { isImageRequest, extractImagePrompt, searchImage }; 