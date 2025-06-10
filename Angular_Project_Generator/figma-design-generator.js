const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');

const FIGMA_API_BASE = "https://api.figma.com/v1";
const FIGMA_TOKEN = "figd_r0hCx_IOCSCRwn1MGtib6g_cvWUdIvCO43YZBqpe";

class FigmaDesignGenerator {
    constructor() {
        this.FIGMA_API_BASE = FIGMA_API_BASE;
        this.FIGMA_TOKEN = FIGMA_TOKEN;
    }

    async generateDesignFromFigma(figmaKey) {
        try {
            // Fetch Figma data
            const figmaData = await this.fetchFigmaData(figmaKey);
            
            // Process Figma data into design structure
            const designStructure = await this.processFigmaData(figmaData);
            
            return designStructure;
        } catch (error) {
            console.error("Failed to generate design from Figma:", error);
            throw error;
        }
    }

    async fetchFigmaData(figmaKey) {
        try {
            const response = await fetch(`${this.FIGMA_API_BASE}/files/${figmaKey}`, {
                headers: {
                    "X-Figma-Token": this.FIGMA_TOKEN,
                },
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Figma API error: ${errorData.status || response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error("Failed to fetch Figma data:", error);
            throw new Error(`Failed to fetch Figma data: ${error.message}`);
        }
    }

    async processFigmaData(figmaData) {
        try {
            // Initialize design structure
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

            // Add services based on component interactions
            this.addServicesFromComponents(designStructure);

            // Add models based on component data
            this.addModelsFromComponents(designStructure);

            return designStructure;
        } catch (error) {
            console.error("Failed to process Figma data:", error);
            throw new Error(`Failed to process Figma data: ${error.message}`);
        }
    }

    addServicesFromComponents(designStructure) {
        // Add common services based on component types
        const serviceTypes = new Set();

        Object.entries(designStructure.components).forEach(([componentName, component]) => {
            // Check for form components
            if (componentName.toLowerCase().includes('form')) {
                serviceTypes.add('FormService');
            }
            // Check for data display components
            if (componentName.toLowerCase().includes('list') || 
                componentName.toLowerCase().includes('table') || 
                componentName.toLowerCase().includes('grid')) {
                serviceTypes.add('DataService');
            }
            // Check for authentication components
            if (componentName.toLowerCase().includes('login') || 
                componentName.toLowerCase().includes('auth')) {
                serviceTypes.add('AuthService');
            }
        });

        // Add services to design structure
        serviceTypes.forEach(serviceType => {
            designStructure.services[serviceType] = {
                description: `${serviceType} for handling ${serviceType.toLowerCase().replace('service', '')} related operations`,
                methods: this.getServiceMethods(serviceType)
            };
        });
    }

    getServiceMethods(serviceType) {
        const methodMap = {
            'FormService': ['submitForm', 'validateForm', 'resetForm'],
            'DataService': ['getData', 'saveData', 'updateData', 'deleteData'],
            'AuthService': ['login', 'logout', 'register', 'getCurrentUser']
        };
        return methodMap[serviceType] || [];
    }

    addModelsFromComponents(designStructure) {
        // Add models based on component data structures
        Object.entries(designStructure.components).forEach(([componentName, component]) => {
            if (componentName.toLowerCase().includes('form')) {
                // Add form model
                designStructure.models[`${componentName}Model`] = {
                    properties: {
                        id: 'string',
                        name: 'string',
                        email: 'string',
                        createdAt: 'Date'
                    }
                };
            }
            if (componentName.toLowerCase().includes('list') || 
                componentName.toLowerCase().includes('table')) {
                // Add data model
                designStructure.models[`${componentName}Item`] = {
                    properties: {
                        id: 'string',
                        title: 'string',
                        description: 'string',
                        status: 'string',
                        updatedAt: 'Date'
                    }
                };
            }
        });
    }
}

module.exports = FigmaDesignGenerator; 