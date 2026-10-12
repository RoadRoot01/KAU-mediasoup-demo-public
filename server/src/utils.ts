/**
 * Clones the given value.
 */
export function clone<T>(value: T): T {
	if (value === undefined) {
		return undefined as unknown as T;
	} else if (Number.isNaN(value)) {
		return NaN as unknown as T;
	} else if (typeof structuredClone === 'function') {
		// Available in Node >= 18.
		return structuredClone(value);
	} else {
		return JSON.parse(JSON.stringify(value));
	}
}

export function assertUnreachable(key: string, value: never): never {
	throw new TypeError(`invalid ${key}: ${value}`);
}

/**
 * Whether two URLs have same HTTP scheme and hostname. Port is ignored.
 * For local network development, also allows origins from localhost and private LAN IPs.
 */
export function areSameHttpOrigins(urlA?: string, urlB?: string): boolean {
	if (!urlA || !urlB) {
		return false;
	}

	try {
		const a = new URL(urlA);
		const b = new URL(urlB);

		if (
			(a.protocol !== 'http:' && a.protocol !== 'https:') ||
			a.protocol !== b.protocol
		) {
			return false;
		}

		if (a.hostname === b.hostname) {
			return true;
		}

		const isLocalOrPrivateHost = (host: string): boolean => {
			if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
				return true;
			}
			// 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12
			if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) {
				return true;
			}
			if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
				return true;
			}
			if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) {
				return true;
			}

			return false;
		};

		return isLocalOrPrivateHost(a.hostname) && isLocalOrPrivateHost(b.hostname);
	} catch {
		return false;
	}
}
