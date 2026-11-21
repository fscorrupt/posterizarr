# Manual PowerShell Walkthrough

This detailed guide covers script-first installation and command-line workflows
on Windows and Linux. For Docker, use the complete
[Docker Compose installation](installation.md#docker-compose); for Unraid, use
the [Community Apps installation](installation.md#unraid). Then follow the
[first-time setup guide](getting_started.md). Installing the Web UI from source
is a separate path; see [Run the Web UI from source](uiinstallation.md).

## Getting Started

!!! tip
    If you are an unRAID user, just use the Community app from [@nwithan8](https://github.com/nwithan8) it is listed in Store.

!!! warning "Unraid"
    Unraid has an unusual auto-folder behavior where, unless a subpath is specified, it defaults to using the app name (title-cased) as the folder name. Please change the uppercase "P" in /config under the Posterizarr path section to a lowercase "p" `/mnt/user/appdata/posterizarr`.


### Requirements
- Make sure to obtain all the api keys and tokens as you will need them later on for the `config.json`.
    - **TMDB API Read Access Token:** [Obtain TMDB API Token](https://www.themoviedb.org/settings/api) (Free)
        - **NOTE** the **TMDB API Read Access Token** is the really, really long one
    - **Fanart Personal API Key:** [Obtain Fanart API Key](https://fanart.tv/get-an-api-key) (Free)
    - **TVDB Project API Key:** [Obtain TVDB API Key](https://thetvdb.com/api-information/signup) (Free)
        - **Do not** use `"Legacy API Key"`, it only works with a Project Api Key. *(The key is free for personal use. If configured, Posterizarr can utilize data provided by TheTVDB. If you would like to support their work, please consider paying for a subscription!)*
    - **Plex Token:** [Optain Plex Token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)

### Docker/ARM
- For Docker, follow the [complete Docker Compose installation](installation.md#docker-compose), including `docker compose up -d` and the Web UI address.

- For Linux/ARM please start here: [ARM](#arm-prerequisites)

### Manual install (Windows/Linux)
1. Please install Powershell (Not needed on docker/unraid)
    - [Linux](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-linux?view=powershell-7.4)
    - [macOS](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-macos?view=powershell-7.4)
    - [Windows](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows?view=powershell-7.4)
1. After that you need to install the Fanart Api Wrapper (On Windows as Administrator).
   ```powershell
    pwsh Install-Module -Name Celerium.FanartTV -Scope AllUsers -Force -AllowClobber
   ```
    Linux:
     - It should be visible here `/usr/local/share/powershell/Modules`

    Windows:
     - It should be visible here `C:\Program Files\PowerShell\Modules`

     you can check locations with this command:
    ```powershell
    pwsh $env:PSModulePath -split ":"
    ```

    **Check If the Profile Exists**

    Run:
    ```powershell
    pwsh $PROFILE.AllUsersAllHosts
    ```
    By default, this should point to:

    - Linux: `/etc/powershell/profile.ps1`
    - Windows: `C:\Program Files\PowerShell\7\profile.ps1`

    If the file doesn’t exist, create it:

    Linux:
    ```bash
    sudo mkdir -p /etc/powershell
    sudo touch /etc/powershell/profile.ps1
    ```

    Windows:
    ```powershell
    New-Item -Path $PROFILE.AllUsersAllHosts -ItemType File -Force
    ```

    **Add the Import Statement**

    Edit the file:

    Linux:
    ```bash
    sudo nano /etc/powershell/profile.ps1
    ```

    Windows:
    ```powershell
    notepad $PROFILE.AllUsersAllHosts
    ```
    Add the following line:

    ```powershell
    Import-Module Celerium.FanartTV -Force
    ```

    Save and exit, then it should be loaded and imported everytime you open a pwsh window.
1. If you are on Windows/Linux next step is to clone the repo.
    - switch into the directory on your server where you want the project to land. (Make sure you have git installed)

    Linux:

    ```bash
    cd /opt/appdata
    ```

    Windows:

    ```bash
    cd C:\Github
    ```
        - [Git for Windows](https://git-scm.com/download/win)
        - [Git for Linux](https://git-scm.com/download/linux)
    - Clone the Repo:
        ```bash
        git clone https://github.com/fscorrupt/posterizarr.git
        ```
    - After that you can switch into the cloned Repo/Folder
        ```bash
        cd Posterizarr
        ```
1. Rename the `config.example.json` to `config.json` and adjust the settings.

    - Enter your API keys and tokens under `ApiPart` ([Detailed Config Description](configuration.md)):
        - tmdbtoken (Recommended; free & instant to generate)
        - tvdbapi (Optional if using TMDb; Project Key or Subscriber PIN `Key#PIN`)
        - FanartTvAPIKey (Optional supplementary provider)
        - PlexToken

    - If you are happy with the default values, you should still ensure that the AssetPath value is set properly.
        - On Linux, like this: `/PathToAsset/Dir`
        - On Windows, like this: `C:\\PathToAsset\\Dir`
            - **Important** - you have to use double `\\` in Json.

    **Manual install of Web UI (Windows/Linux)**

    If you want to use the UI please have a look at this part of the [Readme.](uiinstallation.md) (default url http://localhost:8000)

1. Please start the Script **(On first run, ensure its run as Administrator/Sudo, because it has to install a Powershell Module)**
    - Linux:
    ```bash
    cd /opt/appdata/Posterizarr
    sudo pwsh Posterizarr.ps1
    ```
    - Windows:

    Open the Start menu, type pwsh, select PowerShell 7x, and then select Run as administrator
    ```bash
    cd C:\Github\Posterizarr
    pwsh .\Posterizarr.ps1
    ```
1. After that it is recommended to run the script in `-Testing` Mode.

    *In this Mode, the script will create sample posters according to the config settings so you can see how it would look before you mass run it against your libraries. These samples will be created in the `test` directory*

    *You can find examples and more information here:*

    *[Info about Testing mode](modes.md#testing-mode)*

    *[Example Images](showcase.md#images-from-testing-mode)*

    - Linux (or via Web UI):
        ```bash
        cd /opt/appdata/Posterizarr
        pwsh Posterizarr.ps1 -Testing
        ```
    - Windows (or via Web UI):
        ```bash
        cd C:\Github\Posterizarr
        pwsh .\Posterizarr.ps1 -Testing
        ```
5. You can now fine tune all the `width, height, color` of `borders, text boxes and text` in config.json (or via Web UI)
    - After each change of a setting just rerun the script in `-Testing` mode so you can see how it looks.
6. The final step is to set a schedule and let the script run.
    - You can also trigger the poster creation on-demand, like this (or via Web UI):
        - Linux:
            ```bash
            cd /opt/appdata/Posterizarr
            pwsh Posterizarr.ps1
            ```
        - Windows:
            ```bash
            cd C:\Github\Posterizarr
            pwsh .\Posterizarr.ps1
            ```
    - Configure Scheduled runs:

        Linux:
        - Cron example:

        ```bash
        sudo crontab -e
        ```
        add a new line like this (every 2 hours):

        ```bash
        0 */2 * * * docker exec posterizarr pwsh /app/Posterizarr.ps1 >/dev/null 2>&1
        ```

        Windows:
        - You can create a schedule task -    [How-To](https://www.sharepointdiary.com/2013/03/create-scheduled-task-for-powershell-script.html)

!!! note
    Have a look at the [Assets Tip](namingconvention.md)

## Docker
1. Adjust the [docker-compose.yml](https://github.com/fscorrupt/posterizarr/raw/main/docker-compose.yml) to fit your environment.
    - Required environment variables and descriptions can be found [here](platformandtools.md#docker)

        Docker-Compose example on Linux:
        ```yaml
        ---
        services:
        posterizarr:
            hostname: "posterizarr"
            container_name: "posterizarr"
            environment:
                - "TZ=Europe/Berlin"
                - "TERM=xterm"
                - "RUN_TIME=disabled"
            image: "ghcr.io/fscorrupt/posterizarr:latest"
            restart: "unless-stopped"
            user: "1000:1000"
            ports:
                - "8000:8000"
            networks:
                - "proxy"
            volumes:
                - "/opt/appdata/posterizarr:/config:rw"
                - "/opt/appdata/posterizarr/assets:/assets:rw"
                - "/opt/appdata/posterizarr/assetsbackup:/assetsbackup:rw"
                - "/opt/appdata/posterizarr/manualassets:/manualassets:rw"
        networks:
        proxy:
            driver: bridge
            external: true
        ```

        Docker-Compose example on Windows:
        ```yaml
        ---
        version: "3"
        services:
          posterizarr:
            hostname: "posterizarr"
            container_name: "posterizarr"
            environment:
                - "TZ=Europe/Berlin"
                - "TERM=xterm"
                - "RUN_TIME=disabled"
            image: "ghcr.io/fscorrupt/posterizarr:latest"
            restart: "unless-stopped"
            ports:
                - "8000:8000"
            volumes:
                - "C:/Docker/Posterizarr:/config:rw"
                - "C:/Docker/Posterizarr/assets:/assets:rw"
                - "C:/Docker/Posterizarr/assetsbackup:/assetsbackup:rw"
                - "C:/Docker/Posterizarr/manualassets:/manualassets:rw"
        ```
2. Switch to the Directory where you want to build/start the container and place the `docker-compose.yml` there.

    ### 🎥 How-To Video:

    ![docker](images/docker-compose.gif)

    - Linux:
        ```bash
        cd /opt/appdata
        mkdir Posterizarr # chown the dir with correct puid/pgid
        cd Posterizarr
        docker compose up -d
        ```
    - Windows:
        ```bash
        cd C:\Github
        mkdir Posterizarr
        cd Posterizarr
        docker compose up -d
        ```
    - Now it should download everything and start up your container.
4. On first run the container will download the required files and also create the folder structure for you.
5. Adjust the settings of your `config.json` either in file or via Web UI http://localhost:8000.
    - Enter your API keys and tokens under `ApiPart` ([Detailed Config Description](configuration.md)):
        - tmdbtoken (Recommended; free & instant to generate)
        - tvdbapi (Optional if using TMDb; Project Key or Subscriber PIN `Key#PIN`)
        - FanartTvAPIKey (Optional supplementary provider)
        - PlexToken
    - If you are happy with the default values, you should still ensure that the AssetPath value is set properly.
        - On Linux, like this: `/PathToAsset/Dir`
        - On Docker you have to use the binded volume path from your `docker-compose.yml` it has to match `/assets`.
            - In the case from above, do not use `C:/Docker/Posterizarr/assets` or `/opt/appdata/posterizarr/assets` as asset path, you have to use `/assets` as path.
        - On Windows, like this: `C:\\PathToAsset\\Dir`
            - **Important** - you have to use double `\\` in json.
1. After that it is recommended to run the script in `-Testing` Mode either in cli or via Web UI http://localhost:8000.

!!! tip
    *In this Mode, the script will create sample posters according to the config settings so you can see how it would look before you mass run it against your libraries. These samples will be created in the `test` directory*

    *You can find examples and more information here:*

    *[Info about Testing mode](modes.md#testing-mode)*

    *[Example Images](showcase.md#images-from-testing-mode)*

In this example `posterizarr` is the container name

```bash
docker exec -it posterizarr pwsh /app/Posterizarr.ps1 -Testing
```

6. You can now fine tune all the `width, height, color` of `borders, text boxes and text` in config.json
    - After each change of a setting just rerun the script in `-Testing` mode so you can see how it looks.
7. The final step is to set a schedule and let the script run either via compose and `RUN_TIME` env or via Web UI.
    - You can also trigger the poster creation on-demand, like this:

        ```bash
        docker exec -it posterizarr pwsh /app/Posterizarr.ps1
        ```

## ARM Prerequisites
1. Install Powershell (make an sh file and run it) - [Official Link](https://learn.microsoft.com/en-us/powershell/scripting/install/community-support?view=powershell-7.4#raspberry-pi-os):
    ```bash
    # Prerequisites
    # Update package lists
    sudo apt-get update

    # Install dependencies
    sudo apt-get install jq libssl1.1 libunwind8 -y

    # Download and extract PowerShell
    # Grab the latest tar.gz
    bits=$(getconf LONG_BIT)
    release=$(curl -sL https://api.github.com/repos/PowerShell/PowerShell/releases/latest)
    package=$(echo $release | jq -r ".assets[].browser_download_url" | grep "linux-arm${bits}.tar.gz")
    wget $package

    # Make folder to put powershell
    mkdir ~/powershell

    # Unpack the tar.gz file
    tar -xvf "./${package##*/}" -C ~/powershell

    # Make Powershell executable PowerShell
    sudo chmod +x ~/powershell/pwsh

    # Create Symlink
    sudo ~/powershell/pwsh -command 'New-Item -ItemType SymbolicLink -Path "/usr/bin/pwsh" -Target "$PSHOME/pwsh" -Force'
    ```
1. Install ImageMagick 7:
    ```bash
    # Prerequisites
    sudo apt update
    sudo apt install build-essential
    apt install libjpeg-dev
    apt install libpng-dev
    apt install libfreetype-dev

    # Download/extract
    wget https://imagemagick.org/archive/ImageMagick.tar.gz
    tar xvzf ImageMagick.tar.gz
    cd ImageMagick-7.1.1-34 # Version can differ

    # Compilation and Installation
    ./configure
    make
    sudo make install
    sudo ldconfig /usr/local/lib

    # Check if it is working
    magick -version
    ```
1. Now you can Contuine on Step 5 here: [Getting Started](walkthrough.md#getting-started)
!!! note
    Have a look at the [Assets Tip](namingconvention.md)
