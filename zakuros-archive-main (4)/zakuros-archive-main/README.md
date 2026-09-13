README.md
Markdown
# Zakuros Archive 
NONE OF THIS MEDIA IS HOSTED ON ZAKUROS ARCHIVE! THIS IS SIMIPLY A PLACE TO FIND THEM ALL IN ONE PLACE, DOWNLOAD AT YOUR OWN RISK!
Zakuros Archive is a high-performance, full-stack game library management and enrichment application. It processes millions of rows of dataset configurations using Python data pipelines, provides a robust backend API service via TypeScript/Node, and displays a responsive, modern browse interface built with Vite, React, and TypeScript.

---

## 🏗️ Architecture Overview

The project is structured as a decoupled full-stack application utilizing a hybrid database pattern backed by optimized JSON structures:

*   **Frontend UI:** A lightning-fast Single Page Application (SPA) built with React, Vite, and Tailwind CSS.
*   **Backend Server (`server.ts`):** A Node.js TypeScript API layer that manages game query endpoints, metadata aggregation services, and search indexing.
*   **Data Pipeline Layer:** A suite of modular Python scripts (`build_and_enrich.py`, `enrich_metadata.py`, etc.) designed to parse raw scrapings, filter duplicates, and compile massive enriched JSON data lakes.

---

## 📦 Large File Storage (Git LFS)

This project handles massive, auto-generated database files (e.g., `merged_enriched.json`, `metadata.json`) totaling over **4 million lines of data**. 

To prevent repository performance degradation and to clear GitHub's strict 100MB file limit, **Git LFS (Large File Storage)** is strictly required for this repository.

### Restoring Large Datasets
If your cloned repository contains tiny text pointers instead of full JSON datasets, pull the actual files down by running:
bash
git lfs install
git lfs pull

🚀 Getting Started (Local Development)
Prerequisites
Ensure you have the following installed on your machine:

Node.js (v20 or higher)

Python (3.10 or higher)

Git LFS

1. Installation
Clone the repository and install the project dependencies:

Bash
# Clone the repository
git clone [https://github.com/zzakuro/zakuros-archive.git](https://github.com/zzakuro/zakuros-archive.git)
cd zakuros-archive/fitlib

# Install backend & frontend packages
npm install
2. Environment Setup
Create a .env file in the project root:

Bash
cp .env.example .env
Open .env and fill in your designated application ports and external metadata API credentials.

3. Running the Scripts & Data Processing
To set up your isolated Python environment and run the core data enrichment utilities:

Bash
# Initialize Python virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate

# Run the enrichment framework
python build_and_enrich.py
4. Booting the Application Runtime
Run the development stack concurrently:

Bash
# Start frontend client & backend API concurrently
npm run dev
🔧 Production Deployment
For a robust, persistent cloud deployment (Ubuntu VPS recommended), execute the following workflow:

1. Process Management via PM2
To keep the TypeScript backend API (server.ts) running continuously in the background, deploy it using PM2:

Bash
# Install PM2 and its TypeScript runtime module globally
sudo npm install pm2 -g
pm2 install typescript

# Start the server engine
pm2 start server.ts --name "fitlib-backend"
pm2 startup
pm2 save
2. Automating Data Enrichment Loops
To ensure your game databases parse and enrich automatically every night, establish a Linux cron job:

Bash
crontab -e
Add the following line to trigger the main Python runtime daily at midnight:

Plaintext
0 0 * * * /var/www/fitlib/venv/bin/python /var/www/fitlib/build_and_enrich.py >> /var/www/fitlib/cron_enrich.log 2>&1
3. Reverse Proxy Configuration (Nginx)
Configure Nginx to serve the compiled static frontend files and proxy API traffic safely down to your Node process:

Nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend Target
    location / {
        root /var/www/fitlib/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Backend API Target
    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
🛠️ Technology Stack
Frontend: React, TypeScript, Vite, Tailwind CSS

Backend: Node.js, Express/Fastify (TypeScript)

Data Pipelines: Python 3 (Regex processing, JSON Schema architecture)

Data Hosting Integration: Git LFS

To-Do:
Fix issues with there being 2 copys of a single game
Learn to code
Make a VN section (prob soon after main site drops)
Add watchable media, like anime, movies, and shows
Add music

📄 License
This project is proprietary and maintained under the personal archives of @zzakuro.
