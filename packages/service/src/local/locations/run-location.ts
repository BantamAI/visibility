import type { RunLocation } from "@workspace/lib/providers";
import type { SamplePoint } from "../schema";

/**
 * Google's `uule` location parameter: "w+" and a base64url protobuf holding the
 * canonical name. Its length takes one byte, which holds every canonical name.
 */
export function googleUule(canonicalName: string): string {
	const name = Buffer.from(canonicalName, "utf8");
	if (name.length > 127) throw new Error(`Google canonical name is too long for a uule: ${canonicalName}`);
	const message = Buffer.concat([Buffer.from([0x08, 0x02, 0x10, 0x20, 0x22, name.length]), name]);
	return `w+${message.toString("base64url")}`;
}

export function toRunLocation(
	point: Pick<
		SamplePoint,
		"id" | "lat" | "lng" | "city" | "region" | "country" | "postalCode" | "timezone" | "googleCanonicalName"
	>,
): RunLocation {
	return {
		pointId: point.id,
		latitude: point.lat,
		longitude: point.lng,
		country: point.country,
		timezone: point.timezone,
		...(point.city ? { city: point.city } : {}),
		...(point.region ? { region: point.region } : {}),
		...(point.postalCode ? { postalCode: point.postalCode } : {}),
		...(point.googleCanonicalName
			? { googleCanonicalName: point.googleCanonicalName, uule: googleUule(point.googleCanonicalName) }
			: {}),
	};
}
