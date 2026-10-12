import * as process from 'node:process';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Auto-load .env if available in server directory
const envFile = path.join(__dirname, '..', '.env');

if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
	try {
		process.loadEnvFile(envFile);
	} catch {
		// Ignore .env read error
	}
}

export function getConfigFile(): string {
	return process.env['CONFIG_FILE'] ?? path.join(__dirname, '..', 'config.mjs');
}

export function getDebug(): string | undefined {
	return process.env['DEBUG'];
}

export function getTerminal(): boolean {
	return process.env['TERMINAL'] === 'true';
}

export function getNetworkThrottleSecret(): string | undefined {
	return process.env['NETWORK_THROTTLE_SECRET'];
}
