// code-analyzer.js
const fs = require("fs-extra");

class CodeAnalyzer {
  constructor(llmMemory) {
    this.memory = llmMemory;
    this.errorPatterns = [
      {
        pattern: /import\s+{\s*standalone\s*}/i,
        description: "Incorrectly importing 'standalone' from '@angular/core'",
        correction:
          "Use standalone: true in @Component decorator instead of importing it",
        test: (files) => {
          for (const [filename, content] of Object.entries(files)) {
            if (
              filename.endsWith(".ts") &&
              content.includes("import { standalone }")
            ) {
              return true;
            }
          }
          return false;
        },
      },
      {
        pattern: /@Component\s*\(\s*{[^}]*}\s*\)/,
        description: "Missing styleUrls in @Component decorator",
        correction:
          "Add styleUrls: ['./app.component.css'] to the @Component decorator",
        test: (files) => {
          if (
            files["app.component.ts"] &&
            !files["app.component.ts"].includes("styleUrls")
          ) {
            return true;
          }
          return false;
        },
      },
      {
        pattern: /class="([^"]*)"/g,
        description:
          "CSS classes used in HTML without corresponding definitions in CSS",
        test: (files) => {
          if (!files["app.component.html"] || !files["app.component.css"]) {
            return false;
          }

          const htmlClasses = new Set();
          const html = files["app.component.html"];
          const css = files["app.component.css"];

          // Extract classes from HTML
          const classRegex = /class="([^"]*)"/g;
          let match;
          while ((match = classRegex.exec(html)) !== null) {
            const classNames = match[1].split(/\s+/);
            classNames.forEach((className) => {
              if (className.trim()) htmlClasses.add(className.trim());
            });
          }

          // Extract classes from CSS
          const cssClassRegex = /\.([a-zA-Z0-9_-]+)(?:\s*\{|\s*,)/g;
          const cssClasses = new Set();
          while ((match = cssClassRegex.exec(css)) !== null) {
            cssClasses.add(match[1]);
          }

          // Check if any HTML classes are missing in CSS
          for (const className of htmlClasses) {
            if (!cssClasses.has(className)) {
              return true;
            }
          }

          return false;
        },
      },
      {
        pattern:
          /rgba?\(\s*([0-9]*\.?[0-9]+)\s*,\s*([0-9]*\.?[0-9]+)\s*,\s*([0-9]*\.?[0-9]+)/g,
        description: "Color values between 0-1 not multiplied by 255 for RGB",
        correction:
          "Multiply RGB values by 255 when converting from Figma format",
        test: (files) => {
          for (const [filename, content] of Object.entries(files)) {
            if (filename.endsWith(".css")) {
              const rgbRegex =
                /rgba?\(\s*([0-9]*\.?[0-9]+)\s*,\s*([0-9]*\.?[0-9]+)\s*,\s*([0-9]*\.?[0-9]+)/g;
              let match;
              while ((match = rgbRegex.exec(content)) !== null) {
                const r = parseFloat(match[1]);
                const g = parseFloat(match[2]);
                const b = parseFloat(match[3]);

                if (r < 1 && g < 1 && b < 1) {
                  return true; // Found 0-1 range values that should have been multiplied by 255
                }
              }
            }
          }
          return false;
        },
      },
    ];

    this.successPatterns = [
      {
        pattern: /@Component\(\{\s*[^}]*standalone:\s*true/,
        description: "Properly configured standalone component",
        example:
          "@Component({ selector: 'app-root', standalone: true, imports: [CommonModule] })",
        test: (files) => {
          return (
            files["app.component.ts"] &&
            files["app.component.ts"].includes("standalone: true") &&
            files["app.component.ts"].includes("CommonModule")
          );
        },
      },
      {
        pattern: /bootstrapApplication\(\s*AppComponent\s*,/,
        description: "Proper bootstrapping of standalone Angular component",
        example: "bootstrapApplication(AppComponent, { providers: [] })",
        test: (files) => {
          return (
            files["main.ts"] &&
            files["main.ts"].includes("bootstrapApplication(AppComponent")
          );
        },
      },
      {
        pattern: /\(click\)\s*=\s*"[^"]+\(\)"/,
        description: "Proper Angular event binding syntax",
        example: '<button (click)="onButtonClick()">Click Me</button>',
        test: (files) => {
          return (
            files["app.component.html"] &&
            files["app.component.html"].includes("(click)=")
          );
        },
      },
    ];
  }

  async analyzeGeneratedCode(files) {
    const findings = {
      errors: [],
      successes: [],
    };

    // Check for error patterns
    for (const pattern of this.errorPatterns) {
      if (pattern.test(files)) {
        findings.errors.push(pattern);
        await this.memory.addError(
          pattern.pattern.toString(),
          pattern.description,
          pattern.correction
        );
      }
    }

    // Check for success patterns
    for (const pattern of this.successPatterns) {
      if (pattern.test(files)) {
        findings.successes.push(pattern);
        await this.memory.addSuccess(
          pattern.pattern.toString(),
          pattern.description,
          pattern.example
        );
      }
    }

    // Look for additional patterns to learn from the code
    await this.learnFromCode(files);

    return findings;
  }

  async learnFromCode(files) {
    // Learn from common structures in HTML
    if (files["app.component.html"]) {
      // Check for responsive layout patterns
      if (
        files["app.component.html"].includes('class="container"') &&
        files["app.component.css"] &&
        files["app.component.css"].includes("@media")
      ) {
        await this.memory.addSuccess(
          "responsive-layout",
          "Using responsive container with media queries",
          "container class with @media (max-width: 768px) { ... }"
        );
      }
    }

    // Learn from component structure
    if (files["app.component.ts"]) {
      // Check for lifecycle hooks
      if (/ngOnInit\(\)\s*{/.test(files["app.component.ts"])) {
        await this.memory.addSuccess(
          "lifecycle-hooks",
          "Using Angular lifecycle hooks properly",
          "ngOnInit() { /* initialization logic */ }"
        );
      }
    }
  }
}

module.exports = CodeAnalyzer;
