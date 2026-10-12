/**
 * IMPORTANT (PLEASE READ THIS):
 *
 * This is not the "configuration file" of mediasoup. This is the configuration
 * file of the mediasoup-demo server. mediasoup is a server-side library, it
 * does not read any "configuration file". Instead it exposes an API. This demo
 * application just reads settings from this file (once copied to config.mjs)
 * and calls the mediasoup API with those settings when appropriate.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as url from 'node:url';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, '.env');

if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
	try {
		process.loadEnvFile(envFile);
	} catch {
		// Ignore .env read error
	}
}

/**
 * Automatically find the local IPv4 address (e.g. 192.168.x.x)
 */
export function getLocalIp() {
	const ifaces = os.networkInterfaces();
	const candidates = [];

	for (const [name, addresses] of Object.entries(ifaces)) {
		for (const iface of addresses ?? []) {
			if (iface.internal || iface.family !== 'IPv4') {
				continue;
			}

			candidates.push({
				name,
				address: iface.address,
			});
		}
	}

	// 가장 흔한 가정/소규모 LAN을 최우선.
	const preferred = candidates.find(
		({ address }) =>
			address.startsWith('192.168.0.') || address.startsWith('192.168.1.')
	);

	if (preferred) {
		return preferred.address;
	}

	// 그 밖의 사설망.
	const privateAddress = candidates.find(
		({ address }) =>
			address.startsWith('10.') ||
			/^172\.(1[6-9]|2\d|3[0-1])\./.test(address) ||
			address.startsWith('192.168.')
	);

	if (privateAddress) {
		return privateAddress.address;
	}

	return candidates[0]?.address ?? '127.0.0.1';
}

export const localIp = getLocalIp();

const listenIp = process.env['MEDIASOUP_LISTEN_IP'] ?? '0.0.0.0';
const announcedAddress = process.env['MEDIASOUP_ANNOUNCED_ADDRESS'] ?? localIp;
const domain = process.env['DOMAIN'] ?? localIp;

/**
 * Ensure TLS certificates include the current local IP and DOMAIN.
 * Explicit TLS_CERT/TLS_KEY values take precedence over local mkcert files.
 */
function ensureCerts() {
	const configuredCert = process.env['TLS_CERT'];
	const configuredKey = process.env['TLS_KEY'];

	if (Boolean(configuredCert) !== Boolean(configuredKey)) {
		throw new Error('Set both TLS_CERT and TLS_KEY, or leave both unset.');
	}

	if (configuredCert && configuredKey) {
		const cert = path.isAbsolute(configuredCert)
			? configuredCert
			: path.resolve(__dirname, configuredCert);
		const key = path.isAbsolute(configuredKey)
			? configuredKey
			: path.resolve(__dirname, configuredKey);

		if (!fs.existsSync(cert) || !fs.existsSync(key)) {
			throw new Error('TLS_CERT and TLS_KEY must point to existing files.');
		}

		return { cert, key };
	}

	const certsDir = path.join(__dirname, 'certs');
	const certFile = path.join(certsDir, 'cert.pem');
	const keyFile = path.join(certsDir, 'key.pem');
	const ipFile = path.join(certsDir, '.ip');
	const certIdentity = `${localIp}\n${domain}`;

	fs.mkdirSync(certsDir, { recursive: true });

	let needsGen = !fs.existsSync(certFile) || !fs.existsSync(keyFile);

	if (!needsGen && fs.existsSync(ipFile)) {
		const recordedIdentity = fs.readFileSync(ipFile, 'utf8').trim();

		if (recordedIdentity !== certIdentity) {
			needsGen = true;
		}
	} else if (!needsGen) {
		needsGen = true;
	}

	if (needsGen) {
		try {
			execFileSync(
				'mkcert',
				[
					'-key-file',
					keyFile,
					'-cert-file',
					certFile,
					'localhost',
					'127.0.0.1',
					'::1',
					...new Set([localIp, domain]),
				],
				{ stdio: 'ignore' }
			);
		} catch {
			throw new Error(
				'TLS certificates are missing. Install mkcert and run `mkcert -install`, or provide TLS_CERT and TLS_KEY.'
			);
		}

		fs.writeFileSync(ipFile, certIdentity, 'utf8');
	}

	if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
		throw new Error(
			'TLS certificates are missing. Install mkcert and run `mkcert -install`, or provide TLS_CERT and TLS_KEY.'
		);
	}

	return {
		cert: certFile,
		key: keyFile,
	};
}

/**
 * @type {import('./src/types.ts').ServerConfig}
 */
export const config = {
	/**
	 * Server domain. WebSocket and HTTP API connections with an Origin header
	 * not matching this domain will be rejected.
	 */
	domain,
	/**
	 * Signaling settings (Protoo WebSocket server and HTTP API server).
	 */
	http: {
		listenIp: '0.0.0.0',
		listenPort: Number(process.env['HTTP_LISTEN_PORT'] ?? 4443),
		/**
		 * Optional. If tls is not set, server will use HTTP instead.
		 */
		tls: ensureCerts(),
	},
	/**
	 * mediasoup settings.
	 */
	mediasoup: {
		// Number of mediasoup workers to launch.
		numWorkers: Object.keys(os.cpus()).length,
		/**
		 * mediasoup WorkerSettings.
		 *
		 * @see https://mediasoup.org/documentation/v3/mediasoup/api/#WorkerSettings
		 */
		workerSettings: {
			dtlsCertificateFile: undefined,
			dtlsPrivateKeyFile: undefined,
			logLevel: 'warn',
			logTags: [
				'info',
				'ice',
				'dtls',
				'rtp',
				'srtp',
				'rtcp',
				'rtx',
				'bwe',
				'score',
				'simulcast',
				'svc',
				'sctp',
			],
			disableLiburing: false,
		},
		/**
		 * mediasoup Router options.
		 *
		 * @see https://mediasoup.org/documentation/v3/mediasoup/api/#RouterOptions
		 */
		routerOptions: {
			mediaCodecs: [
				{
					kind: 'audio',
					mimeType: 'audio/opus',
					clockRate: 48000,
					channels: 2,
				},
				{
					kind: 'video',
					mimeType: 'video/VP8',
					clockRate: 90000,
					parameters: {
						'x-google-start-bitrate': 1000,
					},
				},
				{
					kind: 'video',
					mimeType: 'video/VP9',
					clockRate: 90000,
					parameters: {
						'profile-id': 2,
						'x-google-start-bitrate': 1000,
					},
				},
				{
					kind: 'video',
					mimeType: 'video/h264',
					clockRate: 90000,
					parameters: {
						'packetization-mode': 1,
						'profile-level-id': '4d0032',
						'level-asymmetry-allowed': 1,
						'x-google-start-bitrate': 1000,
					},
				},
				{
					kind: 'video',
					mimeType: 'video/h264',
					clockRate: 90000,
					parameters: {
						'packetization-mode': 1,
						'profile-level-id': '42e01f',
						'level-asymmetry-allowed': 1,
						'x-google-start-bitrate': 1000,
					},
				},
			],
		},
		/**
		 * mediasoup WebRtcServer options for WebRTC endpoints (mediasoup-client,
		 * libmediasoupclient).
		 *
		 * @see https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcServerOptions
		 *
		 * @remarks
		 * - `port` is mandatory here.
		 * - Room.ts in mediasoup-demo server will increase this port for each
		 *   mediasoup Worker since each Worker is a separate process.
		 */
		webRtcServerOptions: {
			listenInfos: [
				{
					protocol: 'udp',
					ip: listenIp,
					announcedAddress,
					port: 44444,
					sendBufferSize: undefined,
					recvBufferSize: undefined,
				},
				{
					protocol: 'tcp',
					ip: listenIp,
					announcedAddress,
					port: 44444,
					sendBufferSize: undefined,
					recvBufferSize: undefined,
				},
			],
		},
		/**
		 * mediasoup WebRtcTransport options for WebRTC endpoints (mediasoup-client,
		 * libmediasoupclient).
		 *
		 * @see https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
		 */
		webRtcTransportOptions: {
			initialAvailableOutgoingBitrate: 1000000,
			minimumAvailableOutgoingBitrate: 600000,
			maxSendMessageSize: 5000000,
			sctpSendBufferSize: 7000000,
			sctpPerStreamSendQueueLimit: 5000000,
			maxReceiveMessageSize: 5000000,
			sctpMaxReceiverWindowBufferSize: 7000000,
		},
		/**
		 * Additional options that are not part of WebRtcTransportOptions but
		 * instead used for function calls.
		 */
		additionalWebRtcTransportOptions: {
			maxIncomingBitrate: undefined,
		},
		/**
		 * mediasoup PlainTransport options for RTP endpoints (FFmpeg, GStreamer).
		 *
		 * @see https://mediasoup.org/documentation/v3/mediasoup/api/#PlainTransportOptions
		 */
		plainTransportOptions: {
			listenInfo: {
				protocol: 'udp',
				ip: listenIp,
				announcedAddress,
				portRange: {
					min: Number(process.env['MEDIASOUP_MIN_PORT'] ?? 40000),
					max: Number(process.env['MEDIASOUP_MAX_PORT'] ?? 40999),
				},
				// sendBufferSize: 2000000,
				// recvBufferSize: 2000000,
			},
			maxSendMessageSize: 5000000,
			sctpSendBufferSize: 7000000,
			sctpPerStreamSendQueueLimit: 5000000,
			maxReceiveMessageSize: 5000000,
			sctpMaxReceiverWindowBufferSize: 7000000,
		},
	},
	providers: {
		/**
		 * URL to connect to rtcstats server from client.
		 *
		 * @see https://www.npmjs.com/package/@rtcstats/rtcstats-js.
		 */
		rtcstatsUrl: undefined,
	},
};
