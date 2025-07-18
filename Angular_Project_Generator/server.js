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
const FigmaProcessor = require('./figma-processor');
const apiService = require('./api-service');
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

// Initialize Figma processor with the processing queue
const figmaProcessor = new FigmaProcessor(PROCESSING_QUEUE);

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

const inputHandler = require('./input-handler');

// Route to handle conversion requests
app.post("/api/convert", async (req, res) => {
  try {
    const { input } = req.body;

    if (!input) {
      return res.status(400).json({ error: "Input is required" });
    }

    // Process the input and determine its type
    const { jobId, jobData, inputType } = await inputHandler.processInput(input);

    // Add job to processing queue
    PROCESSING_QUEUE.set(jobId, jobData);

    // Return job ID immediately
    res.status(202).json({
      jobId,
      message: "Conversion process started",
      status: "queued",
      inputType
    });

    // Process based on input type
    if (inputType === 'figma') {
      figmaProcessor.processFigmaToAngular(jobId, input);
    } else if (inputType === 'text') {
      processTextToAngular(jobId, input);
    }
  } catch (error) {
    console.error("Conversion request error:", error);
    res.status(500).json({ error: error.message || "Failed to start conversion process" });
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
    let files = await generateAngularCode(designStructure);
    
    // Add FormsModule to app.config.ts
    if (files['src/app/app.config.ts']) {
      files['src/app/app.config.ts'] = `import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    provideAnimations(),
    importProvidersFrom(FormsModule)
  ]
};`;
    }

    // Update editable-form component to import FormsModule
    if (files['src/app/shared/editable-form/editable-form.component.ts']) {
      files['src/app/shared/editable-form/editable-form.component.ts'] = `import { Component, Input, Output, EventEmitter } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-editable-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: \`
    <form (ngSubmit)="onSubmit()">
      <div class="form-group">
        <input type="text" [(ngModel)]="data.name" name="name" placeholder="Name">
      </div>
      <div class="form-group">
        <input type="email" [(ngModel)]="data.email" name="email" placeholder="Email">
      </div>
      <div class="form-group">
        <input type="tel" [(ngModel)]="data.phone" name="phone" placeholder="Phone">
      </div>
      <button type="submit">Save</button>
    </form>
  \`,
  styles: [\`
    .form-group {
      margin-bottom: 1rem;
    }
    input {
      width: 100%;
      padding: 0.5rem;
      margin-bottom: 0.5rem;
    }
    button {
      padding: 0.5rem 1rem;
      background-color: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover {
      background-color: #0056b3;
    }
  \`]
})
export class EditableFormComponent {
  @Input() data: any = {};
  @Output() submit = new EventEmitter<any>();

  onSubmit() {
    this.submit.emit(this.data);
  }
}`;
    }

    // Create UserProfileComponent
    files['src/app/user-profile/user-profile.component.ts'] = `import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditableFormComponent } from '../components/shared/editable-form/editable-form.component';

@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [CommonModule, EditableFormComponent],
  template: \`
    <div class="profile-container">
      <h1>User Profile</h1>
      <app-editable-form
        [data]="userData"
        (submit)="onFormSubmit($event)">
      </app-editable-form>
    </div>
  \`,
  styles: [\`
    .profile-container {
      max-width: 600px;
      margin: 0 auto;
      padding: 2rem;
    }
    h1 {
      margin-bottom: 2rem;
      color: #333;
    }
  \`]
})
export class UserProfileComponent {
  userData = {
    name: '',
    email: '',
    phone: ''
  };

  onFormSubmit(data: any) {
    console.log('Form submitted:', data);
    // Handle form submission
  }
}`;

    // Update tsconfig.app.json to fix TypeScript warnings
    files['tsconfig.app.json'] = JSON.stringify({
      "extends": "./tsconfig.json",
      "compilerOptions": {
        "outDir": "./out-tsc/app",
        "types": [],
        "moduleResolution": "node",
        "target": "ES2022",
        "useDefineForClassFields": false
      },
      "files": [
        "src/main.ts",
        "src/polyfills.ts"
      ],
      "include": [
        "src/**/*.d.ts",
        "src/**/*.ts"
      ]
    }, null, 2);

    // Ensure environment files exist
    if (!files['src/environments/environment.ts']) {
      files['src/environments/environment.ts'] = `export const environment = {\n  production: false\n};\n`;
    }
    if (!files['src/environments/environment.prod.ts']) {
      files['src/environments/environment.prod.ts'] = `export const environment = {\n  production: true\n};\n`;
    }

    // Fix common Angular issues
    files = await fixAngularIssues(files);

    // Continue with the existing workflow
    await continueAngularConversion(jobId, workDir, files);
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
        text: `You are an expert Angular developer. Generate a complete Angular application based on this design description:

${description}

IMPORTANT: First, generate ONLY a design structure in JSON format that describes the components, services, and models needed for this application. The structure should include:

1. Components (with their hierarchy and relationships)
2. Services (with their responsibilities)
3. Models (with their properties and types)
4. Routes (with their paths and components)

The design structure should be in this format:
{
  "components": {
    "shared": {
      "header": {
        "description": "Main navigation header",
        "properties": ["title", "navItems"],
        "childComponents": []
      }
    },
    "features": {
      "homepage": {
        "description": "Main landing page",
        "properties": [],
        "childComponents": ["header"]
      }
    }
  },
  "services": {
    "data": {
      "description": "Handles data operations",
      "methods": ["getData", "saveData"]
    }
  },
  "models": {
    "user": {
      "properties": {
        "id": "string",
        "name": "string",
        "email": "string"
      }
    }
  },
  "routes": [
    {
      "path": "",
      "component": "HomepageComponent"
    }
  ]
}

IMPORTANT: Return ONLY the JSON structure, no additional code or explanations.`
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
    const generatedText = result.candidates[0].content.parts[0].text;
    
    // Clean the response text by removing markdown code block markers and any extra whitespace
    const cleanedText = generatedText
      .replace(/```json\n?|\n?```/g, '')  // Remove ```json and ``` markers
      .replace(/```typescript\n?|\n?```/g, '')  // Remove ```typescript and ``` markers
      .replace(/```javascript\n?|\n?```/g, '')  // Remove ```javascript and ``` markers
      .replace(/```\n?|\n?```/g, '')  // Remove any remaining ``` markers
      .trim();  // Remove extra whitespace

    // Log the cleaned text for debugging
    console.log("Cleaned response text:", cleanedText);

    try {
      const designStructure = JSON.parse(cleanedText);
      // Validate the structure
      if (!designStructure.components) {
        throw new Error("Invalid design structure: missing components");
      }
      return designStructure;
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError);
      console.error("Problematic JSON:", cleanedText);
      throw new Error(`Failed to parse design structure: ${parseError.message}`);
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

async function generateAngularCode(inputData) {
  try {
    const isFigmaData = inputData.document !== undefined;
    const designStructure = isFigmaData ? await processFigmaData(inputData) : inputData;

    // Generate component code with strict requirements
    const componentPrompt = {
      contents: [{
        parts: [{
          text: `Generate complete Angular 17+ components based on this ${isFigmaData ? 'Figma design' : 'design description'}:

${JSON.stringify(designStructure, null, 2)}

CRITICAL REQUIREMENTS:
1. For EACH component in the design, you MUST generate:
   - A TypeScript file (.component.ts)
   - An HTML template (.component.html)
   - A CSS file (.component.css)
   - All files must be in the same directory as the component

2. Each component MUST follow this exact structure:
   \`\`\`typescript
   // [component-name].component.ts
   import { Component } from '@angular/core';
   import { CommonModule } from '@angular/common';
   import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
   import { RouterModule } from '@angular/router';

   @Component({
     selector: 'app-[component-name]',
     templateUrl: './[component-name].component.html',
     styleUrls: ['./[component-name].component.css'],
     standalone: true,
     imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule]
   })
   export class [ComponentName]Component {
     // For components with forms:
     form: FormGroup;
     
     constructor(private fb: FormBuilder) {
       this.form = this.fb.group({
         // Form controls with validators
         email: ['', [Validators.required, Validators.email]],
         password: ['', [Validators.required, Validators.minLength(8)]],
         // Add other form controls as needed
       });
     }

     // Form validation methods
     get email() { return this.form.get('email'); }
     get password() { return this.form.get('password'); }

     onSubmit() {
       if (this.form.valid) {
         // Handle form submission
       }
     }
   }
   \`\`\`

   \`\`\`html
   <!-- [component-name].component.html -->
   <div class="[component-name]-container">
     <!-- For components with forms: -->
     <form [formGroup]="form" (ngSubmit)="onSubmit()" class="form">
       <div class="form-group">
         <label for="email">Email</label>
         <input 
           type="email" 
           id="email" 
           formControlName="email"
           [class.is-invalid]="email?.invalid && (email?.dirty || email?.touched)"
         >
         <div class="error-message" *ngIf="email?.invalid && (email?.dirty || email?.touched)">
           <span *ngIf="email?.errors?.['required']">Email is required</span>
           <span *ngIf="email?.errors?.['email']">Please enter a valid email</span>
         </div>
       </div>

       <div class="form-group">
         <label for="password">Password</label>
         <input 
           type="password" 
           id="password" 
           formControlName="password"
           [class.is-invalid]="password?.invalid && (password?.dirty || password?.touched)"
         >
         <div class="error-message" *ngIf="password?.invalid && (password?.dirty || password?.touched)">
           <span *ngIf="password?.errors?.['required']">Password is required</span>
           <span *ngIf="password?.errors?.['minlength']">Password must be at least 8 characters</span>
         </div>
       </div>

       <button type="submit" [disabled]="form.invalid">Submit</button>
     </form>
   </div>
   \`\`\`

   \`\`\`css
   /* [component-name].component.css */
     // Component logic here
   }
   \`\`\`

   \`\`\`html
   <!-- [component-name].component.html -->
   <div class="[component-name]-container">
     <!-- Component template here -->
   </div>
   \`\`\`

   \`\`\`css
   /* [component-name].component.css */
   .[component-name]-container {
     /* Component styles here */
   }
   \`\`\`

3. File Organization:
   - Each component must be in its own directory under src/app/components/
   - Use proper naming convention: [ComponentName]Component
   - All files must use the same base name
   - All paths must be relative to the component directory

4. Required Imports:
   - @angular/core
   - @angular/common
   - @angular/forms
   - @angular/router

5. Component Decorator:
   - Must include selector, templateUrl, styleUrls
   - Must be standalone: true
   - Must import required modules

6. Return Format:
   Return a JSON object with this structure:
   {
     "files": {
       "src/app/components/[component-name]/[component-name].component.ts": "content",
       "src/app/components/[component-name]/[component-name].component.html": "content",
       "src/app/components/[component-name]/[component-name].component.css": "content"
     }
   }

IMPORTANT: Generate ALL required files for EACH component in the design. Do not skip any files.`
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        topK: 40,
        topP: 0.8,
      }
    };

    // Generate initial code
    const generatedCode = await apiService.makeApiCall(componentPrompt);
    
    // Validate the generated code
    const validationPrompt = {
      contents: [{
        parts: [{
          text: `Verify and fix these Angular components, ensuring they are error-free and match the provided ${isFigmaData ? 'Figma design' : 'design description'}:

${JSON.stringify(generatedCode, null, 2)}

CRITICAL VALIDATION RULES:
1. Component Naming and Imports:
   - Component class names MUST be PascalCase with 'Component' suffix (e.g., LoginPageComponent)
   - Component file names MUST be kebab-case (e.g., login-page.component.ts)
   - Import paths MUST be relative to the component directory
   - Import statements MUST use correct PascalCase names
   - Example:
     \`\`\`typescript
     // Correct import
     import { LoginPageComponent } from './components/login-page/login-page.component';
     
     // Correct component class
     export class LoginPageComponent {
       // ...
     }
     \`\`\`

2. Route Configuration:
   - Routes MUST use correct PascalCase component names
   - Import paths MUST be relative to the routes file
   - Example:
     \`\`\`typescript
     import { Routes } from '@angular/router';
     import { LoginPageComponent } from './components/login-page/login-page.component';
     
     export const routes: Routes = [
       { path: 'login', component: LoginPageComponent }
     ];
     \`\`\`

3. Component Structure:
   - Each component MUST have:
     * TypeScript file (.component.ts)
     * HTML template (.component.html)
     * CSS file (.component.css)
   - All files MUST be in the same directory
   - Component MUST be standalone: true
   - Component MUST have proper imports

4. File Organization:
   - Components MUST be in src/app/components/[component-name]/
   - File names MUST match component names (kebab-case)
   - All paths MUST be relative to the component directory

5. Common Issues to Fix:
   - Incorrect component name casing (e.g., loginPageComponent → LoginPageComponent)
   - Incorrect import paths (e.g., wrong relative paths)
   - Missing or incorrect component references in routes
   - Missing required imports
   - Incorrect file naming

If any issues are found, fix them and return the complete, corrected components.

IMPORTANT: Return ONLY a valid JSON object with the component files, no additional text or explanations.`
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        topK: 40,
        topP: 0.8,
      }
    };

    // Get validated code
    const validatedCode = await apiService.makeApiCall(validationPrompt);

    // Add required Angular configuration files
    const configFiles = {
      'src/index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Angular App</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
</head>
<body>
  <app-root></app-root>
</body>
</html>`,
      'src/styles.css': `/* You can add global styles to this file, and also import other style files */
html, body { height: 100%; }
body { margin: 0; font-family: Roboto, "Helvetica Neue", sans-serif; }`,
      'src/main.ts': `import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig)
  .catch(err => console.error(err));`,
      'src/app/app.config.ts': `import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    provideAnimations(),
    importProvidersFrom(FormsModule, ReactiveFormsModule)
  ]
};`,
      'src/app/app.component.ts': `import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'angular-app';
}`,
      'src/app/app.component.html': `<main>
  <router-outlet></router-outlet>
</main>`,
      'src/app/app.component.css': `main {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}`,
      'src/app/app.routes.ts': `import { Routes } from '@angular/router';
${Object.keys(validatedCode.files)
  .filter(file => file.endsWith('.component.ts'))
  .map(file => {
    const componentName = file.split('/').pop().replace('.component.ts', '');
    return `import { ${componentName} } from './components/${componentName}/${componentName}.component';`;
  })
  .join('\n')}

export const routes: Routes = [
  ${Object.keys(validatedCode.files)
    .filter(file => file.endsWith('.component.ts'))
    .map(file => {
      const componentName = file.split('/').pop().replace('.component.ts', '');
      return `{ path: '${componentName.toLowerCase()}', component: ${componentName} }`;
    })
    .join(',\n  ')},
  { path: '**', redirectTo: '' }
];`,
      'angular.json': JSON.stringify({
        "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
        "version": 1,
        "newProjectRoot": "projects",
        "projects": {
          "angular-app": {
            "projectType": "application",
            "schematics": {
              "@schematics/angular:component": {
                "style": "css",
                "standalone": true
              }
            },
            "root": "",
            "sourceRoot": "src",
            "prefix": "app",
            "architect": {
              "build": {
                "builder": "@angular-devkit/build-angular:application",
                "options": {
                  "outputPath": "dist/angular-app",
                  "index": "src/index.html",
                  "browser": "src/main.ts",
                  "polyfills": ["src/polyfills.ts"],
                  "tsConfig": "tsconfig.app.json",
                  "inlineStyleLanguage": "css",
                  "assets": [
                    "src/favicon.ico",
                    "src/assets"
                  ],
                  "styles": [
                    "src/styles.css"
                  ],
                  "scripts": []
                },
                "configurations": {
                  "production": {
                    "budgets": [
                      {
                        "type": "initial",
                        "maximumWarning": "500kb",
                        "maximumError": "1mb"
                      },
                      {
                        "type": "anyComponentStyle",
                        "maximumWarning": "2kb",
                        "maximumError": "4kb"
                      }
                    ],
                    "outputHashing": "all"
                  },
                  "development": {
                    "optimization": false,
                    "extractLicenses": false,
                    "sourceMap": true
                  }
                },
                "defaultConfiguration": "production"
              },
              "serve": {
                "builder": "@angular-devkit/build-angular:dev-server",
                "options": {
                  "buildTarget": "angular-app:build:development"
                },
                "configurations": {
                  "production": {
                    "buildTarget": "angular-app:build:production"
                  },
                  "development": {
                    "buildTarget": "angular-app:build:development"
                  }
                },
                "defaultConfiguration": "development"
              }
            }
          }
        }
      }, null, 2),
      'tsconfig.json': JSON.stringify({
        "compileOnSave": false,
        "compilerOptions": {
          "baseUrl": "./",
          "outDir": "./dist/out-tsc",
          "forceConsistentCasingInFileNames": true,
          "strict": true,
          "noImplicitOverride": true,
          "noPropertyAccessFromIndexSignature": true,
          "noImplicitReturns": true,
          "noFallthroughCasesInSwitch": true,
          "sourceMap": true,
          "declaration": false,
          "downlevelIteration": true,
          "experimentalDecorators": true,
          "moduleResolution": "node",
          "importHelpers": true,
          "target": "ES2022",
          "module": "ES2022",
          "useDefineForClassFields": false,
          "lib": [
            "ES2022",
            "dom"
          ]
        },
        "angularCompilerOptions": {
          "enableI18nLegacyMessageIdFormat": false,
          "strictInjectionParameters": true,
          "strictInputAccessModifiers": true,
          "strictTemplates": true
        }
      }, null, 2),
      'tsconfig.app.json': JSON.stringify({
        "extends": "./tsconfig.json",
        "compilerOptions": {
          "outDir": "./out-tsc/app",
          "types": [],
          "moduleResolution": "node"
        },
        "files": [
          "src/main.ts",
          "src/polyfills.ts"
        ],
        "include": [
          "src/**/*.d.ts",
          "src/**/*.ts"
        ]
      }, null, 2),
      'package.json': JSON.stringify({
        "name": "angular-app",
        "version": "0.0.0",
        "scripts": {
          "ng": "ng",
          "start": "ng serve",
          "build": "ng build",
          "watch": "ng build --watch --configuration development"
        },
        "private": true,
        "dependencies": {
          "@angular/animations": "~17.0.0",
          "@angular/common": "~17.0.0",
          "@angular/compiler": "~17.0.0",
          "@angular/core": "~17.0.0",
          "@angular/forms": "~17.0.0",
          "@angular/platform-browser": "~17.0.0",
          "@angular/platform-browser-dynamic": "~17.0.0",
          "@angular/router": "~17.0.0",
          "rxjs": "~7.8.0",
          "tslib": "^2.3.0",
          "zone.js": "~0.14.2"
        },
        "devDependencies": {
          "@angular-devkit/build-angular": "~17.0.0",
          "@angular/cli": "~17.0.0",
          "@angular/compiler-cli": "~17.0.0",
          "@types/jasmine": "~5.1.0",
          "jasmine-core": "~5.1.0",
          "karma": "~6.4.0",
          "karma-chrome-launcher": "~3.2.0",
          "karma-coverage": "~2.2.0",
          "karma-jasmine": "~5.1.0",
          "karma-jasmine-html-reporter": "~2.1.0",
          "typescript": "~5.2.2"
        }
      }, null, 2),
      'src/polyfills.ts': `/**
 * This file includes polyfills needed by Angular and is loaded before the app.
 * You can add your own extra polyfills to this file.
 */

import 'zone.js';  // Included with Angular CLI.`
    };

    return {
      ...validatedCode.files,
      ...configFiles
    };
  } catch (error) {
    console.error("Angular code generation failed:", error);
    throw error;
  }
}

// Add new function to process Figma data into design structure
async function processFigmaData(figmaData) {
  try {
    // Extract design structure from Figma data
    const designStructure = {
      components: {},
      services: {},
      models: {},
      routes: []
    };

    // Process Figma nodes to extract components
    const processNode = (node) => {
      if (node.type === 'COMPONENT' || node.type === 'INSTANCE') {
        const componentName = node.name.replace(/[^a-zA-Z0-9]/g, '');
        designStructure.components[componentName] = {
          description: node.description || `Component from Figma: ${node.name}`,
          properties: [],
          childComponents: [],
          styles: {
            width: node.absoluteBoundingBox?.width,
            height: node.absoluteBoundingBox?.height,
            backgroundColor: node.backgroundColor,
            borderRadius: node.cornerRadius,
            padding: node.padding,
            margin: node.margin,
            // Add more style properties as needed
          }
        };

        // Process child nodes
        if (node.children) {
          node.children.forEach(child => {
            const childName = child.name.replace(/[^a-zA-Z0-9]/g, '');
            designStructure.components[componentName].childComponents.push(childName);
            processNode(child);
          });
        }
      }
    };

    // Process all nodes in the Figma document
    if (figmaData.document) {
      processNode(figmaData.document);
    }

    // Add routes based on top-level components
    Object.keys(designStructure.components).forEach(componentName => {
      designStructure.routes.push({
        path: componentName.toLowerCase(),
        component: `${componentName}Component`
      });
    });

    return designStructure;
  } catch (error) {
    console.error("Failed to process Figma data:", error);
    throw new Error(`Failed to process Figma data: ${error.message}`);
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
      console.log(`Verified required file exists: ${file}`);
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

// Add Angular-specific fixes
async function fixAngularIssues(files) {
  try {
    console.log('Fixing Angular-specific issues...');
    
    // Fix 1: Ensure all components have proper imports
    for (const [filepath, content] of Object.entries(files)) {
      if (filepath.endsWith('.component.ts')) {
        // Add missing imports if needed
        let updatedContent = content;
        if (!content.includes('import { CommonModule }')) {
          updatedContent = `import { CommonModule } from '@angular/common';\n${content}`;
        }
        if (!content.includes('import { FormsModule }') && content.includes('ngModel')) {
          updatedContent = `import { FormsModule } from '@angular/forms';\n${updatedContent}`;
        }
        if (!content.includes('import { RouterModule }') && content.includes('routerLink')) {
          updatedContent = `import { RouterModule } from '@angular/router';\n${updatedContent}`;
        }
        files[filepath] = updatedContent;
      }
    }

    // Fix 2: Ensure proper component decorators
    for (const [filepath, content] of Object.entries(files)) {
      if (filepath.endsWith('.component.ts')) {
        let updatedContent = content;
        if (!content.includes('standalone: true')) {
          updatedContent = content.replace(
            /@Component\({/,
            '@Component({\n  standalone: true,'
          );
        }
        files[filepath] = updatedContent;
      }
    }

    // Fix 3: Ensure proper module imports in component decorators
    for (const [filepath, content] of Object.entries(files)) {
      if (filepath.endsWith('.component.ts')) {
        let updatedContent = content;
        const imports = [];
        
        if (content.includes('CommonModule')) imports.push('CommonModule');
        if (content.includes('FormsModule')) imports.push('FormsModule');
        if (content.includes('RouterModule')) imports.push('RouterModule');
        
        if (imports.length > 0) {
          const importsString = imports.join(', ');
          if (!content.includes(`imports: [${importsString}]`)) {
            updatedContent = content.replace(
              /@Component\({[\s\S]*?}\)[\s\S]*?export class/,
              `@Component({\n  selector: 'app-${filepath.split('/').pop().replace('.component.ts', '')}',\n  templateUrl: './${filepath.split('/').pop().replace('.ts', '.html')}',\n  styleUrls: ['./${filepath.split('/').pop().replace('.ts', '.css')}'],\n  standalone: true,\n  imports: [${importsString}]\n})\nexport class`
            );
          }
        }
        files[filepath] = updatedContent;
      }
    }

    // Fix 4: Ensure proper HTML template references
    for (const [filepath, content] of Object.entries(files)) {
      if (filepath.endsWith('.component.ts')) {
        const componentName = filepath.split('/').pop().replace('.component.ts', '');
        let updatedContent = content;
        
        // Fix templateUrl if needed
        if (!content.includes(`templateUrl: './${componentName}.component.html'`)) {
          updatedContent = updatedContent.replace(
            /templateUrl: '[^']*'/,
            `templateUrl: './${componentName}.component.html'`
          );
        }
        
        // Fix styleUrls if needed
        if (!content.includes(`styleUrls: ['./${componentName}.component.css']`)) {
          updatedContent = updatedContent.replace(
            /styleUrls: \[[^\]]*\]/,
            `styleUrls: ['./${componentName}.component.css']`
          );
        }
        
        files[filepath] = updatedContent;
      }
    }

    // Fix 5: Ensure proper routing configuration
    if (files['src/app/app.routes.ts']) {
      let routesContent = files['src/app/app.routes.ts'];
      
      // Add missing imports
      const componentImports = new Set();
      const routes = routesContent.match(/{[^}]*}/g) || [];
      routes.forEach(route => {
        const componentMatch = route.match(/component:\s*(\w+)/);
        if (componentMatch) {
          const componentName = componentMatch[1];
          componentImports.add(componentName);
        }
      });

      let importStatements = '';
      componentImports.forEach(component => {
        const componentPath = `./components/${component.toLowerCase()}/${component.toLowerCase()}.component`;
        importStatements += `import { ${component} } from '${componentPath}';\n`;
      });

      if (importStatements) {
        routesContent = importStatements + routesContent;
      }

      files['src/app/app.routes.ts'] = routesContent;
    }

    console.log('Angular-specific issues fixed successfully');
    return files;
  } catch (error) {
    console.error('Error fixing Angular issues:', error);
    throw error;
  }
}

async function buildAndServeAngular(jobId, workDir) {
  try {
    console.log(`Workspace directory structure for job ${jobId}:`);
    await logDirectoryStructure(workDir);

    // Validate Angular configuration before proceeding
    await validateAngularConfig(workDir);

    // Step 1: Install dependencies with detailed logging
    console.log(`Installing dependencies for job ${jobId}...`);
    updateJobStatus(jobId, "processing", 50, "Installing dependencies");
    
    try {
      // First, ensure we're in the correct directory
      process.chdir(workDir);
      
      // Install dependencies with legacy-peer-deps flag to handle version conflicts
      const installResult = await runCommand("npm", ["install", "--legacy-peer-deps"], { 
        cwd: workDir,
        env: { ...process.env, FORCE_COLOR: true }
      });
      console.log("Dependencies installed successfully");
      updateJobStatus(jobId, "processing", 70, "Dependencies installed successfully");
    } catch (installError) {
      console.error("Failed to install dependencies:", installError);
      throw new Error(`Failed to install dependencies: ${installError.message}`);
    }

    // Step 2: Build the Angular project with detailed logging
    console.log(`Building Angular app for job ${jobId}...`);
    updateJobStatus(jobId, "processing", 80, "Building Angular application");
    
    try {
      // First, verify Angular CLI is installed
      await runCommand("npx", ["ng", "version"], { cwd: workDir });
      
      // Then run the build with production configuration
      const buildResult = await runCommand("npx", ["ng", "build", "--configuration=production"], {
        cwd: workDir,
        env: { ...process.env, FORCE_COLOR: true }
      });

      console.log("Build completed successfully");
      updateJobStatus(jobId, "processing", 90, "Build completed successfully");

      // Process the built files
      const distDir = path.join(workDir, "dist/angular-app");
      const previewDir = path.join(__dirname, "previews", jobId);
      
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

      // Create downloadable ZIP
      const zipPath = await createProjectZip(workDir, jobId);
      
      // Update job as completed
      updateJobStatus(
        jobId,
        "completed",
        100,
        "Project files generated successfully",
        {
          downloadUrl: `/api/download/${jobId}`,
          previewUrl: `/previews/${jobId}/index.html`,
          projectPath: workDir
        }
      );

      return `/previews/${jobId}/index.html`;
    } catch (buildError) {
      console.error("Build failed with error:", buildError);
      updateJobStatus(jobId, "failed", 0, `Build failed: ${buildError.message}`);
      throw buildError;
    }
  } catch (error) {
    console.error("Failed to build Angular project:", error);
    updateJobStatus(jobId, "failed", 0, `Build failed: ${error.message}`);
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

// Add validation for angular.json
async function validateAngularConfig(workDir) {
  const angularJsonPath = path.join(workDir, 'angular.json');
  try {
    const angularJson = await fs.readJson(angularJsonPath);
    
    // Validate required properties
    if (!angularJson.projects || !angularJson.projects['angular-app']) {
      throw new Error('Invalid angular.json: missing projects configuration');
    }

    const project = angularJson.projects['angular-app'];
    if (!project.architect || !project.architect.serve) {
      throw new Error('Invalid angular.json: missing serve configuration');
    }

    const serveConfig = project.architect.serve;
    if (!serveConfig.options || !serveConfig.options.buildTarget) {
      throw new Error('Invalid angular.json: missing buildTarget in serve options');
    }

    // Update serve configuration if needed
    if (!serveConfig.options.buildTarget) {
      serveConfig.options.buildTarget = 'angular-app:build:development';
    }

    // Write back the validated configuration
    await fs.writeJson(angularJsonPath, angularJson, { spaces: 2 });
    console.log('Validated and updated angular.json configuration');
  } catch (error) {
    console.error('Error validating angular.json:', error);
    throw error;
  }
}