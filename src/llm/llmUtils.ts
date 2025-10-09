import { logDebug, logWarning, logError } from '../utils/logger';
import { getConfig } from '../utils/config';

// Domain to IP address cache
interface DomainCache {
	ip: string;
	timestamp: number;
}

const domainCache = new Map<string, DomainCache>();
const CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours (milliseconds)

// Display cache status
function logCacheStatus(): void {
	logDebug(`Domain cache status:`);
	if (domainCache.size === 0) {
		logDebug(`  Cache is empty`);
		return;
	}
	
	const now = Date.now();
	for (const [hostname, cache] of domainCache.entries()) {
		const age = now - cache.timestamp;
		const ageMinutes = Math.floor(age / (60 * 1000));
		const remainingMinutes = Math.floor((CACHE_DURATION - age) / (60 * 1000));
		const isValid = age < CACHE_DURATION;
		
		logDebug(`  ${hostname} → ${cache.ip} (${ageMinutes} minutes ago, ${remainingMinutes} minutes remaining, ${isValid ? 'valid' : 'expired'})`);
	}
}

// Convert domain to IP address (with cache)
async function resolveDomainToIP(hostname: string): Promise<string | null> {
	// Use hostname in lowercase as cache key
	const cacheKey = hostname.toLowerCase();
	
	// Check cache
	const cached = domainCache.get(cacheKey);
	const now = Date.now();
	
	if (cached && (now - cached.timestamp) < CACHE_DURATION) {
		logDebug(`IP address retrieved from cache: ${hostname} → ${cached.ip}`);
		return cached.ip;
	}
	
	// DNS resolution if cache is invalid or doesn't exist
	try {
		logDebug(`DNS resolution started: ${hostname}`);
		const dns = require('dns');
		
		const addresses = await new Promise<string[]>((resolve, reject) => {
			dns.lookup(hostname, { all: true }, (err: any, addresses: any) => {
				if (err) {
					reject(err);
				} else {
					// Prioritize IPv4 addresses
					const ipv4Addresses = addresses
						.filter((addr: any) => addr.family === 4)
						.map((addr: any) => addr.address);
					resolve(ipv4Addresses);
				}
			});
		});
		
		if (0 < addresses.length) {
			const ip = addresses[0]; // Use the first IPv4 address
			domainCache.set(cacheKey, { ip, timestamp: now });
			logDebug(`DNS resolution completed: ${hostname} → ${ip} (saved to cache)`);
			logCacheStatus();
			return ip;
		}
		
		logWarning(`No IPv4 address found: ${hostname}`);
		return null;
		
	} catch (error: any) {
		logError(`DNS resolution failed: ${hostname} - ${error.message}`);
		return null;
	}
}

// Convert hostname in URL to IP address
async function convertURLToIP(url: string): Promise<string> {
	try {
		const urlObj = new URL(url);
		const hostname = urlObj.hostname;
		
		// Return as-is if localhost or IP address
		if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
			return url;
		}
		
		// Convert to IP address if domain name
		const ip = await resolveDomainToIP(hostname);
		if (ip) {
			// Replace case-insensitively
			const newURL = url.replace(new RegExp(hostname, 'gi'), ip);
			logDebug(`URL conversion: ${url} → ${newURL}`);
			return newURL;
		}
		
		// Return original URL if conversion fails
		logWarning(`IP address conversion failed, using original URL: ${url}`);
		return url;
		
	} catch (error: any) {
		logError(`URL conversion error: ${error.message}`);
		return url;
	}
}

export {
	resolveDomainToIP,
	convertURLToIP,
	logCacheStatus
};

export function withLineNumberCodeBlock(CodeBlock: string,
	startLineNumber: number = 0, ignores: string[] = []): {
		CodeBlock: string;
		LastLineNumber: number;
	} {
	startLineNumber = Math.max(startLineNumber, 0);
	let LastLineNumber = startLineNumber;
	if (getConfig().withLineNumber) {
		const lines = CodeBlock.split('\n');
		let counter = 1;
		const withLine = lines.map((line, idx) => {
								if (ignores.includes(line.trim())) {
									return line;
								} else {
									LastLineNumber = startLineNumber + counter++;
									return `${LastLineNumber}|${line}`;
								}
							});
		return { CodeBlock: withLine.join('\n'), LastLineNumber };
	} else {
		return {CodeBlock, LastLineNumber};
	}
}

export function withoutLineNumber(CodeBlock: string, removeNotHaveLineNumber: boolean = false): string {
	if (getConfig().withLineNumber) {
		const lines = CodeBlock.split('\n');
		const filterdLines = (removeNotHaveLineNumber) ? lines.filter((line) => line.match(/^\d+\|/)) : lines;
		const withoutLine = filterdLines.map((line, idx) => line.replace(/^\d+\|/, ''));
		return withoutLine.join('\n');
	} else {
		return CodeBlock;
	}
}
