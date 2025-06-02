
# User Guide: Angular Project Generator (t0.dev)

## Overview

The **Angular Project Generator** is an innovative application designed to streamline the creation of Angular projects by generating code from three distinct input methods: **Figma designs**, **text descriptions**, and **voice commands**. This tool is ideal for developers looking to quickly prototype or build Angular applications based on visual designs or natural language inputs.

### Key Features
- **Figma to Angular**: Convert Figma designs into Angular projects automatically.
- **Text to Angular**: Generate Angular code by describing the desired design in text.
- **Voice to Angular**: Use voice commands to describe a design, which is then converted into an Angular project.
- **Real-time Feedback**: Monitor project generation progress with a dynamic progress bar and status updates.
- **Preview**: View the generated Angular project directly in the browser.
- **Download**: Export the generated Angular project as a ZIP file for further development.

### Repository Details
- **GitHub URL**: [https://github.com/syed0wais/t0.dev](https://github.com/syed0wais/t0.dev)


## System Requirements

Before installing and running the Angular Project Generator, ensure your system meets the following requirements:
- **Operating System**: Windows, macOS, or Linux
- **Python**: Version 3.6 or higher (for backend dependencies)
- **Node.js**: Version 14.x or higher (for frontend dependencies)
- **Docker**: Optional, for running the application via Docker
- **Internet Connection**: Required for installing dependencies and accessing AWS services (if configured)
- **Browser**: Modern browser (e.g., Chrome, Firefox) for previewing generated projects

## Installation Instructions

The application consists of a **backend** (likely Python-based for processing Figma, text, and voice inputs) and a **frontend** (Angular-based for the user interface). Below are the steps to install and set up the application, as outlined in the repository’s README.

### Option 1: Manual Installation

#### Step 1: Clone the Repository
1. Open a terminal or command prompt.
2. Clone the repository to your local machine:
   ```bash
   git clone https://github.com/syed0wais/t0.dev.git
   ```
3. Navigate to the project directory:
   ```bash
   cd t0.dev
   ```

#### Step 2: Install Backend Dependencies
The backend requires Python and specific libraries (`whisper` for voice processing and `aws-sdk` for AWS integration).

1. Ensure Python 3.6+ is installed. Verify with:
   ```bash
   python3 --version
   ```
   If not installed, download and install from [python.org](https://www.python.org/downloads/).

2. Install the `whisper` library (likely OpenAI’s Whisper for speech-to-text):
   ```bash
   pip3 install whisper
   ```
   **Note**: Whisper may require additional dependencies like `ffmpeg`. On macOS, install `ffmpeg` with:
   ```bash
   brew install ffmpeg
   ```
   On Ubuntu:
   ```bash
   sudo apt-get install ffmpeg
   ```

3. Install the AWS SDK for Python (`boto3`, assumed to be the intended `aws-sdk`):
   ```bash
   pip3 install boto3
   ```
   **Note**: If AWS services are used (e.g., S3 for file storage or Lambda for processing), configure AWS credentials:
   - Run `aws configure` and provide your AWS Access Key, Secret Key, and region.
   - Alternatively, set environment variables:
     ```bash
     export AWS_ACCESS_KEY_ID='your-access-key'
     export AWS_SECRET_ACCESS_KEY='your-secret-key'
     export AWS_DEFAULT_REGION='your-region'
     ```

#### Step 3: Install Frontend Dependencies
The frontend is built with Angular, requiring Node.js and npm.

1. Ensure Node.js is installed. Verify with:
   ```bash
   node --version
   npm --version
   ```
   If not installed, download from [nodejs.org](https://nodejs.org/).

2. Install frontend dependencies:
   ```bash
   npm install
   ```
   This installs Angular and other dependencies listed in `package.json` (e.g., Angular CLI, TypeScript).

#### Step 4: Start the Application
1. Start the frontend (and potentially the backend, depending on the app’s structure):
   ```bash
   npm start
   ```
   - This typically runs the Angular development server (e.g., `ng serve`) on `http://localhost:3000`.
   - If the backend is a separate server (e.g., Flask or FastAPI), you may need to start it separately. Check for a `server.py` or similar file and run:
     ```bash
     python3 server.py
     ```
     (Adjust based on actual backend file names, not provided in README.)

2. Open your browser and navigate to `http://localhost:3000` (or the port specified in the terminal output).

### Option 2: Docker Installation

Docker simplifies setup by containerizing the application, ensuring consistency across environments.

#### Step 1: Install Docker
1. Install Docker Desktop (Windows/macOS) or Docker Engine (Linux) from [docker.com](https://www.docker.com/get-started).
2. Verify installation:
   ```bash
   docker --version
   docker-compose --version
   ```

#### Step 2: Run the Application
1. Ensure you’re in the project directory (`t0.dev`).
2. Build and run the application using Docker Compose:
   ```bash
   docker-compose up --build
   ```
   - This command builds the Docker images (for frontend and backend) and starts the containers.
   - Check `docker-compose.yml` (not provided but assumed to exist) for service configurations, such as ports and environment variables.

3. Access the application in your browser, typically at `http://localhost:3000` (confirm port in Docker output or `docker-compose.yml`).

4. To stop the containers, press `Ctrl+C` or run:
   ```bash
   docker-compose down
   ```

## Usage Instructions

Once the application is running, you can use it to generate Angular projects via the web interface. Below is a step-by-step guide to using each feature.

### 1. Accessing the Application
- Open your browser and go to `http://localhost:3000` (or the specified port).
- The interface likely includes options for selecting input methods: Figma, Text, or Voice.

### 2. Generating an Angular Project

#### Option A: Figma to Angular
1. **Select Figma Input**:
   - Choose the “Figma to Angular” option in the UI.
   - Authenticate with Figma (may require a Figma API token or OAuth login).
2. **Upload or Link Figma File**:
   - Provide a Figma file URL or upload a design file.
   - The application processes the design, extracting layouts, components, and styles.
3. **Generate Code**:
   - Click the generate button. A progress bar displays the generation status.
   - The backend likely uses AWS services (via `boto3`) to process the Figma file and convert it to Angular code.
4. **Preview and Download**:
   - Preview the generated Angular project in the browser.
   - Download the project as a ZIP file.

#### Option B: Text to Angular
1. **Select Text Input**:
   - Choose the “Text to Angular” option.
2. **Enter Description**:
   - Type a detailed description of the desired Angular application (e.g., “A dashboard with a navigation bar, three charts, and a table”).
3. **Generate Code**:
   - Submit the description. The application processes the text (possibly using an NLP model) to generate Angular code.
   - Monitor progress via the dynamic progress bar.
4. **Preview and Download**:
   - Preview the generated project.
   - Download the ZIP file.

#### Option C: Voice to Angular
1. **Select Voice Input**:
   - Choose the “Voice to Angular” option.
2. **Record Description**:
   - Click the record button and describe the design verbally.
   - The `whisper` library transcribes the audio to text.
3. **Generate Code**:
   - The transcribed text is processed to generate Angular code.
   - Track progress with the progress bar.
4. **Preview and Download**:
   - Preview the project in the browser.
   - Download the ZIP file.

### 3. Real-time Feedback
- During code generation, the UI displays a **progress bar** and **status updates** (e.g., “Processing Figma file”, “Generating components”).
- If errors occur, check the browser console or server logs (e.g., terminal output or Docker logs).

### 4. Previewing the Project
- The preview feature renders the generated Angular project in the browser.
- Interact with the preview to verify functionality (e.g., click buttons, navigate routes).
- Note: The preview may be a simplified rendering, as full Angular functionality requires running the project locally.

### 5. Downloading the Project
- After generation, click the “Download” button to receive a ZIP file.
- Extract the ZIP to access the Angular project, which includes:
  - Source code (`src/` directory with components, services, etc.)
  - Configuration files (`angular.json`, `package.json`)
  - Dependencies (listed in `package.json`)
- To run the downloaded project:
  ```bash
  cd extracted-project
  npm install
  ng serve
  ```

## Troubleshooting

- **Backend Errors**:
  - If `whisper` fails, ensure `ffmpeg` is installed and accessible.
  - For AWS errors, verify AWS credentials and region settings.
- **Frontend Errors**:
  - If `npm start` fails, check `package.json` for scripts and ensure dependencies are installed (`npm install`).
  - Clear the npm cache: `npm cache clean --force`.
- **Docker Issues**:
  - Ensure Docker is running and you have sufficient disk space.
  - Check `docker-compose.yml` for correct port mappings and environment variables.
  - View logs: `docker-compose logs`.
- **Port Conflicts**:
  - If `localhost:3000` is in use, specify a different port: `ng serve --port 3001`.
- **Figma Integration**:
  - Ensure a valid Figma API token or OAuth setup. Check the application’s documentation or UI for setup instructions.

## Additional Notes

- **AWS Integration**: The use of `boto3` suggests AWS services (e.g., S3, Lambda, or Rekognition) for processing inputs. Ensure your AWS account is configured and has the necessary permissions.
- **Voice Processing**: The `whisper` library indicates robust speech-to-text capabilities. Test with clear audio for best results.
- **Project Structure**: The generated Angular project likely follows standard Angular conventions (e.g., components, modules, services). Inspect the downloaded ZIP for details.
- **Extending the Application**:
  - To add features, explore the backend code (e.g., `server.py` or equivalent) and frontend code (`src/app/`).
  - Contribute to the repository by forking and submitting pull requests.
- **Demo Link**: The link [https://t0-dev.onrender.com](https://t0-dev.onrender.com) can be used to view and run the application; however, you will not be able to download the code as the deployment lacks virtual storage function.

## Support and Contribution

- **Issues**: Report bugs or feature requests on the GitHub repository’s [Issues page](https://github.com/syed0wais/t0.dev/issues).

