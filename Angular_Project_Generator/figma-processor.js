const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const FigmaDesignGenerator = require('./figma-design-generator');

const FIGMA_API_BASE = "https://api.figma.com/v1";
const FIGMA_TOKEN = "figd_r0hCx_IOCSCRwn1MGtib6g_cvWUdIvCO43YZBqpe";

class FigmaProcessor {
    constructor(processingQueue) {
        this.PROCESSING_QUEUE = processingQueue;
        this.designGenerator = new FigmaDesignGenerator();
    }

    // Update job status in the processing queue
    updateJobStatus(jobId, status, progress, message, extras = {}) {
        const jobData = this.PROCESSING_QUEUE.get(jobId);
        if (jobData) {
            this.PROCESSING_QUEUE.set(jobId, {
                ...jobData,
                status,
                progress,
                message,
                updated: new Date(),
                ...extras
            });
            console.log(`[Job ${jobId}] ${status} (${progress}%): ${message}`);
        }
    }

    // Main processing pipeline for Figma to Angular conversion
    async processFigmaToAngular(jobId, figmaKey) {
        const workDir = path.join(__dirname, "workspaces", jobId);
        try {
            // Create workspace directory
            await fs.ensureDir(workDir);
            console.log(`Created workspace directory: ${workDir}`);

            // Update job status
            this.updateJobStatus(jobId, "processing", 10, "Fetching Figma design data");

            // Generate design structure from Figma
            const designStructure = await this.designGenerator.generateDesignFromFigma(figmaKey);
            
            // Save the generated design
            await fs.writeJson(path.join(workDir, "design-structure.json"), designStructure, {
                spaces: 2,
            });

            this.updateJobStatus(jobId, "processing", 30, "Generating Angular code from design");

            // Generate Angular code from the design structure
            const files = await this.generateAngularCode(designStructure);

            // Write all files with proper error handling
            console.log(`Writing ${Object.keys(files).length} files to workspace...`);
            for (const [filepath, content] of Object.entries(files)) {
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

            this.updateJobStatus(jobId, "processing", 50, "Creating Angular project structure");
            
            // Create Angular project structure
            await this.continueAngularConversion(jobId, workDir, files);

            // Create downloadable ZIP of the project
            const zipPath = await this.createProjectZip(workDir, jobId);
            
            // Update job as completed
            this.updateJobStatus(
                jobId,
                "completed",
                100,
                "Project files generated successfully",
                {
                    downloadUrl: `/api/download/${jobId}`,
                    projectPath: workDir
                }
            );

            // Schedule cleanup
            setTimeout(() => {
                this.cleanupJob(jobId);
            }, 2 * 60 * 60 * 1000);

        } catch (error) {
            console.error(`Error processing job ${jobId}:`, error);
            this.updateJobStatus(jobId, "failed", 0, `Conversion failed: ${error.message}`);
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

    // Fetch Figma data from API
    async fetchFigmaData(figmaKey) {
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

    // Process Figma data into design structure
    async processFigmaData(figmaData) {
        try {
            const designStructure = {
                components: {},
                services: {},
                models: {},
                routes: []
            };

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
                        }
                    };

                    if (node.children) {
                        node.children.forEach(child => {
                            const childName = child.name.replace(/[^a-zA-Z0-9]/g, '');
                            designStructure.components[componentName].childComponents.push(childName);
                            processNode(child);
                        });
                    }
                }
            };

            if (figmaData.document) {
                processNode(figmaData.document);
            }

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

    // Continue Angular conversion process
    async continueAngularConversion(jobId, workDir, files) {
        try {
            this.updateJobStatus(jobId, "processing", 60, "Setting up Angular project");
            
            // Create Angular project structure
            await this.createAngularProject(workDir, files);
            
            this.updateJobStatus(jobId, "processing", 80, "Building Angular project");
            
            // Build and serve Angular project
            await this.buildAndServeAngular(jobId, workDir);
            
            this.updateJobStatus(jobId, "processing", 90, "Finalizing project");
            
            // Validate project structure
            await this.validateProjectStructure(workDir);
            
            // Validate Angular configuration
            await this.validateAngularConfig(workDir);
            
        } catch (error) {
            console.error("Error in Angular conversion:", error);
            throw error;
        }
    }

    // Create Angular project
    async createAngularProject(workDir, files) {
        try {
            // Implementation of createAngularProject
            // This would include setting up the Angular project structure
            // and copying the generated files to the appropriate locations
        } catch (error) {
            console.error("Error creating Angular project:", error);
            throw error;
        }
    }

    // Build and serve Angular project
    async buildAndServeAngular(jobId, workDir) {
        try {
            // Implementation of buildAndServeAngular
            // This would include building the Angular project
            // and setting up a development server
        } catch (error) {
            console.error("Error building Angular project:", error);
            throw error;
        }
    }

    // Validate project structure
    async validateProjectStructure(workDir) {
        try {
            // Implementation of validateProjectStructure
            // This would include checking the project structure
            // and ensuring all required files are present
        } catch (error) {
            console.error("Error validating project structure:", error);
            throw error;
        }
    }

    // Validate Angular configuration
    async validateAngularConfig(workDir) {
        try {
            // Implementation of validateAngularConfig
            // This would include validating the Angular configuration
            // and ensuring all settings are correct
        } catch (error) {
            console.error("Error validating Angular config:", error);
            throw error;
        }
    }

    // Create project ZIP
    async createProjectZip(workDir, jobId) {
        try {
            // Implementation of createProjectZip
            // This would include creating a ZIP file of the project
            // for download
        } catch (error) {
            console.error("Error creating project ZIP:", error);
            throw error;
        }
    }

    // Cleanup job
    cleanupJob(jobId) {
        this.PROCESSING_QUEUE.delete(jobId);
    }
}

module.exports = FigmaProcessor; 