const LEGAL_SUFFIX = /(?: (?:llc|inc|co|corp|corporation|ltd|company))+$/;

/**
 * A business name as names are compared: lower case, "&" read as "and", punctuation dropped and a
 * trailing legal suffix ("LLC", "Inc.") ignored, so "Michael & Son, Inc." and "Michael and Son" agree.
 */
export function nameKey(name: string): string {
	return name
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.replace(LEGAL_SUFFIX, "");
}

/** "Roto-Rooter Plumbing & Water Cleanup" starts with "Roto-Rooter"; "Harris Brothers Plumbing" doesn't start with "Brothers Plumbing". */
export function startsWithName(name: string, start: string): boolean {
	const whole = nameKey(name);
	const head = nameKey(start);
	return head !== "" && (whole === head || whole.startsWith(`${head} `));
}

/** Either name is the other, or the other with more after it: a branch's or listing's longer name. */
export function sameBusinessName(a: string, b: string): boolean {
	return startsWithName(a, b) || startsWithName(b, a);
}
