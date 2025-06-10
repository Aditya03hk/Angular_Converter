// memory-service.js
const fs = require("fs-extra");
const path = require("path");

class LLMMemory {
  constructor(memoryFilePath) {
    this.memoryFilePath =
      memoryFilePath || path.join(__dirname, "llm-memory.json");
    this.memory = {
      successes: [], // Patterns that worked well
      errors: [], // Mistakes to avoid
      rules: [], // General guidelines
    };
    this.initMemory();
  }

  async initMemory() {
    try {
      if (await fs.pathExists(this.memoryFilePath)) {
        const data = await fs.readJson(this.memoryFilePath);
        this.memory = {
          successes: data.successes || [],
          errors: data.errors || [],
          rules: data.rules || [],
        };
        console.log("Memory loaded successfully");
      } else {
        // Initialize with default rules if file doesn't exist
        this.memory.rules = [
          "Always include standalone: true in the @Component decorator",
          "Import CommonModule from '@angular/common' for standalone components",
          "Convert Figma colors from 0-1 range to rgb/rgba by multiplying by 255",
          "Ensure all CSS classes used in HTML have corresponding definitions",
          "Use proper StyleUrls in the @Component decorator",
        ];
        await this.saveMemory();
        console.log("Memory initialized with default rules");
      }
    } catch (error) {
      console.error("Failed to initialize memory:", error);
    }
  }

  async saveMemory() {
    try {
      await fs.writeJson(this.memoryFilePath, this.memory, { spaces: 2 });
      console.log("Memory saved successfully");
    } catch (error) {
      console.error("Failed to save memory:", error);
    }
  }

  addSuccess(pattern, description, example) {
    const existingIndex = this.memory.successes.findIndex(
      (s) => s.pattern === pattern
    );

    if (existingIndex >= 0) {
      // Update existing pattern
      this.memory.successes[existingIndex].count =
        (this.memory.successes[existingIndex].count || 1) + 1;
      this.memory.successes[existingIndex].lastSeen = new Date().toISOString();
    } else {
      // Add new pattern
      this.memory.successes.push({
        pattern,
        description,
        example,
        count: 1,
        added: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }

    return this.saveMemory();
  }

  addError(pattern, description, correction) {
    const existingIndex = this.memory.errors.findIndex(
      (e) => e.pattern === pattern
    );

    if (existingIndex >= 0) {
      // Update existing error
      this.memory.errors[existingIndex].count =
        (this.memory.errors[existingIndex].count || 1) + 1;
      this.memory.errors[existingIndex].lastSeen = new Date().toISOString();

      // If correction is provided, update it
      if (correction) {
        this.memory.errors[existingIndex].correction = correction;
      }
    } else {
      // Add new error
      this.memory.errors.push({
        pattern,
        description,
        correction,
        count: 1,
        added: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }

    return this.saveMemory();
  }

  addRule(rule, importance = "medium") {
    if (!this.memory.rules.includes(rule)) {
      this.memory.rules.push({
        rule,
        importance,
        added: new Date().toISOString(),
      });
      return this.saveMemory();
    }
    return Promise.resolve();
  }

  getFormattedMemory(limit = 5) {
    // Sort by count and recency
    const sortedSuccesses = [...this.memory.successes]
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, limit);

    const sortedErrors = [...this.memory.errors]
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, limit);

    // Sort rules by importance
    const importanceValues = { high: 3, medium: 2, low: 1 };
    const sortedRules = [...this.memory.rules].sort(
      (a, b) =>
        importanceValues[b.importance || "medium"] -
        importanceValues[a.importance || "medium"]
    );

    let formattedMemory = `
## SYSTEM MEMORY - GUIDELINES FOR CODE GENERATION

### RULES - ALWAYS FOLLOW THESE:
${sortedRules
  .map((r) => `- ${r.rule} ${r.importance === "high" ? "(CRITICAL)" : ""}`)
  .join("\n")}

### SUCCESSES - PATTERNS TO FOLLOW:
${sortedSuccesses
  .map(
    (s) => `- ${s.description}${s.example ? `\n  Example: ${s.example}` : ""}`
  )
  .join("\n")}

### ERRORS - PATTERNS TO AVOID:
${sortedErrors
  .map(
    (e) =>
      `- ${e.description}${
        e.correction ? `\n  Correction: ${e.correction}` : ""
      }`
  )
  .join("\n")}
`;

    return formattedMemory;
  }
}

module.exports = LLMMemory;
