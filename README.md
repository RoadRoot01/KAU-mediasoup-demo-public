# KAU mediasoup demo

A custom fork based on [versatica/mediasoup-demo](https://github.com/versatica/mediasoup-demo). Upstream documentation and authorship are retained below. This fork adds KAU-oriented local network configuration and optional network-throttle controls.

## Security and intended use

This project is intended for development, LAN testing, and controlled experiments. It is not a production-ready public Internet service. Do not expose it directly to the public Internet without a separate security review and appropriate deployment hardening. Do not commit `.env` files, TLS certificates, credentials, or experiment output.

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

The app defaults to room `test`. Common options include `?roomId=my-room`, `?forceVP8=true`, `?forceH264=true`, and `?info=true`. `?consumerReplicas=N` sets the room-wide duplicate consumer count when a room is first created. The server accepts an integer from `0` to `10`, producing at most 11 consumers per producer; use it for controlled load simulations. For local throttle control, pass the configured secret as a URL fragment such as `#throttleSecret=<value>`; the app reads and removes it before loading room data, and invitation links omit it. Never pass the secret as a query parameter because servers may log query strings.

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

## Upstream attribution and license

This repository is based on [versatica/mediasoup-demo](https://github.com/versatica/mediasoup-demo). The upstream project authors are:

- Iñaki Baz Castillo ([website](https://inakibaz.me), [GitHub](https://github.com/ibc/))
- José Luis Millán Villegas ([GitHub](https://github.com/jmillan/))

The root project license is [ISC](./LICENSE). Some subprojects retain their upstream package license metadata; review those notices and dependency licenses before any public release.
