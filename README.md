# KAU mediasoup demo

This project is a customized fork of [versatica/mediasoup-demo](https://github.com/versatica/mediasoup-demo) for controlled LAN WebRTC load testing, telemetry collection, SFU host monitoring, and multi-peer performance analysis. It preserves upstream documentation and attribution and adds:

- Browser-side WebRTC client stats collection and JSON export.
- SFU and host metrics collection, including CPU, memory, Chrome, GPU, temperature, and battery metrics written to CSV.
- WebRTC telemetry and SFU system dashboards for analyzing exported stats and metrics.
- Automatic LAN address detection and separate `listenIp` / `announcedAddress` configuration.
- Automatic local TLS certificate generation with mkcert support and LAN/private-network origin handling.
- LAN-oriented test configuration, optional network-throttle controls, and `npm run start:prod` for the app.
- Experiment-oriented preferred consumer layer defaults and controls for simulcast testing.

The upstream `setConsumerPreferredLayers` mechanism is retained; the experiment-specific defaults and controls are the KAU customization.

## Security and intended use

This project is intended for controlled LAN testing and experiments. It is not hardened as an Internet-facing production conferencing service. The demo signaling model inherits mediasoup-demo peer-identity and reconnection semantics, including replacement of an existing connection that uses the same `peerId`, and it does not provide application-level authentication. Public Internet deployment requires separate authentication and authorization, rate limiting, a reverse proxy, network access controls, and a security review. Do not commit `.env` files, TLS certificates, credentials, or experiment output.

## Requirements

- Node.js 22 or later and npm
- Python 3 and C++ build tools required by mediasoup (Visual Studio C++ build tools on Windows, Xcode Command Line Tools on macOS, or `build-essential` on Linux)
- [mkcert](https://github.com/FiloSottile/mkcert) to create locally trusted development certificates

Install mkcert's local development CA once:

```sh
mkcert -install
```

The server creates `server/certs/cert.pem`, `server/certs/key.pem`, and `server/certs/.ip` on first start. These are local-only files and are ignored by Git. If you already have TLS files, set both `TLS_CERT` and `TLS_KEY` in the environment or in a local `server/.env`; relative paths are resolved from `server/`. The two variables must be provided together.

## Start from a fresh clone

### 1. Configure the server

Optionally copy the example environment file and edit local settings:

```sh
cd server
cp .env.example .env
npm ci
npm start
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp` if needed. The default configuration detects the machine's local IPv4 address. If neither external TLS files nor generated certificates are available, startup stops with an installation hint.

### 2. Build and start the app

In a second terminal, from the repository root:

```sh
cd app
npm ci --legacy-peer-deps
npm run start:prod
```

The production bundle is served over HTTPS on port `5555`. For Vite development mode with hot reload, run `npm start` from `app/` instead.

## LAN access and ports

On another device connected to the same LAN, open `https://<YOUR_LOCAL_IP>:5555/`. The development CA installed by `mkcert -install` should make the generated certificate trusted on the machine where it is installed; each client device may need its own trust setup.

Allow these ports on the local firewall as needed:

- TCP `5555`: Vite app / production preview
- TCP `4443`: HTTPS API and signaling
- UDP and TCP `44444`: WebRTC media transports
- UDP and TCP `40000-40999`: optional plain RTP/RTCP transports used by broadcasters

The app defaults to room `test`. Common options include `?roomId=my-room`, `?forceVP8=true`, `?forceH264=true`, and `?info=true`. `?consumerReplicas=N` sets the room-wide duplicate consumer count when a room is first created. The server accepts an integer from `0` to `10`; each receiving participant can therefore consume up to 11 copies of each producer. Use it for controlled load simulations. For local throttle control, pass the configured secret as a URL fragment such as `#throttleSecret=<value>`; the app reads and removes it before loading room data, and invitation links omit it. Never pass the secret as a query parameter because servers may log query strings.

### Run the broadcaster with local HTTPS

The broadcaster example connects to `https://localhost:4443` and is intended to run on the same computer as the server. Node.js must trust the local mkcert CA. Start the broadcaster with `NODE_EXTRA_CA_CERTS` pointing to mkcert's `rootCA.pem`:

```sh
export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
```

On PowerShell:

```powershell
$env:NODE_EXTRA_CA_CERTS = Join-Path (mkcert -CAROOT) 'rootCA.pem'
```

Set this before starting the Node.js broadcaster process. The broadcaster verifies the server certificate and hostname; do not disable TLS verification.

To run the broadcaster from another LAN device, set its `baseUrl` in `broadcaster/src/index.ts` to the server's LAN IP or a local hostname. The name in that URL must be covered by the server certificate and match the server's `DOMAIN` setting. For a custom hostname, set `DOMAIN=<YOUR_HOSTNAME>` in `server/.env`, map that hostname to the server's LAN IP with DNS or a hosts file on each client device, and open the app using `https://<YOUR_HOSTNAME>:5555/`. Restart the server after changing `DOMAIN`; it regenerates its ignored local certificate with the new name. Set the same hostname in the broadcaster URL.

## Configuration

`server/config.mjs` contains demo defaults and detects a local IPv4 address. Copy `server/.env.example` to `server/.env` to adjust environment-based settings. The optional `NETWORK_THROTTLE_SECRET` is unset by default, so network-throttle controls remain unavailable until an operator configures a strong random secret locally. Never commit the configured value.

## Telemetry dashboards

The dashboard source is kept under `tools/`. Runtime logs and generated metrics stay under the ignored `server/logs/` directory and are not part of the repository.

### WebRTC telemetry workflow

1. Run the demo and join a room.
2. Select **WebRTC Stats Download** in the room to save the collected JSON history.
3. Open `tools/webrtc-stats-dashboard/index.html` in a browser.
4. Load the downloaded JSON file. The dashboard analyzes outbound and inbound RTP, SSRC streams, local/remote/SFU probator roles, codec and simulcast layers, bitrate, FPS, jitter, packet loss, resolution, and timelines. Its built-in preview uses generated synthetic data.

### SFU system telemetry workflow

1. Start the server; `KAU_CUSTOM_MetricsCollector` writes periodic host and SFU measurements to a CSV in `server/logs/`.
2. Open `tools/sfu-system-dashboard/index.html` in a browser.
3. Load the generated CSV file. The dashboard analyzes SFU, system, and Chrome CPU and memory, GPU, temperature, and battery metrics. Its built-in preview uses generated synthetic data.

## Upstream attribution and license

This repository is based on [versatica/mediasoup-demo](https://github.com/versatica/mediasoup-demo). The upstream project authors are:

- Iñaki Baz Castillo ([website](https://inakibaz.me), [GitHub](https://github.com/ibc/))
- José Luis Millán Villegas ([GitHub](https://github.com/jmillan/))

The root project license is [ISC](./LICENSE), and upstream copyright and attribution are preserved. At the upstream baseline used for comparison, both `app/package.json` and `broadcaster/package.json` already specify `"license": "All Rights Reserved"`; these package metadata values are inherited from upstream. Review component and dependency notices before any public release.
