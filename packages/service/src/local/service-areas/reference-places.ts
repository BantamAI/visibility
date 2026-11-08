const STATE_NAMES: Record<string, string> = {
	AL: "Alabama",
	AK: "Alaska",
	AZ: "Arizona",
	AR: "Arkansas",
	CA: "California",
	CO: "Colorado",
	CT: "Connecticut",
	DE: "Delaware",
	DC: "District of Columbia",
	FL: "Florida",
	GA: "Georgia",
	HI: "Hawaii",
	ID: "Idaho",
	IL: "Illinois",
	IN: "Indiana",
	IA: "Iowa",
	KS: "Kansas",
	KY: "Kentucky",
	LA: "Louisiana",
	ME: "Maine",
	MD: "Maryland",
	MA: "Massachusetts",
	MI: "Michigan",
	MN: "Minnesota",
	MS: "Mississippi",
	MO: "Missouri",
	MT: "Montana",
	NE: "Nebraska",
	NV: "Nevada",
	NH: "New Hampshire",
	NJ: "New Jersey",
	NM: "New Mexico",
	NY: "New York",
	NC: "North Carolina",
	ND: "North Dakota",
	OH: "Ohio",
	OK: "Oklahoma",
	OR: "Oregon",
	PA: "Pennsylvania",
	RI: "Rhode Island",
	SC: "South Carolina",
	SD: "South Dakota",
	TN: "Tennessee",
	TX: "Texas",
	UT: "Utah",
	VT: "Vermont",
	VA: "Virginia",
	WA: "Washington",
	WV: "West Virginia",
	WI: "Wisconsin",
	WY: "Wyoming",
	PR: "Puerto Rico",
};

export type GazetteerPlace = {
	geoid: string;
	name: string;
	state: string;
	lat: number;
	lng: number;
	landAreaM2: number;
};

/**
 * Census names end in their legal description ("Raleigh city", "Cary town", "Town 'n'
 * Country CDP", "Nashville-Davidson metropolitan government (balance)"), which no
 * one says and Google's names leave out. Every such word is lowercase.
 */
export function placeNameWithoutDescription(censusName: string): string {
	const words = censusName.trim().split(/\s+/);
	while (words.length > 1) {
		const last = words[words.length - 1];
		if (last !== "CDP" && last !== last.toLowerCase()) break;
		words.pop();
	}
	return words.join(" ");
}

/** Reads a Census gazetteer places file; older vintages are tab-separated, newer ones use pipes. */
export function parseGazetteerPlaces(text: string): GazetteerPlace[] {
	const lines = text.split(/\r?\n/).filter((line) => line.trim());
	const header = lines.shift();
	if (!header) return [];
	const delimiter = header.includes("|") ? "|" : "\t";
	const columns = header.split(delimiter).map((column) => column.trim());
	const at = (name: string) => {
		const index = columns.indexOf(name);
		if (index < 0) throw new Error(`The gazetteer file has no ${name} column`);
		return index;
	};
	const [usps, geoid, name, aland, lat, lng] = ["USPS", "GEOID", "NAME", "ALAND", "INTPTLAT", "INTPTLONG"].map(at);
	return lines.map((line) => {
		const fields = line.split(delimiter).map((field) => field.trim());
		return {
			geoid: fields[geoid],
			name: placeNameWithoutDescription(fields[name]),
			state: fields[usps],
			lat: Number(fields[lat]),
			lng: Number(fields[lng]),
			landAreaM2: Number(fields[aland]),
		};
	});
}

function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (quoted) {
			if (char === '"' && line[i + 1] === '"') {
				field += '"';
				i++;
			} else if (char === '"') {
				quoted = false;
			} else {
				field += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === ",") {
			fields.push(field);
			field = "";
		} else {
			field += char;
		}
	}
	fields.push(field);
	return fields;
}

/** The canonical names of active US cities in Google's geotargets CSV. */
export function parseUsCityGeotargets(csv: string): Set<string> {
	const lines = csv.split(/\r?\n/).filter((line) => line.trim());
	const header = parseCsvLine(lines.shift() ?? "");
	const at = (name: string) => {
		const index = header.indexOf(name);
		if (index < 0) throw new Error(`The geotargets file has no ${name} column`);
		return index;
	};
	const [canonical, country, type, status] = ["Canonical Name", "Country Code", "Target Type", "Status"].map(at);
	const names = new Set<string>();
	for (const line of lines) {
		const fields = parseCsvLine(line);
		if (fields[country] === "US" && fields[type] === "City" && fields[status] === "Active") {
			names.add(fields[canonical]);
		}
	}
	return names;
}

/**
 * Google's name for a Census place, if Google targets it. Consolidated cities such as
 * "Nashville-Davidson" or "Louisville/Jefferson County" are listed under their first
 * part, places with an alternate name such as "San Buenaventura (Ventura)" under
 * either name, "Boise City" as "Boise", and most "St." names spelled out as "Saint".
 */
export function googleCanonicalName(place: Pick<GazetteerPlace, "name" | "state">, cities: Set<string>) {
	const stateName = STATE_NAMES[place.state];
	if (!stateName) return null;
	const alternate = place.name.match(/\((.+)\)/)?.[1];
	const candidates = [
		place.name,
		place.name.split(/[-/]/)[0].trim(),
		place.name.replace(/\s*\(.*\)/, "").trim(),
		...(alternate ? [alternate] : []),
		place.name.replace(/ City$/, ""),
		place.name.replace(/\bSt\./g, "Saint").replace(/\bSte\./g, "Sainte"),
	];
	for (const candidate of candidates) {
		const name = `${candidate},${stateName},United States`;
		if (cities.has(name)) return name;
	}
	return null;
}
