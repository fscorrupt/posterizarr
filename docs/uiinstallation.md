# Run the Web UI from Source

This guide is for development or manual setups on **Windows** and **Linux**. It
is not needed when running the standard Docker or Unraid installation, which
already includes the Web UI. For a normal first-time setup, see the
[getting started guide](getting_started.md).

**Prerequisites**

Before you begin, ensure you have the following software installed and accessible from your system's command line (PATH):

- ✅ **Python 3:** Required for the backend server.
- ✅ **Node.js (with npm):** Required for the frontend interface.
- ✅ **PowerShell Core:** Required to run the main `Posterizarr.ps1` script.

**Setup Instructions**

The setup process is handled by a simple script that installs all necessary dependencies.

1.  Open a terminal or command prompt.
2.  Navigate into the `webui` directory located in the project's root folder.
    ```bash
    cd path/to/Posterizarr/webui
    ```
3.  Run the appropriate setup script for your operating system:
    - **On Windows:**
      ```bash
      setup.ps1
      ```
      or
      ```bash
      setup.bat
      ```
    - **On Linux or macOS:**
      ```bash
      setup.sh
      ```
      The script will verify your prerequisites and install all required backend (Python) and frontend (Node.js) packages.

**Running the UI**

After the setup is complete, you need to start the backend and frontend processes in **two separate terminals**.

**Terminal 2: Start the Frontend**

```bash
# Navigate to the frontend directory
cd webui/frontend

# Run the development server
npm run build
```

**Terminal 1: Start the Backend**

```bash
# Navigate to the backend directory
cd webui/backend

# Run the Python server
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```
- **Troubleshooting**: Cannot access the Web UI from another device? See the [Networking](networking.md) section.

Once both services are running, you can access the Posterizarr Web UI by opening your browser and navigating to: http://localhost:8000