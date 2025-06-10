const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');

// Function to validate Figma key format
function isValidFigmaKey(key) {
    // Figma file keys are typically 32 characters long and contain alphanumeric characters
    return /^[a-zA-Z0-9]{32}$/.test(key);
}

// Function to validate text input
function isValidTextInput(text) {
    // Text should not be empty and should have a reasonable length
    return text && text.trim().length > 0 && text.trim().length <= 5000;
}

// Function to determine input type and validate
function determineInputType(input) {
    if (isValidFigmaKey(input)) {
        return 'figma';
    } else if (isValidTextInput(input)) {
        return 'text';
    }
    return 'invalid';
}

// Function to process input and return appropriate response
async function processInput(input) {
    const inputType = determineInputType(input);
    
    if (inputType === 'invalid') {
        throw new Error('Invalid input format. Please provide either a valid Figma key or text description.');
    }

    // Generate a unique job ID
    const jobId = uuidv4();
    
    // Create job entry in processing queue
    const jobData = {
        status: 'queued',
        progress: 0,
        message: 'Job queued',
        created: new Date(),
        inputType,
        input
    };

    return {
        jobId,
        jobData,
        inputType
    };
}

module.exports = {
    processInput,
    determineInputType,
    isValidFigmaKey,
    isValidTextInput
}; 