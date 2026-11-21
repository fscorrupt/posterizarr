# Choose an Installation Method

Posterizarr can run as a Docker container, from the Unraid Community Apps
catalog, or directly from PowerShell on Windows or Linux. The standard Docker
and Unraid installations already include the Web UI; you do not need to install
the UI from source separately.

## Recommended for most users: Docker

### Install With Docker Compose {#docker-compose}

Install Docker Engine and the Compose plugin, or Docker Desktop on Windows/macOS.
Confirm that `docker compose version` works before continuing. You do not need
PowerShell, ImageMagick, Python, or a separate Web UI installation on the host.

1. Create a dedicated folder and its persistent directories.

		Linux, macOS, or an SSH shell on your NAS:

		```sh
		mkdir -p posterizarr
		cd posterizarr
		mkdir -p config assets assetsbackup manualassets
		```

		Windows PowerShell with Docker Desktop:

		```powershell
		New-Item -ItemType Directory -Force posterizarr
		Set-Location posterizarr
		New-Item -ItemType Directory -Force config, assets, assetsbackup, manualassets
		```

2. Create `compose.yaml` in that folder with this content:

		```yaml
		services:
			posterizarr:
				image: ghcr.io/fscorrupt/posterizarr:latest
				container_name: posterizarr
				restart: unless-stopped
				user: "1000:1000"
				environment:
					TZ: Europe/Berlin
					RUN_TIME: disabled
				ports:
					- "8000:8000"
				volumes:
					- ./config:/config
					- ./assets:/assets
					- ./assetsbackup:/assetsbackup
					- ./manualassets:/manualassets
		```

		Change `TZ` to your time zone. On Linux/NAS, set `user` to the UID/GID that
		owns these folders (`id -u` and `id -g`) and ensure that account can write
		to them. Replace the left-hand volume paths if you want to use existing
		asset folders. The container-side paths stay `/config`, `/assets`,
		`/assetsbackup`, and `/manualassets`.

		If host port 8000 is occupied, use `"8003:8000"`, for example. This changes
		the browser port to 8003; the internal container port remains 8000.

3. From the folder containing `compose.yaml`, start Posterizarr:

		```sh
		docker compose pull
		docker compose up -d
		docker compose ps
		```

4. Open **http://localhost:8000** on the Docker host, or
	 **http://YOUR_SERVER_IP:8000** from another device. Use your chosen host
	 port if you changed it. Give the first startup time to finish; inspect it with:

		```sh
		docker compose logs -f --tail=100 posterizarr
		```

		Press Ctrl+C to leave the logs; the container keeps running.

5. Continue with [first-time Web UI setup](getting_started.md). Configure your
	 media server and providers in the UI, then test artwork before enabling
	 library-wide uploads. Leave `RUN_TIME: disabled` when using the UI Scheduler.

### Update or Stop Docker

Update from the same Compose folder:

```sh
docker compose pull
docker compose up -d
```

Stop the container with `docker compose down`. The bind-mounted configuration
and artwork folders remain on the host. Back up these folders before major
upgrades; do not delete them when replacing a container.

The [repository Compose example](https://github.com/fscorrupt/posterizarr/blob/main/docker-compose.yml)
also uses an external `proxy` network. That is optional and is deliberately
omitted above. If you use that example unchanged, create the network first with
`docker network create proxy`, or replace its network configuration. See
[Docker settings and advanced examples](platformandtools.md#docker) for reference.

## Unraid

Install Posterizarr from the Community Apps catalog, then review the
[Unraid-specific settings](platformandtools.md#unraid), especially the asset path
and schedule.

## Windows or Linux without Docker

Follow the [manual PowerShell walkthrough](walkthrough.md). This path requires
more setup and is intended for users comfortable running scripts and configuring
`config.json`.

## Running the Web UI from source

The [source UI installation guide](uiinstallation.md) is for development or a
manual Web UI setup. It is not required for Docker or Unraid.

## What to do next

Continue with the [first-time setup guide](getting_started.md) for credentials,
the initial Web UI setup, a safe test, and your first run. Review the
[requirements](requirements.md) before choosing an installation method.
