# Telemetry & Privacy

<div class="pz-telemetry-hero">
  <p class="pz-kicker">OPTIONAL · AGGREGATED · OPT-OUT</p>
  <h2>Small signals, no media details.</h2>
  <p>Telemetry helps guide development across operating systems and media servers. It is not required for Posterizarr to work, and you can turn it off at any time.</p>
</div>

## What Posterizarr sends

When telemetry is enabled, Posterizarr sends a small JSON request containing:

| Field | Example | Why it is used |
|---|---|---|
| Installation ID | Random UUID | Counts one installation once and updates its latest record. Stored locally in `Cache/telemetry.cache.json`. |
| App version | `4.0.0` | Shows which versions are in use. |
| Operating system | `Windows`, `Linux`, `macOS`, or `Docker` | Identifies the operating system or container runtime. |
| Linux distribution | `debian`, `ubuntu`, or `NotApplicable` | Helps prioritize Linux distribution support. In a container, this is the container image distribution. |
| Architecture | `x64`, `arm64`, or another runtime architecture label | Helps identify CPU architecture support, including ARM devices. |
| Media-server target | `Plex`, `Jellyfin`, `Emby`, or `Silo` | Shows which integration is enabled. If none is configured, the value is `NotConfigured`. |

The Worker derives a two-letter country code from Cloudflare request metadata;
the client does not send a country, IP address, or location. For each random
installation ID, Cloudflare KV stores the latest version, OS, Linux
distribution, architecture, target, country code, and a `lastSeen` timestamp.
Repeated pings update that same record rather than adding another installation.

The installation ID is pseudonymous, not a credential: it does not encode your
identity, but it does let the Worker recognize the same installation between
updates.

## What is not stored by the Worker

- IP addresses, filenames, library names, titles, artwork, or playback history.
- Media-server URLs, hostnames, tokens, API keys, or notification settings.
- User accounts or personal profiles.

Cloudflare processes the network request and provides the country code to the
Worker. The Worker stores the country code, not the raw IP address.

## When it runs

Telemetry is enabled by default. Posterizarr sends a ping when its version
changes or when the locally cached OS, Linux distribution, architecture, or
server target changes.
It does not send a ping for each artwork item or every scheduled run. Failed
requests are ignored and do not stop artwork generation.

## Turn telemetry off

In the Web UI, open **Configuration > System > System Settings**, turn off
**Telemetry**, and save. If editing `config.json` directly, set:

```json
{
  "PrerequisitePart": {
    "telemetry": "false"
  }
}
```

Disabling telemetry stops future pings. It does not automatically delete the
installation's existing aggregate record from the Worker KV store.

## Private analytics dashboard

The Worker dashboard aggregates unique installations by version, operating
system, platform profile, media server, and country. Configure a non-empty
`DASHBOARD_PASSWORD` Worker secret before exposing the dashboard. The password
is supplied as a `?pass=` query parameter, so do not share or bookmark a URL
containing it. Deployment and KV setup are documented in the
[telemetry Worker README](https://github.com/fscorrupt/posterizarr/blob/main/telemetry-worker/README.md).