# First-time setup

This guide is for someone opening Posterizarr for the first time. Follow it in
order; you do not need to understand every setting before getting started.

## 1. Choose how to install

- **Docker:** the recommended route for most home servers. Start with
  [Choose an installation method](installation.md#recommended-for-most-users-docker).
- **Unraid:** install the Community Apps version, then check the
  [Unraid notes](platformandtools.md#unraid).
- **Windows or Linux without Docker:** use the
  [manual PowerShell walkthrough](walkthrough.md).

The separate [Web UI from source guide](uiinstallation.md) is for development or
manual UI setups, not the normal Docker or Unraid installation.

## 2. Gather only what you plan to use

Have your media-server address and API credentials ready. Add artwork-provider
credentials for the providers you want to search. Start with the
[requirements checklist](requirements.md); optional services can be configured
later.

Keep API keys private. Do not paste them into screenshots, support posts, or
public configuration files.

## 3. Start Posterizarr and open the Web UI

After installation, open the Web UI from the same machine or network as the
server. Docker's default published port is `8000`, so the local address is
usually `http://localhost:8000`; replace `localhost` with the server address
when opening it from another device. If it is not reachable, see
[Networking](networking.md).

If the first-run setup appears, use it to connect your media server and choose
the libraries Posterizarr should manage. Otherwise, open the configuration area
in the Web UI and check the same items there. Do not enable every library just
to get through setup; begin with one test library.

## 4. Check what Posterizarr will create

There are two different test workflows, both available in the Web UI:

- **Artwork styling:** open **Run Modes > Testing Mode**. It creates sample
  images using your current settings and opens the results in **Test Gallery**.
  It does not upload artwork to a live media server. See
  [Testing Mode](modes.md#test-mode).
- **Dynamic Overlays:** open **Builders > Dynamic Overlays**, use its Setup
  Wizard, select one library, and keep **Dry Run** enabled while checking rules
  and previews. Dynamic Overlay Dry Run renders changes but does not upload
  artwork. See the [Dynamic Overlays guide](dynamic_overlays.md).

These are separate checks: Testing Mode checks generated artwork styling, while
Dynamic Overlays Dry Run checks overlay rules and placement.

## 5. Run a small first job

Start with one library or a targeted item. Before a normal run, review whether
direct upload is enabled for your media server and where generated assets will
be stored. The [configuration reference](configuration.md) explains those
settings. If you use Dynamic Overlays, keep Dry Run enabled until the preview,
library scope, and logs look right.

## 6. Automate only after checking the result

Once the artwork looks right and the destination is correct, configure a
schedule or an integration such as Sonarr, Radarr, or Tautulli. See
[Run modes and automation](modes.md). You can return to
[Posterizarr's main features](capabilities.md), browse the
[artwork showcase](showcase.md), or open the guide for a specific task from
**Use Posterizarr** in the navigation.