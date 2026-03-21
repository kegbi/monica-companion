/** IANA timezone list grouped by region, server-side rendered. */
export interface TimezoneEntry {
	value: string;
	label: string;
	offset: string;
}

export interface TimezoneGroup {
	region: string;
	timezones: TimezoneEntry[];
}

function formatOffset(tz: string): string {
	try {
		const now = new Date();
		const formatted = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			timeZoneName: "shortOffset",
		}).format(now);
		const match = formatted.match(/GMT([+-]\d{1,2}(?::\d{2})?)?/);
		if (match) {
			return match[1] ? `UTC${match[1]}` : "UTC";
		}
		return "";
	} catch {
		return "";
	}
}

function formatLabel(tz: string): string {
	const parts = tz.split("/");
	const city = parts[parts.length - 1].replace(/_/g, " ");
	return city;
}

/** Common timezones organized by region. Covers the vast majority of users. */
const TIMEZONE_DATA: Record<string, string[]> = {
	Americas: [
		"America/New_York",
		"America/Chicago",
		"America/Denver",
		"America/Los_Angeles",
		"America/Anchorage",
		"Pacific/Honolulu",
		"America/Phoenix",
		"America/Toronto",
		"America/Vancouver",
		"America/Winnipeg",
		"America/Halifax",
		"America/St_Johns",
		"America/Mexico_City",
		"America/Monterrey",
		"America/Tijuana",
		"America/Bogota",
		"America/Lima",
		"America/Santiago",
		"America/Buenos_Aires",
		"America/Sao_Paulo",
		"America/Caracas",
		"America/La_Paz",
		"America/Montevideo",
		"America/Asuncion",
		"America/Guayaquil",
		"America/Havana",
		"America/Jamaica",
		"America/Panama",
		"America/Costa_Rica",
		"America/Guatemala",
	],
	Europe: [
		"Europe/London",
		"Europe/Dublin",
		"Europe/Lisbon",
		"Europe/Paris",
		"Europe/Berlin",
		"Europe/Brussels",
		"Europe/Amsterdam",
		"Europe/Madrid",
		"Europe/Rome",
		"Europe/Zurich",
		"Europe/Vienna",
		"Europe/Warsaw",
		"Europe/Prague",
		"Europe/Budapest",
		"Europe/Bucharest",
		"Europe/Sofia",
		"Europe/Athens",
		"Europe/Helsinki",
		"Europe/Stockholm",
		"Europe/Oslo",
		"Europe/Copenhagen",
		"Europe/Tallinn",
		"Europe/Riga",
		"Europe/Vilnius",
		"Europe/Kiev",
		"Europe/Moscow",
		"Europe/Istanbul",
		"Europe/Belgrade",
		"Europe/Zagreb",
		"Europe/Ljubljana",
	],
	Asia: [
		"Asia/Dubai",
		"Asia/Riyadh",
		"Asia/Tehran",
		"Asia/Karachi",
		"Asia/Kolkata",
		"Asia/Colombo",
		"Asia/Dhaka",
		"Asia/Almaty",
		"Asia/Tashkent",
		"Asia/Bangkok",
		"Asia/Jakarta",
		"Asia/Ho_Chi_Minh",
		"Asia/Singapore",
		"Asia/Kuala_Lumpur",
		"Asia/Manila",
		"Asia/Shanghai",
		"Asia/Hong_Kong",
		"Asia/Taipei",
		"Asia/Seoul",
		"Asia/Tokyo",
		"Asia/Novosibirsk",
		"Asia/Yekaterinburg",
		"Asia/Vladivostok",
		"Asia/Tbilisi",
		"Asia/Baku",
		"Asia/Beirut",
		"Asia/Jerusalem",
		"Asia/Amman",
		"Asia/Baghdad",
		"Asia/Qatar",
	],
	Africa: [
		"Africa/Cairo",
		"Africa/Johannesburg",
		"Africa/Lagos",
		"Africa/Nairobi",
		"Africa/Casablanca",
		"Africa/Accra",
		"Africa/Addis_Ababa",
		"Africa/Algiers",
		"Africa/Dar_es_Salaam",
		"Africa/Tunis",
	],
	"Australia & Pacific": [
		"Australia/Sydney",
		"Australia/Melbourne",
		"Australia/Brisbane",
		"Australia/Perth",
		"Australia/Adelaide",
		"Australia/Darwin",
		"Australia/Hobart",
		"Pacific/Auckland",
		"Pacific/Fiji",
		"Pacific/Guam",
		"Pacific/Noumea",
		"Pacific/Tongatapu",
	],
	Other: ["UTC", "Etc/GMT+12", "Etc/GMT-12"],
};

export function getTimezoneGroups(): TimezoneGroup[] {
	return Object.entries(TIMEZONE_DATA).map(([region, tzList]) => ({
		region,
		timezones: tzList.map((tz) => ({
			value: tz,
			label: formatLabel(tz),
			offset: formatOffset(tz),
		})),
	}));
}

export function getAllTimezoneValues(): string[] {
	return Object.values(TIMEZONE_DATA).flat();
}
