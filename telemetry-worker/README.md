# Posterizarr Telemetry Cloudflare Worker

This directory contains the Cloudflare Worker script that can be used to securely receive and process the anonymous telemetry pings from Posterizarr instances.

This worker receives the `POST` request, parses the JSON payload containing the anonymous `InstanceId` and environmental stats, and can store the data using Cloudflare KV.

## Features
- Overwrites entries based on the `InstanceId` (GUID), naturally counting unique installations and deduplicating data.
- Never stores PII, IP addresses, or file paths.
- Returns a `200 OK` response to ensure Posterizarr scripts don't experience errors.

## Prerequisites
- A free [Cloudflare](https://dash.cloudflare.com/) account.
- The Cloudflare `wrangler` CLI (or you can use the Cloudflare Web Dashboard directly).

---

## Setup Instructions (Web Dashboard)

If you do not want to use the CLI, you can set this up entirely from your browser:

1. **Create a KV Namespace (Optional but recommended for tracking instances):**
   - In the Cloudflare Dashboard, go to **Workers & Pages** -> **KV**.
   - Click **Create a namespace**, name it something like `POSTERIZARR_TELEMETRY`.

2. **Create the Worker:**
   - Go to **Workers & Pages** -> **Overview**.
   - Click **Create application** -> **Create Worker**.
   - Name your worker (e.g., `posterizarr-telemetry`) and click **Deploy**.

3. **Add the Code:**
   - Click **Edit Code** on your newly created worker.
   - Copy the entire contents of `worker.js` and paste it into the editor, replacing the default code.
   - Click **Save and Deploy**.

4. **Bind the KV Namespace:**
   - Go back to your worker's **Settings** tab.
   - Navigate to **Variables** -> **KV Namespace Bindings**.
   - Click **Add binding**.
   - Variable name: `TELEMETRY_KV`.
   - KV namespace: Select the `POSTERIZARR_TELEMETRY` namespace you created in step 1.
   - Click **Deploy**.

5. **Protect the dashboard:**
    - In the Worker's **Settings** tab, open **Variables** -> **Secrets**.
    - Add a non-empty secret named `DASHBOARD_PASSWORD` and deploy the change.
    - Dashboard requests are disabled until this secret is set. Open the Worker URL
       with `?pass=YOUR_PASSWORD` to view the dashboard. Avoid sharing or bookmarking
       the password-bearing URL.

6. **Configure the telemetry endpoint:**
    - Posterizarr currently posts telemetry to
       `https://telemetry.posterizarr-stats.workers.dev/` from
       `modules/functions/Notifications.ps1`.
    - If you deploy your own Worker, change that endpoint in your Posterizarr fork
       to the deployed Worker URL. Do not put the dashboard password in this URL.

---

## Setup Instructions (Wrangler CLI)

If you prefer using the command line:

1. Install wrangler: `npm install -g wrangler`
2. Login to Cloudflare: `wrangler login`
3. Create a KV namespace: `wrangler kv:namespace create "TELEMETRY_KV"`
4. Create a `wrangler.toml` file in this directory with the following contents (replace the `id` with the ID outputted by the command above):
   ```toml
   name = "posterizarr-telemetry"
   main = "worker.js"
   compatibility_date = "2024-03-01"

   [[kv_namespaces]]
   binding = "TELEMETRY_KV"
   id = "YOUR_KV_NAMESPACE_ID"
   ```
5. Add a non-empty `DASHBOARD_PASSWORD` secret: `wrangler secret put DASHBOARD_PASSWORD`.
6. Deploy: `wrangler deploy`
7. If using this Worker with your own Posterizarr fork, update the POST endpoint
   in `modules/functions/Notifications.ps1` to the deployed Worker URL.
