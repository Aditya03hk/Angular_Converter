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
const { WorkSpaces } = require("aws-sdk");


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
const GEMINI_API_KEY = "AIzaSyByaRJkoVkLv6YxkohXUx39_JwjzFIvC-E"
const FIGMA_TOKEN = "figd_gJodVHdqIyuyNRFcKTJ-48xWDjRdFKln4VC3qOCm"
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
  const prompt = `Based on the following description, generate a detailed design structure that can be converted to Angular components. The structure should be in the same format as Figma JSON but simplified and focused on the essential UI elements.

User Description: "${description}"

Generate a JSON structure that includes:
1. The component hierarchy
2. Layout structure (containers, grids, sections)
3. Individual UI elements (buttons, text, images, forms, etc.)
4. Styling information (colors, fonts, sizes)
5. Positioning and layout properties

The structure should be detailed enough to create a complete Angular application.

Return only the JSON, no explanations. The JSON should include:
- document: { name, children: [] } for the overall structure
- Each element should have: name, type, absoluteBoundingBox, style properties, and children if applicable
- Interactive elements should include appropriate properties for events
- Text elements should include the text content and styling information
- Layout containers should specify flex/grid properties where needed

Remember to make the design responsive and follow modern web design patterns.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 4000 },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to generate design from text: ${response.statusText}`
      );
    }
    const result = await response.json();
    const designText = result.candidates[0].content.parts[0].text;
    // Parse the JSON from the response
    const cleanedJson = designText.replace(/```json\n?|\n?```/g, "").trim();
    const designStructure = JSON.parse(cleanedJson);
    return designStructure;
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
    for (const [filename, content] of Object.entries(angularFiles)) {
      await fs.writeFile(path.join(workDir, filename), content);
    }
    updateJobStatus(jobId, "processing", 50, "Creating Angular project");
    // Agent 4: Create Angular project and add generated components
    await createAngularProject(workDir, angularFiles);

    updateJobStatus(jobId, "processing", 70, "Building Angular project");
    // Agent 5: Build and serve Angular project
    const previewUrl = await buildAndServeAngular(jobId, workDir);

    // Create downloadable ZIP of the project
    const zipPath = await createProjectZip(workDir, jobId);
    // Update job as completed
    updateJobStatus(
      jobId,
      "completed",
      100,
      "Conversion completed successfully",
      {
        previewUrl,
        downloadUrl: `/api/download/${jobId}`,
      }
    );
    setTimeout(() => {
      cleanupJob(jobId);
    }, 2 * 60 * 60 * 1000);
  } catch (error) {
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
    await fs.ensureDir(workDir);
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
    for (const [filename, content] of Object.entries(angularFiles)) {
      await fs.writeFile(path.join(workDir, filename), content);
    }

    updateJobStatus(jobId, "processing", 50, "Creating Angular project");
    // Agent 4: Create Angular project and add generated components
    await createAngularProject(workDir, angularFiles);
    updateJobStatus(jobId, "processing", 70, "Building Angular project");
    // Agent 5: Build and serve Angular project
    const previewUrl = await buildAndServeAngular(jobId, workDir);
    // Create downloadable ZIP of the project
    const zipPath = await createProjectZip(workDir, jobId);
    // Update job as completed
    updateJobStatus(
      jobId,
      "completed",
      100,
      "Conversion completed successfully",
      {
        previewUrl,
        downloadUrl: `/api/download/${jobId}`,
      }
    );
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
async function generateAngularCode(figmaData) {
  try {
    // Get the memory content to include in the prompt
    const memoryGuidelines = await llmMemory.getFormattedMemory();
    // Create an enhanced prompt that includes memory
    const prompt = `Convert this Figma JSON to Angular code following these exact specifications:

${memoryGuidelines}

1. COMPONENT STRUCTURE:
  - Create standalone components (no NgModules)
  - AppComponent must have standalone: true with all required imports
  - Use separate file architecture: .ts, .html, and .css files (no inline templates/styles)
  - Include imports for CommonModule and any other necessary Angular modules  
  - Verify that the styles.css file is being created in the src directory during the Angular project generation process.
  - Ensure that the main.ts file is correctly bootstrapping the AppComponent

2. LAYOUT REQUIREMENTS: 
  - IMPORTANT: Preserve the original layout as closely as possible
  - When using flexbox/grid layouts, set specific width, height, and margin values
  - Ensure elements maintain the same relative position as in the Figma design
  - For containers, explicitly set width, max-width, and padding values
  - Use position: relative with appropriate top, left values when needed
  - Maintain the exact same spacing between elements as in the Figma design
  - Sort elements by absoluteBoundingBox.y for proper top-to-bottom order
  - Center elements that appear centered in the original design

3. COLOR CONVERSION:
  - CRITICAL: Convert Figma colors from 0-1 range to rgb/rgba format by MULTIPLYING r, g, b values by 255
  - Example: if Figma shows {r: 0.5, g: 0.7, b: 0.9, a: 1}, CSS should be rgba(127.5, 178.5, 229.5, 1)
  - For backgrounds, ensure the full element background is covered
  - Match text colors exactly as shown in the Figma design

4. INTERACTIVE ELEMENTS:
  - Convert rectangles with text children to buttons
  - Generate appropriate onClick methods in the component class, named semantically based on the text content (e.g., "Signup" becomes onSignup())
  - Use proper Angular event binding syntax: (click)="methodName()"
  - Structure buttons as: <button (click)="methodName()"><span class="button-text">Text</span></button>
  - Each button's onClick method should trigger a simple alert with a message like "ButtonName button clicked!"

5. STYLING AND ASSETS:
  - Translate all Figma text styles to appropriate CSS properties (font-family, font-size, font-weight, color)
  - Create concise CSS by combining similar styles into shared classes
  - ENSURE that app.component.ts has a proper @Component decorator with styleUrls: ['./app.component.css']
  - Generate index.html with all required font imports from style.fontFamily
  - Generate styles.css for global styles and app.component.css for component-specific styles
  - Add a link to styles.css in the index.html head section
  - For images or placeholders, create a div with appropriate dimensions and background color
  - Use proper CSS selector specificity to ensure styles are applied correctly

6. COMPONENT HIERARCHY:
  - Parse document.children for pages and frames
  - Sort elements by absoluteBoundingBox.y for proper visual order
  - Maintain parent-child relationships where appropriate
  - Avoid generating duplicate elements (e.g., if "Vector" appears multiple times, ensure it's not a duplication error)
  - Group related elements into semantic HTML tags (e.g., <nav> for navigation, <header> for hero sections, <main> for main content)

7. CODE COMPLETENESS:
  - Ensure all elements from the Figma JSON are included in the generated code
  - Generate the complete code for all files required for a functional Angular application
  - CRITICAL: Ensure each CSS class referenced in HTML exists in either app.component.css or styles.css

8. CODE ORGANIZATION:
  - Minimize the number of lines by combining similar styles into shared CSS classes
  - Avoid unnecessary wrapper divs unless required for layout
  - Generate only the necessary code without redundant logic or comments

9. ERROR HANDLING:
  - For any values that cannot be determined from the JSON, use sensible defaults
  - Ensure all elements have dimensions (width/height) specified
  - If a color value seems incorrect or missing, default to #333333 for text and #ffffff for backgrounds

10. STANDALONE CONFIGURATION:
    - CRITICAL: Do NOT import 'standalone' from '@angular/core' - it doesn't exist
    - Instead, use standalone: true in the @Component decorator
    - Example:   
      @Component({
        selector: 'app-root',
        templateUrl: './app.component.html',
        styleUrls: ['./app.component.css'],
        standalone: true,
        imports: [CommonModule]
      })
    - Remember to import CommonModule from '@angular/common' when using standalone components 
    - Ensure that the app.component.html file uses the [(ngModel)] directive correctly
    - Since the application uses standalone components, you need to make sure to explicitly import FormsModule in app.component.ts file
    
11. EMAIL HANDLING:
- CRITICAL: All email addresses in the HTML must use &#64; instead of @ symbol
- Example: "example@email.com" should be "example&#64;email.com"
- This prevents Angular from interpreting the @ symbol as part of its template syntax

12. STYLES PROCESSING:
- Ensure all CSS files are properly included and referenced in the final build
- Any global styles should be placed in styles.css 
- Component-specific styles must be placed in app.component.css
- For Angular builds, ensure styles use correct relative paths
- Check that @import statements for fonts are properly formatted

OUTPUT FORMAT:
Return complete, functional code without explanations or markdown, structured as:

- app.component.ts (with proper @Component decorator including styleUrls)
- app.component.html (with class names that match those defined in CSS)
- app.component.css (with all component-specific styles)
- main.ts (with proper bootstrapping)
- styles.css (with global styles)
- index.html (with proper style link)
- angular.json (minimal configuration with styles array)

For each file, start with the filename on its own line, followed by the file content.

Figma JSON:
${JSON.stringify(figmaData, null, 2)}`;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8000,
          },
        }),
      }
    );
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `Gemini API error: ${errorData.error?.message || response.statusText}`
      );
    }
    const result = await response.json();
    if (!result.candidates || result.candidates.length === 0) {
      throw new Error("No response generated from Gemini API");
    }
    const angularCodeText = result.candidates[0].content.parts[0].text;
    const parsedFiles = parseAngularCode(angularCodeText);
    // Analyze the code and update memory
    await codeAnalyzer.analyzeGeneratedCode(parsedFiles);
    return parsedFiles;
  } catch (error) {
    console.error("Failed to generate Angular code:", error);
    throw new Error(`Failed to generate Angular code: ${error.message}`);
  }
}
// Parse Angular code from Gemini response
function parseAngularCode(rawCode) {
  const files = {
    "app.component.ts": "",
    "app.component.html": "",
    "app.component.css": "",
    "main.ts": "",
    "styles.css": "",
    "index.html": "",
    "angular.json": "",
  };
  let currentFile = null;
  const lines = rawCode.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^(```typescript\s*)?app\.component\.ts/i)) {
      currentFile = "app.component.ts";
      continue;
    } else if (line.match(/^(```html\s*)?app\.component\.html/i)) {
      currentFile = "app.component.html";
      continue;
    } else if (line.match(/^(```css\s*)?app\.component\.css/i)) {
      currentFile = "app.component.css";
      continue;
    } else if (line.match(/^(```typescript\s*)?main\.ts/i)) {
      currentFile = "main.ts";
      continue;
    } else if (line.match(/^(```css\s*)?styles\.css/i)) {
      currentFile = "styles.css";
      continue;
    } else if (line.match(/^(```html\s*)?index\.html/i)) {
      currentFile = "index.html";
      continue;
    } else if (line.match(/^(```json\s*)?angular\.json/i)) {
      currentFile = "angular.json";
      continue;
    }
    if (
      line.trim() === "```" ||
      line.trim() === "```typescript" ||
      line.trim() === "```html" ||
      line.trim() === "```css" ||
      line.trim() === "```json"
    ) {
      continue;
    }
    if (currentFile && files.hasOwnProperty(currentFile)) {
      files[currentFile] += line + "\n";
    }
  }
  // Trim whitespace and remove empty files
  Object.keys(files).forEach((key) => {
    files[key] = files[key].trim();
    if (!files[key]) {
      delete files[key];
    }
  });
  // Verify and fix the Angular code
  return verifyAndFixCode(files);
}
// Verify and fix Angular code
function verifyAndFixCode(files) {
  const verifiedFiles = { ...files };
  // Ensure app.component.ts has styleUrls
  if (verifiedFiles["app.component.ts"] && verifiedFiles["app.component.css"]) {
    if (!verifiedFiles["app.component.ts"].includes("styleUrls")) {
      const componentRegex = /@Component\(\{[\s\S]*?\}\)/;
      const match = verifiedFiles["app.component.ts"].match(componentRegex);
      if (match) {
        const updatedDecorator = match[0].replace(
          /}\)$/,
          ",\n  styleUrls: ['./app.component.css']\n})"
        );
        verifiedFiles["app.component.ts"] = verifiedFiles[
          "app.component.ts"
        ].replace(match[0], updatedDecorator);
      }
    }
  }
  // Ensure index.html links to styles.css
  if (verifiedFiles["index.html"] && verifiedFiles["styles.css"]) {
    if (
      !verifiedFiles["index.html"].includes(
        '<link rel="stylesheet" href="styles.css">'
      )
    ) {
      verifiedFiles["index.html"] = verifiedFiles["index.html"].replace(
        "</head>",
        '  <link rel="stylesheet" href="styles.css">\n</head>'
      );
    }
    // New addition
    if (verifiedFiles["index.html"]) {
      verifiedFiles["index.html"] = verifiedFiles["index.html"]
        .replace(/<style>@import[^<]*<\/style>/g, "")
        .replace(/<noscript>[^<]*<\/noscript>/g, "");
    }
  }
  // Ensure main.ts bootstraps the app properly
  if (
    verifiedFiles["main.ts"] &&
    !verifiedFiles["main.ts"].includes("bootstrapApplication")
  ) {
    verifiedFiles[
      "main.ts"
    ] = `import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import { provideAnimations } from '@angular/platform-browser/animations';

bootstrapApplication(AppComponent, {
  providers: [
    provideAnimations()
  ]
}).catch(err => console.error(err));`;
  }

  // Verify CSS classes used in HTML exist in CSS files
  if (
    verifiedFiles["app.component.html"] &&
    verifiedFiles["app.component.css"]
  ) {
    const html = verifiedFiles["app.component.html"];
    const css = verifiedFiles["app.component.css"];

    const classRegex = /class="([^"]*)"/g;
    const htmlClasses = new Set();
    let match;

    while ((match = classRegex.exec(html)) !== null) {
      const classNames = match[1].split(/\s+/);
      classNames.forEach((className) => {
        if (className.trim()) htmlClasses.add(className.trim());
      });
    }
    const cssClassRegex = /\.([a-zA-Z0-9_-]+)(?:\s*\{|\s*,)/g;
    const cssClasses = new Set();
    while ((match = cssClassRegex.exec(css)) !== null) {
      cssClasses.add(match[1]);
    }
    let updatedCss = css;
    htmlClasses.forEach((className) => {
      if (!cssClasses.has(className)) {
        updatedCss += `\n\n/* Added default styling for missing class */\n.${className} {\n  display: block;\n  margin: 0.5rem;\n  padding: 0.5rem;\n  color: #333333;\n  background-color: #ffffff;\n}\n`;
      }
    });
    verifiedFiles["app.component.css"] = updatedCss;
  }
  return verifiedFiles;
}
// Agent 4: Create Angular project with the generated code
async function createAngularProject(workDir, angularFiles) {
  const srcDir = path.join(workDir, "src");
  const appDir = path.join(srcDir, "app");
  try {
    // Create directory structure
    await fs.ensureDir(appDir);
    await fs.ensureDir(path.join(srcDir, "assets"));
    await fs.ensureDir(path.join(srcDir, "environments"));
    // Enhanced angular.json
    const angularJson = {
      $schema: "./node_modules/@angular/cli/lib/config/schema.json",
      version: 1,
      newProjectRoot: "projects",
      projects: {
        "figma-angular": {
          projectType: "application",
          schematics: {},
          root: "",
          sourceRoot: "src",
          prefix: "app",
          architect: {
            build: {
              builder: "@angular-devkit/build-angular:browser",
              options: {
                outputPath: "dist/figma-angular",
                index: "src/index.html",
                main: "src/main.ts",
                polyfills: ["zone.js"],
                tsConfig: "tsconfig.app.json",
                assets: ["src/favicon.ico", "src/assets"],
                styles: ["src/styles.css"],
                scripts: [],
              },
              configurations: {
                production: {
                  budgets: [
                    {
                      type: "initial",
                      maximumWarning: "500kb",
                      maximumError: "1mb",
                    },
                    {
                      type: "anyComponentStyle",
                      maximumWarning: "5kb",
                      maximumError: "10kb",
                    },
                  ],
                  outputHashing: "all",
                },
                development: {
                  buildOptimizer: false,
                  optimization: false,
                  vendorChunk: true,
                  extractLicenses: false,
                  sourceMap: true,
                  namedChunks: true,
                },
              },
              defaultConfiguration: "production",
            },
            serve: {
              builder: "@angular-devkit/build-angular:dev-server",
              configurations: {
                production: {
                  buildTarget: "figma-angular:build:production",
                },
                development: {
                  buildTarget: "figma-angular:build:development",
                },
              },
              defaultConfiguration: "development",
            },
          },
        },
      },
    };
    await fs.writeJson(path.join(workDir, "angular.json"), angularJson, {
      spaces: 2,
    });
    // Enhanced package.json
    await fs.writeJson(
      path.join(workDir, "package.json"),
      {
        name: "figma-angular-project",
        version: "0.0.0",
        scripts: {
          ng: "ng",
          start: "ng serve",
          build: "ng build",
          watch: "ng build --watch --configuration development",
          test: "ng test",
        },
        private: true,
        dependencies: {
          "@angular/animations": "^17.0.0",
          "@angular/common": "^17.0.0",
          "@angular/compiler": "^17.0.0",
          "@angular/core": "^17.0.0",
          "@angular/forms": "^17.0.0",
          "@angular/platform-browser": "^17.0.0",
          "@angular/platform-browser-dynamic": "^17.0.0",
          "@angular/router": "^17.0.0",
          rxjs: "~7.8.0",
          tslib: "^2.3.0",
          "zone.js": "~0.14.2",
        },
        devDependencies: {
          "@angular-devkit/build-angular": "^17.0.0",
          "@angular/cli": "^17.0.0",
          "@angular/compiler-cli": "^17.0.0",
          "@types/jasmine": "~4.3.0",
          "jasmine-core": "~4.6.0",
          karma: "~6.4.0",
          "karma-chrome-launcher": "~3.2.0",
          "karma-coverage": "~2.2.0",
          "karma-jasmine": "~5.1.0",
          "karma-jasmine-html-reporter": "~2.1.0",
          typescript: "~5.2.2",
        },
      },
      { spaces: 2 }
    );
    // Improved tsconfig.json
    await fs.writeJson(
      path.join(workDir, "tsconfig.json"),
      {
        compileOnSave: false,
        compilerOptions: {
          baseUrl: "./",
          outDir: "./dist/out-tsc",
          forceConsistentCasingInFileNames: true,
          strict: true,
          noImplicitOverride: true,
          noPropertyAccessFromIndexSignature: true,
          noImplicitReturns: true,
          noFallthroughCasesInSwitch: true,
          sourceMap: true,
          declaration: false,
          downlevelIteration: true,
          experimentalDecorators: true,
          moduleResolution: "node",
          importHelpers: true,
          target: "ES2022",
          module: "ES2022",
          useDefineForClassFields: false,
          lib: ["ES2022", "dom"],
        },
        angularCompilerOptions: {
          enableI18nLegacyMessageIdFormat: false,
          strictInjectionParameters: true,
          strictInputAccessModifiers: true,
          strictTemplates: true,
        },
      },
      { spaces: 2 }
    );
    // Improved tsconfig.app.json
    await fs.writeJson(
      path.join(workDir, "tsconfig.app.json"),
      {
        extends: "./tsconfig.json",
        compilerOptions: {
          outDir: "./out-tsc/app",
          types: [],
        },
        files: ["src/main.ts"],
        include: ["src/**/*.d.ts"],
      },
      { spaces: 2 }
    );
    // Write environment files
    await fs.outputFile(
      path.join(srcDir, "environments", "environment.ts"),
      `export const environment = { production: false };`
    );
    await fs.outputFile(
      path.join(srcDir, "environments", "environment.prod.ts"),
      `export const environment = { production: true };`
    );
    // Create index.html if not provided
    if (!angularFiles["index.html"]) {
      const title = jobData.description || "Generated Angular Project";
      angularFiles["index.html"] = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>  
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <app-root></app-root>
</body>
</html>`;
    }
    // Create default styles.css if not provided
    if (!angularFiles["styles.css"]) {
      angularFiles[
        "styles.css"
      ] = `/* You can add global styles to this file, and also import other style files */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: Arial, sans-serif;
}`;
    }
    // Ensure main.ts is properly formatted
    if (
      !angularFiles["main.ts"] ||
      !angularFiles["main.ts"].includes("bootstrapApplication")
    ) {
      angularFiles[
        "main.ts"
      ] = `import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideAnimations } from '@angular/platform-browser/animations';   

bootstrapApplication(AppComponent, {
  providers: [
    provideAnimations()
  ]
}).catch(err => console.error(err));`;
    } else {
      // Fix the import path in any existing main.ts
      angularFiles["main.ts"] = angularFiles["main.ts"].replace(
        "import { AppComponent } from './app.component';",
        "import { AppComponent } from './app/app.component';"
      );
    }
    // Write component and support files
    for (const [filename, content] of Object.entries(angularFiles)) {
      if (filename.includes(".component")) {
        // Component files go in the app directory
        const filePath = path.join(appDir, filename);
        await fs.outputFile(filePath, content);
      } else {
        // Other files go in the src directory
        const filePath = path.join(srcDir, filename);
        await fs.outputFile(filePath, content);
      }
    }
    // Create favicon if not exists
    try {
      await fs.copy(
        path.join(__dirname, "assets", "favicon.ico"),
        path.join(srcDir, "favicon.ico")
      );
    } catch (error) {
      console.log("Using default favicon");
      // Create a simple empty favicon
      await fs.writeFile(path.join(srcDir, "favicon.ico"), "");
    }
    return true;
  } catch (error) {
    console.error("Failed to create Angular project:", error);
    throw new Error(`Failed to create Angular project: ${error.message}`);
  }
}
async function buildAndServeAngular(jobId, workDir) {
  try {
    console.log(`Workspace directory structure for job ${jobId}:`);
    await logDirectoryStructure(workDir);
    console.log(`Installing dependencies for job ${jobId}...`);
    await runCommand("npm", ["install"], { cwd: workDir });
    console.log(`Building Angular app for job ${jobId}...`);
    try {
      const buildResult = await runCommand("npx", ["ng", "build"], {
        cwd: workDir,
      });
      // If build succeeds, add a success pattern to memory
      await llmMemory.addSuccess(
        "build-success",
        "Angular project built successfully without errors",
        "Build completed with proper component structure and dependencies"
      );
      // Check if there were any warnings to learn from
      if (buildResult.stderr && buildResult.stderr.includes("Warning:")) {
        console.warn("Build completed with warnings:", buildResult.stderr);
        const warningLines = buildResult.stderr
          .split("\n")
          .filter((line) => line.includes("Warning:"));
        for (const warning of warningLines) {
          await llmMemory.addError(
            "build-warning",
            `Angular build warning: ${warning.trim()}`,
            "Ensure code follows Angular best practices to avoid build warnings"
          );
        }
      }
    } catch (buildError) {
      // If build fails, add an error pattern to memory
      console.error("Build failed:", buildError);
      let errorMessage = buildError.message || "";
      let correction = "";
      // Extract useful information from the error message
      if (errorMessage.includes("Cannot find module")) {
        const moduleMatch = errorMessage.match(/Cannot find module '([^']+)'/);
        if (moduleMatch) {
          const missingModule = moduleMatch[1];
          correction = `Make sure to import ${missingModule} correctly and check that the module name is typed correctly`;
          await llmMemory.addRule(
            `Check import statements for accuracy, especially for module '${missingModule}'`,
            "high"
          );
        }
      } else if (
        errorMessage.includes("Property") &&
        errorMessage.includes("does not exist")
      ) {
        const propertyMatch = errorMessage.match(
          /Property '([^']+)' does not exist/
        );
        if (propertyMatch) {
          correction = `Define properties before using them or check property names for typos`;
        }
      }
      await llmMemory.addError(
        "build-failure",
        `Angular build error: ${errorMessage.substring(0, 200)}`,
        correction
      );
      throw buildError;
    }

    // Step 3: Process the built files to fix stylesheet references
    const distDir = path.join(workDir, "dist/figma-angular");
    const distIndexPath = path.join(distDir, "index.html");
    if (await fs.pathExists(distIndexPath)) {
      // Find the hashed stylesheet file
      const files = await fs.readdir(distDir);
      const styleFile = files.find(
        (file) => file.startsWith("styles.") && file.endsWith(".css")
      );
      if (styleFile) {
        console.log(`Found stylesheet: ${styleFile}`);
        // Update the index.html to use the correct hashed filename
        let indexContent = await fs.readFile(distIndexPath, "utf8");
        indexContent = indexContent.replace(/<base href="\/">/g, "");
        indexContent = indexContent.replace(
          /<link rel="stylesheet" href="styles\.css">/g,
          ""
        );
        // If there's no stylesheet link, add one
        if (!indexContent.includes('<link rel="stylesheet"')) {
          indexContent = indexContent.replace(
            "</head>",
            `  <link rel="stylesheet" href="${styleFile}">\n</head>`
          );
        }
        await fs.writeFile(indexPath, indexContent);
      } else {
        console.warn(`No CSS file found in ${distDir}`);
      }
    }
    // Step 4: Copy the built files to the previews directory
    const previewDir = path.join(__dirname, "previews", jobId);
    await fs.ensureDir(previewDir);
    await fs.copy(path.join(workDir, "dist/figma-angular"), previewDir);

    // Update the index.html in preview directory to use relative paths
    const indexPath = path.join(previewDir, "index.html");
    if (await fs.pathExists(indexPath)) {
      let indexContent = await fs.readFile(distIndexPath, "utf8");
      // Remove base href
      indexContent = indexContent.replace(/<base href="[^"]*">/g, '');
      // Update asset paths to be relative
      indexContent = indexContent.replace(/src="\//g, 'src="');
      indexContent = indexContent.replace(/href="\//g, 'href="');
      await fs.writeFile(indexPath, indexContent);
    }

    return `/previews/${jobId}/index.html`;
  } catch (error) {
    console.error("Failed to build Angular project:", error);
    throw new Error(`Failed to build Angular project: ${error.message}`);
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
async function createProjectZip(workDir, jobId) {
  try {
    const zip = new JSZip();
    const addFilesToZip = async (dir, zipFolder = "") => {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
          if (file === "node_modules" || file === ".git" || file === "dist") {
            continue;
          }
          await addFilesToZip(filePath, path.join(zipFolder, file));
        } else {
          const fileData = await fs.readFile(filePath);
          zip.file(path.join(zipFolder, file), fileData);
        }
      }
    };
    await addFilesToZip(workDir);
    const zipContent = await zip.generateAsync({ type: "nodebuffer" });
    const zipPath = path.join(__dirname, "downloads", `${jobId}.zip`);
    await fs.ensureDir(path.join(__dirname, "downloads"));
    await fs.writeFile(zipPath, zipContent);
    return zipPath;
  } catch (error) {
    console.error("Failed to create project ZIP:", error);
    throw new Error(`Failed to create project ZIP: ${error.message}`);
  }
}
app.get("/api/download/:jobId", async (req, res) => {
  const { jobId } = req.params;
  if (!PROCESSING_QUEUE.has(jobId)) {
    return res.status(404).json({ error: "Job not found" });
  }
  const jobStatus = PROCESSING_QUEUE.get(jobId);
  if (jobStatus.status !== "completed") {
    return res.status(400).json({ error: "Job is not completed yet" });
  }
  const zipPath = path.join(__dirname, "downloads", `${jobId}.zip`);
  if (!(await fs.pathExists(zipPath))) {
    return res.status(404).json({ error: "Download file not found" });
  }
  res.download(zipPath, "figma-angular-project.zip");
});
function updateJobStatus(jobId, status, progress, message, extras = {}) {
  if (!PROCESSING_QUEUE.has(jobId)) return;
  const job = PROCESSING_QUEUE.get(jobId);
  PROCESSING_QUEUE.set(jobId, {
    ...job,
    status,
    progress,
    message,
    updated: new Date(),
    ...extras,
  });
  console.log(`[Job ${jobId}] ${status} (${progress}%): ${message}`);
}
async function cleanupJob(jobId) {
  try {
    const workDir = path.join(__dirname, "workspaces", jobId);
    if (await fs.pathExists(workDir)) {
      await fs.remove(workDir);
    }
    const previewDir = path.join(__dirname, "previews", jobId);
    if (await fs.pathExists(previewDir)) {
      await fs.remove(previewDir);
    }
    const zipPath = path.join(__dirname, "downloads", `${jobId}.zip`);
    if (await fs.pathExists(zipPath)) {
      await fs.remove(zipPath);
    }
    PROCESSING_QUEUE.delete(jobId);
    console.log(`[Job ${jobId}] Cleanup completed`);
  } catch (error) {
    console.error(`Failed to clean up job ${jobId}:`, error);
  }
}
function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running command: ${command} ${args.join(" ")}`);
    const child = spawn(command, args, { shell: true, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      console.log(`[stdout]: ${output}`);
    });
    child.stderr.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      console.error(`[stderr]: ${output}`);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(`Command failed with exit code ${code}\nstderr: ${stderr}`)
        );
      }
    });
  });
}
setInterval(() => {
  const now = new Date();

  for (const [jobId, job] of PROCESSING_QUEUE.entries()) {
    if (job.status === "completed" && now - job.updated > 2 * 60 * 60 * 1000) {
      cleanupJob(jobId);
    }
    if (job.status === "failed" && now - job.updated > 30 * 60 * 1000) {
      cleanupJob(jobId);
    }
  }
}, 15 * 60 * 1000); // Run every 15 minutes
app.listen(PORT, () => {
  console.log(`Figma to Angular server running on port ${PORT}`);
});
// Create necessary directories on startup
(async () => {
  try {
    await fs.ensureDir(path.join(__dirname, "workspaces"));
    await fs.ensureDir(path.join(__dirname, "previews"));
    await fs.ensureDir(path.join(__dirname, "downloads"));
    await fs.ensureDir(path.join(__dirname, "assets"));
    const faviconPath = path.join(__dirname, "assets", "favicon.ico");
    if (!(await fs.pathExists(faviconPath))) {
      await fs.writeFile(faviconPath, "");
    }
    console.log("Server initialized successfully");
  } catch (error) {
    console.error("Error initializing server:", error);
    process.exit(1);
  }
})();
