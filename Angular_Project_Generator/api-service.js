const fetch = require('node-fetch');

const GEMINI_API_KEY = "AIzaSyDxUk75ewiUAtSNEcNuORciU4TMT0mEJaM";

class ApiService {
    constructor() {
        this.GEMINI_API_KEY = GEMINI_API_KEY;
    }

    // Function to extract JSON from text
    extractJson(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[0]);
                } catch (e2) {
                    throw new Error('Could not extract valid JSON from response');
                }
            }
            throw new Error('No JSON found in response');
        }
    }

    // Function to make API call with retries
    async makeApiCall(prompt, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent?key=${this.GEMINI_API_KEY}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(prompt)
                    }
                );

                if (!response.ok) {
                    throw new Error(`API call failed: ${response.statusText}`);
                }

                const result = await response.json();
                const generatedText = result.candidates[0].content.parts[0].text;
                
                // Clean the response text
                const cleanedText = generatedText
                    .replace(/```json\n?|\n?```/g, '')
                    .replace(/```typescript\n?|\n?```/g, '')
                    .replace(/```javascript\n?|\n?```/g, '')
                    .replace(/```\n?|\n?```/g, '')
                    .trim();

                // Try to extract and parse JSON
                return this.extractJson(cleanedText);
            } catch (error) {
                console.error(`Attempt ${i + 1} failed:`, error);
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
    }
}

module.exports = new ApiService(); 