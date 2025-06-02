# Angular Project Generator

This application generates angular code using three different input methods: Figma file, text description, and voice command.


## Features

* **Figma to Angular:** Generate an Angular project directly from your Figma design.
* **Text to Angular:** Describe your desired design in text, and the application will generate the Angular code.
* **Voice to Angular:** Use your voice to describe the design, and the application will convert it into an Angular project.
* **Real-time Feedback:** Track the progress of your project generation with a dynamic progress bar and status updates.
* **Preview:** Preview the generated Angular project directly in your browser.
* **Download:** Download the generated Angular project as a ZIP file.

## Getting Started

1.  **Install Backend Dependencies:** 
    ```bash
    pip3 install whisper
    ```
    ```bash
    pip3 install aws-sdk
    ```

2.  **Install Frontend Dependencies:** 
    ```bash
    npm install
    ```

3.  **Start the Application:** 
    ```bash
    npm start
    ```

## Run using docker
```bash
docker-compose up --build
