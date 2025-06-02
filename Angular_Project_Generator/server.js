// server.js - Main server process controller
const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
console.log(process.env.PATH);
const fetch = require("node-fetch");
const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const JSZip = require("jszip");
// Remove AWS SDK v2 import
// const { WorkSpaces } = require("aws-sdk");


const multer = require("multer");
const upload = multer({ dest: "uploads/" });

const app = express();
app.use(cors());
app.use(express.json());
// app.use(express.static("public"));
app.use(express.static(path.join(__dirname, "public")));
app.use("/previews", express.static(path.join(__dirname, "previews")));
app.use("/downloads", express.static(path.join(__dirname, "downloads")));

// Add a health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

const FIGMA_API_BASE = "https://api.figma.com/v1";
// const GEMINI_API_KEY = "AIzaSyDhav6ikaednz2ktbTbxo-X3nSALfwOHkE"
const GEMINI_API_KEY = "AIzaSyDxUk75ewiUAtSNEcNuORciU4TMT0mEJaM"
const FIGMA_TOKEN = "figd_r0hCx_IOCSCRwn1MGtib6g_cvWUdIvCO43YZBqpe"
const PORT = 3000;

const PROCESSING_QUEUE = new Map();

const LLMMemory = require("./memory-service");
const CodeAnalyzer = require("./code-analyzer");

const llmMemory = new LLMMemory();
const codeAnalyzer = new CodeAnalyzer(llmMemory);

// Middleware to log requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Add this before the route handlers
function updateJobStatus(jobId, status, progress, message, extras = {}) {
  if (!PROCESSING_QUEUE.has(jobId)) {
    console.warn(`Job ${jobId} not found in processing queue`);
    return;
  }

  const job = PROCESSING_QUEUE.get(jobId);
  const updatedJob = {
    ...job,
    status,
    progress,
    message,
    updated: new Date(),
    ...extras
  };

  PROCESSING_QUEUE.set(jobId, updatedJob);
  console.log(`[Job ${jobId}] ${status} (${progress}%): ${message}`);

  // Log additional details if provided
  if (Object.keys(extras).length > 0) {
    console.log(`[Job ${jobId}] Additional details:`, extras);
  }

  // If job is completed or failed, log the final state
  if (status === 'completed' || status === 'failed') {
    console.log(`[Job ${jobId}] Final state:`, {
      status,
      progress,
      message,
      duration: new Date() - job.created,
      ...extras
    });
  }
}

// Add this after the updateJobStatus function
function getJobStatus(jobId) {
  if (!PROCESSING_QUEUE.has(jobId)) {
    return null;
  }
  return PROCESSING_QUEUE.get(jobId);
}

// Route to handle Figma to Angular conversion
app.post("/api/convert", async (req, res) => {
  try {
    const { figmaKey } = req.body;

    if (!figmaKey) {
      return res.status(400).json({ error: "Figma file key is required" });
    }
    // Generate a unique job ID
    const jobId = uuidv4();
    // Create job entry in processing queue
    PROCESSING_QUEUE.set(jobId, {
      status: "queued",
      progress: 0,
      message: "Job queued",
      created: new Date(),
      figmaKey,
    });
    // Return job ID immediately
    res.status(202).json({
      jobId,
      message: "Conversion process started",
      status: "queued",
    });
    processFigmaToAngular(jobId, figmaKey);
  } catch (error) {
    console.error("Conversion request error:", error);
    res.status(500).json({ error: "Failed to start conversion process" });
  }
});

// New route for text-based input
app.post("/api/text-to-angular", async (req, res) => {
  try {
    const { description } = req.body;

    if (!description) {
      return res.status(400).json({ error: "Design description is required" });
    }
    const jobId = uuidv4();
    PROCESSING_QUEUE.set(jobId, {
      status: "queued",
      progress: 0,
      message: "Job queued - Processing design description",
      created: new Date(),
      description,
      inputType: "text",
    });
    res.status(202).json({
      jobId,
      message: "Design generation process started",
      status: "queued",
    });
    // Start the text-to-design process asynchronously
    processTextToAngular(jobId, description);
  } catch (error) {
    console.error("Text conversion request error:", error);
    res.status(500).json({ error: "Failed to start conversion process" });
  }
});

// New route for voice-based input
app.post("/api/voice-to-angular", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Voice file is required" });
    }

    const audioFilePath = req.file.path;
    const transcription = await convertVoiceToText(audioFilePath); // Get transcription
    const jobId = uuidv4();

    PROCESSING_QUEUE.set(jobId, {
      status: "queued",
      progress: 0,
      message: "Job queued - Processing voice command",
      created: new Date(),
      audioFile: req.file.path,
      inputType: "voice",
      transcription,
    });

    res.status(202).json({
      jobId,
      transcription, // Return transcription to frontend
      message: "Voice processing started",
      status: "queued",
    });

    // Start the voice-to-design process asynchronously
    processVoiceToAngular(jobId, req.file.path);
  } catch (error) {
    console.error("Voice conversion request error:", error);
    res.status(500).json({ error: "Failed to start conversion process" });
  }
});

// New function to process text input to Angular
async function processTextToAngular(jobId, description) {
  const jobData = PROCESSING_QUEUE.get(jobId);
  const workDir = path.join(__dirname, "workspaces", jobId);
  try {
    await fs.ensureDir(workDir);
    updateJobStatus(
      jobId,
      "processing",
      10,
      "Generating design from description"
    );

    // First, convert the text description to a design structure
    const designStructure = await generateDesignFromText(description);
    // Save the generated design
    await fs.writeJson(
      path.join(workDir, "design-structure.json"),
      designStructure,
      {
        spaces: 2,
      }
    );
    updateJobStatus(
      jobId,
      "processing",
      30,
      "Converting design to Angular code"
    );

    // Generate Angular code from the design structure
    const angularFiles = await generateAngularCode(designStructure);
    // Continue with the existing workflow (same as processFigmaToAngular)
    await continueAngularConversion(jobId, workDir, angularFiles);
  } catch (error) {
    console.error(`Error processing job ${jobId}:`, error);
    updateJobStatus(jobId, "failed", 0, `Conversion failed: ${error.message}`);
    try {
      await fs.remove(workDir);
    } catch (cleanupErr) {
      console.error(
        `Failed to clean up workspace for job ${jobId}:`,
        cleanupErr
      );
    }
  }
}

// New function to process voice input to Angular
async function processVoiceToAngular(jobId, audioFilePath) {
  try {
    updateJobStatus(jobId, "processing", 5, "Converting voice to text");
    const description = await convertVoiceToText(audioFilePath);
    const jobData = PROCESSING_QUEUE.get(jobId);
    jobData.description = description;
    PROCESSING_QUEUE.set(jobId, jobData);

    await processTextToAngular(jobId, description);
    await fs.remove(audioFilePath);

    // Add preview and download URLs to the job status
    const jobStatus = PROCESSING_QUEUE.get(jobId);
    jobStatus.previewUrl = `/previews/${jobId}/index.html`;
    jobStatus.downloadUrl = `/api/download/${jobId}`;
    PROCESSING_QUEUE.set(jobId, jobStatus);
  } catch (error) {
    console.error(`Error processing voice job ${jobId}:`, error);
    updateJobStatus(
      jobId,
      "failed",
      0,
      `Voice conversion failed: ${error.message}`
    );
  }
}

// Function to generate design structure from text description
async function generateDesignFromText(description) {
  const prompt = {
    contents: [{
      parts: [{
        text: `You are an expert Angular developer. Generate a complete Angular application based on this design structure:

${JSON.stringify(designStructure, null, 2)}

IMPORTANT: You must generate ALL of the following files with COMPLETE CODE CONTENT. Each file must contain actual, working code, not just placeholders.

REQUIRED FILES (with complete code content):

1. Configuration Files:
- tsconfig.json (with complete compiler options)
- tsconfig.app.json (with complete app configuration)
- tsconfig.spec.json (with complete test configuration)
- angular.json (with complete workspace and build configuration)
- package.json (with all required dependencies and scripts)

2. Source Files:
- src/main.ts (with complete bootstrap code)
- src/index.html (with complete HTML structure)
- src/styles.css (with complete global styles)
- src/polyfills.ts (with all required polyfills)
- src/environments/environment.ts (with complete environment configuration)
- src/environments/environment.prod.ts (with complete production configuration)

3. App Files:
- src/app/app.component.ts (with complete component code)
- src/app/app.component.html (with complete template)
- src/app/app.component.css (with complete styles)
- src/app/app.routes.ts (with complete routing configuration)
- src/app/app.config.ts (with complete app configuration)

4. Component Files:
For each component in the design structure, generate:
- [component-name].component.ts (with complete component code)
- [component-name].component.html (with complete template)
- [component-name].component.css (with complete styles)

5. Service Files:
For each service in the design structure, generate:
- [service-name].service.ts (with complete service code)

6. Model Files:
For each model in the design structure, generate:
- [model-name].model.ts (with complete model code)
- [model-name].interface.ts (with complete interface code)

CRITICAL REQUIREMENTS:
1. Every component MUST be standalone: true
2. Every component MUST import all its child components
3. Every component MUST add imported components to its imports array
4. Every component MUST have proper styleUrls configuration
5. Every component MUST use proper TypeScript types
6. Every service MUST be provided in root
7. Every route MUST have proper path and component configuration
8. Every model MUST have proper TypeScript interfaces
9. Every polyfill MUST be properly imported
10. Every configuration file MUST have complete settings

EXAMPLE FORMAT:
filepath: src/app/components/example/example.component.ts
---
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-example',
  standalone: true,
  imports: [CommonModule],
  template: \`
    <div class="example">
      <h1>Example Component</h1>
      <p>This is a complete example component.</p>
    </div>
  \`,
  styleUrls: ['./example.component.css']
})
export class ExampleComponent implements OnInit {
  constructor() {}

  ngOnInit(): void {
    // Initialize component
  }
}
---

filepath: src/app/components/example/example.component.html
---
<div class="example">
  <h1>Example Component</h1>
  <p>This is a complete example component.</p>
</div>
---

filepath: src/app/components/example/example.component.css
---
.example {
  display: block;
  width: 100%;
  padding: 20px;
}

.example h1 {
  color: #333;
  font-size: 24px;
}

.example p {
  color: #666;
  font-size: 16px;
}
---

IMPORTANT:
- Generate COMPLETE, WORKING code for each file
- Do not use placeholders or TODO comments
- Include all necessary imports
- Include all required decorators and configurations
- Include proper TypeScript types
- Include proper error handling
- Include proper documentation
- Follow Angular best practices
- Ensure all components are properly connected
- Ensure all services are properly implemented
- Ensure all models are properly defined
- Ensure all routes are properly configured

At the end of your response, provide a summary of all generated files with their paths.

${memoryGuidelines}`
      }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      topK: 40,
      topP: 0.8,
    }
  };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prompt)
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to generate design from text: ${response.statusText}`);
    }
    const result = await response.json();
    const designText = result.candidates[0].content.parts[0].text;
    
    // Clean and parse the JSON response
    try {
      // First, try to extract JSON from the response
      const jsonMatch = designText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON object found in the response");
      }
      
      // Clean the JSON string
      let cleanedJson = jsonMatch[0]
        .replace(/```json\n?|\n?```/g, "") // Remove code blocks
        .replace(/```typescript\n?|\n?```/g, "") // Remove TypeScript blocks
        .replace(/```javascript\n?|\n?```/g, "") // Remove JavaScript blocks
        .replace(/```\n?|\n?```/g, "") // Remove any remaining code blocks
        .replace(/(\w+):/g, '"$1":') // Add quotes to property names
        .replace(/'/g, '"') // Replace single quotes with double quotes
        .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
        .trim();

      // Additional cleaning for common JSON issues
      cleanedJson = cleanedJson
        .replace(/\n\s*\/\/.*/g, '') // Remove single-line comments
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Ensure property names are quoted
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Double pass to catch nested objects
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3'); // Triple pass for deeply nested objects

      // Parse the cleaned JSON
      const designStructure = JSON.parse(cleanedJson);
      
      // Validate the structure
      if (!designStructure.components || !designStructure.components.shared) {
        throw new Error("Invalid design structure: missing components");
      }

      return designStructure;
    } catch (parseError) {
      console.error("JSON parsing error:", parseError);
      console.error("Raw response:", designText);
      throw new Error("Failed to parse design structure: " + parseError.message);
    }
  } catch (error) {
    console.error("Failed to generate design from text:", error);
    throw error;
  }
}

async function convertVoiceToText(audioFilePath) {
  return new Promise((resolve, reject) => {
    console.log(`Processing audio file: ${audioFilePath}`);

    // Call the Python script
    const pythonProcess = spawn("python", [
      path.join(__dirname, "transcribe.py"),
      audioFilePath,
    ]);

    let transcription = "";
    let errorOutput = "";

    pythonProcess.stdout.on("data", (data) => {
      transcription += data.toString();
    });

    pythonProcess.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    pythonProcess.on("close", (code) => {
      if (code === 0) {
        resolve(transcription.trim());
      } else {
        console.error(`Transcription failed: ${errorOutput}`);
        reject(new Error(`Transcription failed with code ${code}`));
      }
    });
  });
}

// Function to continue the Angular conversion process
async function continueAngularConversion(jobId, workDir, angularFiles) {
  try {
    console.log(`Starting Angular conversion for job ${jobId}`);
    
    // First, ensure the workspace directory exists
    await fs.ensureDir(workDir);
    console.log(`Workspace directory created: ${workDir}`);

    // Create all required directories first
    const directories = new Set();
    Object.keys(angularFiles).forEach(filepath => {
      const dir = path.dirname(filepath);
      directories.add(dir);
    });

    for (const dir of directories) {
      const dirPath = path.join(workDir, dir);
      try {
        await fs.ensureDir(dirPath);
        console.log(`Created directory: ${dir}`);
      } catch (dirError) {
        console.error(`Failed to create directory ${dir}:`, dirError);
        throw new Error(`Failed to create directory ${dir}: ${dirError.message}`);
      }
    }

    // Write files with proper error handling
    for (const [filepath, content] of Object.entries(angularFiles)) {
      try {
        const fullPath = path.join(workDir, filepath);
        await fs.writeFile(fullPath, content);
        console.log(`Created file: ${filepath}`);
      } catch (fileError) {
        console.error(`Failed to write file ${filepath}:`, fileError);
        throw new Error(`Failed to write file ${filepath}: ${fileError.message}`);
      }
    }

    // Validate project structure
    await validateProjectStructure(workDir);
    console.log('Angular project created successfully');

    return true;
  } catch (error) {
    console.error("Failed to create Angular project:", error);
    throw error;
  }
}

// Route to accept manual feedback
app.post("/api/feedback/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const { type, description, pattern, correction } = req.body;
    if (!PROCESSING_QUEUE.has(jobId)) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (!type || !description) {
      return res
        .status(400)
        .json({ error: "Type and description are required" });
    }
    if (type === "success") {
      await llmMemory.addSuccess(pattern || "manual-feedback", description);
    } else if (type === "error") {
      await llmMemory.addError(
        pattern || "manual-feedback",
        description,
        correction
      );
    } else if (type === "rule") {
      await llmMemory.addRule(description, req.body.importance || "medium");
    } else {
      return res.status(400).json({ error: "Invalid feedback type" });
    }
    res.json({ message: "Feedback received", success: true });
  } catch (error) {
    console.error("Error processing feedback:", error);
    res.status(500).json({ error: "Failed to process feedback" });
  }
});

// Endpoint to get current system memory
app.get("/api/memory", async (req, res) => {
  try {
    const memoryContent = await llmMemory.getFormattedMemory(10);
    res.json({
      memory: llmMemory.memory,
      formatted: memoryContent,
    });
  } catch (error) {
    console.error("Error retrieving memory:", error);
    res.status(500).json({ error: "Failed to retrieve memory" });
  }
});
// Route to check job status
app.get("/api/status/:jobId", (req, res) => {
  const { jobId } = req.params;
  if (!PROCESSING_QUEUE.has(jobId)) {
    return res.status(404).json({ error: "Job not found" });
  }
  const jobStatus = PROCESSING_QUEUE.get(jobId);
  res.json(jobStatus);
});

// Main processing pipeline
async function processFigmaToAngular(jobId, figmaKey) {
  const jobData = PROCESSING_QUEUE.get(jobId);
  const workDir = path.join(__dirname, "workspaces", jobId);
  try {
    // Create workspace directory first
    await fs.ensureDir(workDir);
    console.log(`Created workspace directory: ${workDir}`);

    // Update job status
    updateJobStatus(jobId, "processing", 10, "Fetching Figma design data");

    // Agent 1: Fetch Figma JSON using API
    const figmaData = await fetchFigmaData(figmaKey);
    await fs.writeJson(path.join(workDir, "figma-data.json"), figmaData, {
      spaces: 2,
    });
    updateJobStatus(
      jobId,
      "processing",
      30,
      "Generating Angular code from Figma data"
    );

    // Agent 2 & 3: Generate Angular code using Gemini API
    const angularFiles = await generateAngularCode(figmaData);
    
    // Write all files with proper error handling
    console.log(`Writing ${Object.keys(angularFiles).length} files to workspace...`);
    for (const [filepath, content] of Object.entries(angularFiles)) {
      try {
        const fullPath = path.join(workDir, filepath);
        const dirPath = path.dirname(fullPath);
        
        // Ensure the directory exists
        await fs.ensureDir(dirPath);
        
        // Write the file
        await fs.writeFile(fullPath, content);
        console.log(`Successfully wrote file: ${filepath}`);
        
        // Verify the file was written
        const fileExists = await fs.pathExists(fullPath);
        if (!fileExists) {
          throw new Error(`File ${filepath} was not written successfully`);
        }
      } catch (fileError) {
        console.error(`Failed to write file ${filepath}:`, fileError);
        throw new Error(`Failed to write file ${filepath}: ${fileError.message}`);
      }
    }

    // Verify all required files exist before proceeding
    const requiredFiles = [
      'src/main.ts',
      'src/index.html',
      'src/styles.css',
      'src/app/app.component.ts',
      'src/app/app.component.html',
      'src/app/app.component.css',
      'src/app/app.routes.ts',
      'tsconfig.json',
      'angular.json',
      'package.json'
    ];

    console.log('Verifying required files...');
    for (const file of requiredFiles) {
      const filePath = path.join(workDir, file);
      const exists = await fs.pathExists(filePath);
      if (!exists) {
        throw new Error(`Required file ${file} is missing after file writing`);
      }
      console.log(`Verified required file exists: ${file}`);
    }

    updateJobStatus(jobId, "processing", 50, "Creating Angular project structure");
    
    // Create Angular project structure
    await continueAngularConversion(jobId, workDir, angularFiles);

    // Create downloadable ZIP of the project
    const zipPath = await createProjectZip(workDir, jobId);
    
    // Update job as completed
    updateJobStatus(
      jobId,
      "completed",
      100,
      "Project files generated successfully",
      {
        downloadUrl: `/api/download/${jobId}`,
      }
    );

    // Schedule cleanup
    setTimeout(() => {
      cleanupJob(jobId);
    }, 2 * 60 * 60 * 1000);

  } catch (error) {
    console.error(`Error processing job ${jobId}:`, error);
    updateJobStatus(jobId, "failed", 0, `Conversion failed: ${error.message}`);
    try {
      await fs.remove(workDir);
    } catch (cleanupErr) {
      console.error(
        `Failed to clean up workspace for job ${jobId}:`,
        cleanupErr
      );
    }
  }
}

// Agent 1: Fetch Figma data
async function fetchFigmaData(figmaKey) {
  try {
    const response = await fetch(`${FIGMA_API_BASE}/files/${figmaKey}`, {
      headers: {
        "X-Figma-Token": FIGMA_TOKEN,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `Figma API error: ${errorData.status || response.status}`
      );
    }
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch Figma data:", error);
    throw new Error(`Failed to fetch Figma data: ${error.message}`);
  }
}

async function generateAngularCode(designStructure) {
  try {
    // Validate design structure
    if (!designStructure || typeof designStructure !== 'object') {
      throw new Error('Invalid design structure provided');
    }

    const memoryGuidelines = await llmMemory.getFormattedMemory();
    
    // Prepare the prompt with better structure and validation
    const prompt = {
      contents: [{
        parts: [{
          text: `You are an expert Angular developer. Generate a complete Angular application based on this design structure:

${JSON.stringify(designStructure, null, 2)}

IMPORTANT: You must generate ALL of the following files with COMPLETE CODE CONTENT. Each file must contain actual, working code, not just placeholders.

REQUIRED FILES (with complete code content):

1. Configuration Files:
- tsconfig.json (with complete compiler options)
- tsconfig.app.json (with complete app configuration)
- tsconfig.spec.json (with complete test configuration)
- angular.json (with complete workspace and build configuration)
- package.json (with all required dependencies and scripts)

2. Source Files:
- src/main.ts (with complete bootstrap code)
- src/index.html (with complete HTML structure)
- src/styles.css (with complete global styles)
- src/polyfills.ts (with all required polyfills)
- src/environments/environment.ts (with complete environment configuration)
- src/environments/environment.prod.ts (with complete production configuration)

3. App Files:
- src/app/app.component.ts (with complete component code)
- src/app/app.component.html (with complete template)
- src/app/app.component.css (with complete styles)
- src/app/app.routes.ts (with complete routing configuration)
- src/app/app.config.ts (with complete app configuration)

4. Component Files:
For each component in the design structure, generate:
- [component-name].component.ts (with complete component code)
- [component-name].component.html (with complete template)
- [component-name].component.css (with complete styles)

5. Service Files:
For each service in the design structure, generate:
- [service-name].service.ts (with complete service code)

6. Model Files:
For each model in the design structure, generate:
- [model-name].model.ts (with complete model code)
- [model-name].interface.ts (with complete interface code)

CRITICAL REQUIREMENTS:
1. Every component MUST be standalone: true
2. Every component MUST import all its child components
3. Every component MUST add imported components to its imports array
4. Every component MUST have proper styleUrls configuration
5. Every component MUST use proper TypeScript types
6. Every service MUST be provided in root
7. Every route MUST have proper path and component configuration
8. Every model MUST have proper TypeScript interfaces
9. Every polyfill MUST be properly imported
10. Every configuration file MUST have complete settings

FORMAT YOUR RESPONSE EXACTLY LIKE THIS FOR EACH FILE:

filepath: [exact file path]
---
[complete file content]
---

For example:
filepath: src/app/app.component.ts
---
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  template: \`
    <div>Hello World</div>
  \`,
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'my-app';
}
---

IMPORTANT:
- Generate COMPLETE, WORKING code for each file
- Do not use placeholders or TODO comments
- Include all necessary imports
- Include all required decorators and configurations
- Include proper TypeScript types
- Include proper error handling
- Include proper documentation
- Follow Angular best practices
- Ensure all components are properly connected
- Ensure all services are properly implemented
- Ensure all models are properly defined
- Ensure all routes are properly configured

At the end of your response, provide a summary of all generated files with their paths.

${memoryGuidelines}`
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        topK: 40,
        topP: 0.8,
      }
    };

    // Make API call with retry logic
    let retries = 3;
    let lastError = null;

    while (retries > 0) {
      try {
        console.log(`Attempting API call (${retries} retries left)...`);
        
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify(prompt)
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          console.error("API Error Response:", errorData);
          throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
        }

        const result = await response.json();
        console.log("API Response Status:", response.status);
        
        if (!result.candidates || result.candidates.length === 0) {
          console.error("No candidates in API response:", result);
          throw new Error("No response generated from Gemini API");
        }

        const generatedCode = result.candidates[0].content.parts[0].text;
        console.log("Raw API response length:", generatedCode.length);
        console.log("First 500 characters of response:", generatedCode.substring(0, 500));

        // Parse the generated code into files
        const files = {};
        const filePattern = /filepath:\s*([^\n]+)\n---\n([\s\S]*?)(?=\n---|$)/g;
        let match;
        let fileCount = 0;
    
        while ((match = filePattern.exec(generatedCode)) !== null) {
          const [_, filepath, content] = match;
          if (filepath && content) {
            files[filepath.trim()] = content.trim();
            fileCount++;
            console.log(`Parsed file ${fileCount}: ${filepath.trim()}`);
          }
        }

        // If no files were found with the standard pattern, try parsing code blocks
        if (Object.keys(files).length === 0) {
          const codeBlockPattern = /```(?:json|typescript|html|css)\n([\s\S]*?)```/g;
          const filePathPattern = /filepath:\s*([^\n]+)/g;
          let filePaths = [];
          let filePathMatch;
          
          // First collect all file paths
          while ((filePathMatch = filePathPattern.exec(generatedCode)) !== null) {
            filePaths.push(filePathMatch[1].trim());
          }
          
          // Then collect all code blocks
          let codeBlocks = [];
          let codeBlockMatch;
          while ((codeBlockMatch = codeBlockPattern.exec(generatedCode)) !== null) {
            codeBlocks.push(codeBlockMatch[1].trim());
          }
          
          // Match file paths with code blocks
          if (filePaths.length === codeBlocks.length) {
            for (let i = 0; i < filePaths.length; i++) {
              files[filePaths[i]] = codeBlocks[i];
              fileCount++;
              console.log(`Parsed file ${fileCount}: ${filePaths[i]}`);
            }
          }
        }

        // Validate the generated files
        if (Object.keys(files).length === 0) {
          console.error("No files were parsed from the API response");
          console.error("Raw response:", generatedCode);
          throw new Error("No files were generated by the API");
        }

        console.log(`Successfully parsed ${Object.keys(files).length} files`);

        // Verify required files are present
        const requiredFiles = [
          'tsconfig.json',
          'tsconfig.app.json',
          'tsconfig.spec.json',
          'angular.json',
          'package.json',
          'src/main.ts',
          'src/index.html',
          'src/styles.css',
          'src/polyfills.ts',
          'src/environments/environment.ts',
          'src/environments/environment.prod.ts',
          'src/app/app.component.ts',
          'src/app/app.component.html',
          'src/app/app.component.css',
          'src/app/app.routes.ts',
          'src/app/app.config.ts'
        ];

        const missingFiles = requiredFiles.filter(file => !files[file]);
        if (missingFiles.length > 0) {
          console.error("Missing required files:", missingFiles);
          throw new Error(`Missing required files: ${missingFiles.join(', ')}`);
        }

        // Verify file contents
        for (const file of requiredFiles) {
          const content = files[file];
          if (!content || content.trim().length === 0) {
            console.error(`File ${file} is empty`);
            throw new Error(`File ${file} is empty`);
          }
          console.log(`Verified file content for: ${file}`);
        }

        // Create all required directories before returning files
        const directories = new Set();
        Object.keys(files).forEach(filepath => {
          const dir = path.dirname(filepath);
          directories.add(dir);
        });

        return files;
      } catch (error) {
        lastError = error;
        console.error(`API call failed (${retries} retries left):`, error);
        retries--;
        if (retries > 0) {
          const delay = (3 - retries) * 2000;
          console.log(`Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error("Failed to generate Angular code after multiple retries");
  } catch (error) {
    console.error("Angular code generation failed:", error);
    throw error;
  }
}

async function createAngularProject(workDir, angularFiles) {
  try {
    console.log(`Creating Angular project in ${workDir}`);
    
    // Create enhanced directory structure
    const directories = [
      'src',
      'src/app',
      'src/app/components',
      'src/app/components/shared',
      'src/app/components/features',
      'src/app/services',
      'src/app/models',
      'src/app/guards',
      'src/app/interfaces',
      'src/app/utils',
      'src/app/constants',
      'src/assets',
      'src/environments',
      'src/styles'
    ];

    // Create all directories first with proper error handling
    for (const dir of directories) {
      const dirPath = path.join(workDir, dir);
      try {
        await fs.ensureDir(dirPath);
        console.log(`Created directory: ${dir}`);
      } catch (dirError) {
        console.error(`Failed to create directory ${dir}:`, dirError);
        throw new Error(`Failed to create directory ${dir}: ${dirError.message}`);
      }
    }

    // Write files with proper error handling
    for (const [filepath, content] of Object.entries(angularFiles)) {
      try {
        const fullPath = path.join(workDir, filepath);
        const dirPath = path.dirname(fullPath);
        
        // Ensure the directory exists
        await fs.ensureDir(dirPath);
        
        // Write the file
        await fs.writeFile(fullPath, content);
        console.log(`Created file: ${filepath}`);
      } catch (fileError) {
        console.error(`Failed to write file ${filepath}:`, fileError);
        throw new Error(`Failed to write file ${filepath}: ${fileError.message}`);
      }
    }

    // Validate project structure
    await validateProjectStructure(workDir);
    console.log('Angular project created successfully');

    return true;
  } catch (error) {
    console.error("Failed to create Angular project:", error);
    throw error;
  }
}

async function validateProjectStructure(workDir) {
  console.log('Validating project structure...');
  
  const requiredFiles = [
    'src/main.ts',
    'src/index.html',
    'src/styles.css',
    'src/app/app.component.ts',
    'src/app/app.component.html',
    'src/app/app.component.css',
    'src/app/app.routes.ts',
    'tsconfig.json',
    'angular.json',
    'package.json'
  ];

  // First verify all required files exist
  for (const file of requiredFiles) {
    const filePath = path.join(workDir, file);
    try {
      const exists = await fs.pathExists(filePath);
      if (!exists) {
        console.error(`Missing required file: ${file}`);
        throw new Error(`Missing required file: ${file}`);
      }
      console.log(`Verified file exists: ${file}`);
    } catch (error) {
      console.error(`Error checking file ${file}:`, error);
      throw error;
    }
  }

  // Validate component structure
  const componentsDir = path.join(workDir, 'src/app/components');
  try {
    if (await fs.pathExists(componentsDir)) {
      const items = await fs.readdir(componentsDir);
      for (const item of items) {
        const itemPath = path.join(componentsDir, item);
        const stats = await fs.stat(itemPath);
        
        // Skip directories that are meant for organization (shared, features)
        if (stats.isDirectory() && (item === 'shared' || item === 'features')) {
          console.log(`Skipping organization directory: ${item}`);
          continue;
        }
        
        // For actual component directories, validate their files
        if (stats.isDirectory()) {
          const requiredComponentFiles = [
            `${item}.component.ts`,
            `${item}.component.html`,
            `${item}.component.css`
          ];

          for (const file of requiredComponentFiles) {
            const filePath = path.join(itemPath, file);
            const exists = await fs.pathExists(filePath);
            if (!exists) {
              console.error(`Missing component file: ${file} in ${item}`);
              throw new Error(`Missing component file: ${file} in ${item}`);
            }
            console.log(`Verified component file exists: ${file} in ${item}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error validating component structure:', error);
    throw error;
  }

  console.log('Project structure validation completed successfully');
}

async function buildAndServeAngular(jobId, workDir) {
  try {
    console.log(`Workspace directory structure for job ${jobId}:`);
    await logDirectoryStructure(workDir);

    // Step 1: Install dependencies with detailed logging
    console.log(`Installing dependencies for job ${jobId}...`);
    try {
      const installResult = await runCommand("npm", ["install"], { 
        cwd: workDir,
        env: { ...process.env, FORCE_COLOR: true }
      });
      console.log("Dependencies installed successfully");
    } catch (installError) {
      console.error("Failed to install dependencies:", installError);
      console.error("Installation error details:", {
        stdout: installError.stdout,
        stderr: installError.stderr,
        code: installError.code
      });
      throw new Error(`Failed to install dependencies: ${installError.message}`);
    }

    // Step 2: Build the Angular project with detailed logging
    console.log(`Building Angular app for job ${jobId}...`);
    try {
      // First, verify Angular CLI is installed
      await runCommand("npx", ["ng", "version"], { cwd: workDir });
      
      // Then run the build
      const buildResult = await runCommand("npx", ["ng", "build", "--configuration=development"], {
        cwd: workDir,
        env: { ...process.env, FORCE_COLOR: true }
      });

      console.log("Build completed successfully");
      console.log("Build output:", buildResult.stdout);

      // Check for warnings
      if (buildResult.stderr && buildResult.stderr.includes("Warning:")) {
        console.warn("Build completed with warnings:", buildResult.stderr);
      }
    } catch (buildError) {
      console.error("Build failed with error:", buildError);
      console.error("Build error details:", {
        stdout: buildError.stdout,
        stderr: buildError.stderr,
        code: buildError.code
      });

      // Check for common build errors
      if (buildError.stderr) {
        if (buildError.stderr.includes("Module not found")) {
          throw new Error("Build failed: Missing module dependencies. Please check package.json and node_modules.");
        } else if (buildError.stderr.includes("Cannot find module")) {
          throw new Error("Build failed: Missing Angular module. Please check imports and dependencies.");
        } else if (buildError.stderr.includes("compilation error")) {
          throw new Error("Build failed: TypeScript compilation error. Please check component files.");
        }
      }

      throw new Error(`Build failed: ${buildError.message}`);
    }

    // Step 3: Process the built files
    const distDir = path.join(workDir, "dist/angular-app");
    const previewDir = path.join(__dirname, "previews", jobId);
    
    try {
      // Ensure preview directory exists
      await fs.ensureDir(previewDir);

      // Copy built files to preview directory
      await fs.copy(distDir, previewDir);
      console.log("Built files copied to preview directory");

      // Update index.html for preview
      const indexPath = path.join(previewDir, "index.html");
      if (await fs.pathExists(indexPath)) {
        let indexContent = await fs.readFile(indexPath, "utf8");
        
        // Update base href and asset paths
        indexContent = indexContent.replace(/<base href="[^"]*">/g, '<base href="./">');
        indexContent = indexContent.replace(/src="\//g, 'src="');
        indexContent = indexContent.replace(/href="\//g, 'href="');
        
        await fs.writeFile(indexPath, indexContent);
        console.log("Updated index.html for preview");
      }

      return `/previews/${jobId}/index.html`;
    } catch (fileError) {
      console.error("Failed to process built files:", fileError);
      throw new Error(`Failed to process built files: ${fileError.message}`);
    }
  } catch (error) {
    console.error("Failed to build Angular project:", error);
    throw error;
  }
}

// Helper function to recursively log directory structure
async function logDirectoryStructure(dir, depth = 0) {
  const indent = "  ".repeat(depth);
  console.log(`${indent}${path.basename(dir)}/`);
  const items = await fs.readdir(dir);
  for (const item of items) {
    const itemPath = path.join(dir, item);
    const stats = await fs.stat(itemPath);
    if (stats.isDirectory()) {
      await logDirectoryStructure(itemPath, depth + 1);
    } else {
      console.log(`${indent}  ${item}`);
    }
  }
}

// Add this before the buildAndServeAngular function
async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running command: ${command} ${args.join(' ')}`);
    
    const process = spawn(command, args, {
      ...options,
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log(output);
    });

    process.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.error(output);
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Command failed with exit code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });

    process.on('error', (error) => {
      console.error(`Failed to start command: ${error.message}`);
      reject(error);
    });
  });
}

// Start the server with proper error handling
const server = app.listen(PORT, () => {
  console.log(`Figma to Angular server running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please try a different port.`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
  }
});

// Handle process termination
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received. Closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Create necessary directories on startup
(async () => {
  try {
    await fs.ensureDir(path.join(__dirname, "workspaces"));
    await fs.ensureDir(path.join(__dirname, "previews"));
    await fs.ensureDir(path.join(__dirname, "downloads"));
    await fs.ensureDir(path.join(__dirname, "assets"));
    await fs.ensureDir(path.join(__dirname, "uploads"));
    
    const faviconPath = path.join(__dirname, "assets", "favicon.ico");
    if (!(await fs.pathExists(faviconPath))) {
      await fs.writeFile(faviconPath, "");
    }
    
    console.log("Server initialized successfully");
    console.log("Required directories created:");
    console.log("- workspaces/");
    console.log("- previews/");
    console.log("- downloads/");
    console.log("- assets/");
    console.log("- uploads/");
  } catch (error) {
    console.error("Error initializing server:", error);
    process.exit(1);
  }
})();

async function createProjectZip(workDir, jobId) {
  try {
    console.log(`Creating ZIP file for job ${jobId}...`);
    const zip = new JSZip();
    const downloadsDir = path.join(__dirname, "downloads");

    // Ensure downloads directory exists
    await fs.ensureDir(downloadsDir);

    // Add all files to the ZIP
    const addFilesToZip = async (dir, zipFolder) => {
      const files = await fs.readdir(dir);
      
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isDirectory()) {
          // Skip node_modules directory
          if (file === 'node_modules') continue;
          
          const newFolder = zipFolder.folder(file);
          await addFilesToZip(filePath, newFolder);
        } else {
          const content = await fs.readFile(filePath);
          zipFolder.file(file, content);
        }
      }
    };

    // Start adding files from the workspace directory
    await addFilesToZip(workDir, zip);

    // Generate the ZIP file
    const zipPath = path.join(downloadsDir, `${jobId}.zip`);
    const content = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(zipPath, content);

    console.log(`ZIP file created successfully: ${zipPath}`);
    return zipPath;
  } catch (error) {
    console.error("Failed to create project ZIP:", error);
    throw new Error(`Failed to create project ZIP: ${error.message}`);
  }
}