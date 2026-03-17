/**
 * DST-aware wall-clock time computation for reminder scheduling.
 * Uses `Intl.DateTimeFormat` with IANA timezones for DST resolution.
 * No external timezone library needed -- Node.js 24 has full ICU data.
 *
 * resolveSpringForward and resolveFallBack are private helpers
 * (per plan review LOW #3).
 */

/**
 * Compute the next UTC instant when a user's local wall-clock time
 * matches the given hour:minute, for the given cadence.
 */
export function computeNextFiringUtc(
	timezone: string,
	localTime: string,
	_cadence: "daily" | "weekly",
	now: Date,
): Date {
	const [targetHour, targetMinute] = localTime.split(":").map(Number);

	// Get the user's current local date
	const localDateStr = getLocalDateString(timezone, now);
	const [year, month, day] = localDateStr.split("-").map(Number);

	// Try today
	const todayResult = localDateToUtc(timezone, year, month, day, targetHour, targetMinute);
	if (todayResult.getTime() > now.getTime()) {
		return todayResult;
	}

	// Try tomorrow by incrementing the local date
	const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
	const nextResult = localDateToUtc(
		timezone,
		nextDay.getUTCFullYear(),
		nextDay.getUTCMonth() + 1,
		nextDay.getUTCDate(),
		targetHour,
		targetMinute,
	);
	return nextResult;
}

/**
 * Convert a local date/time in a timezone to a UTC Date.
 * Handles spring forward (gap) and fall back (ambiguous) transitions.
 *
 * For fall back (ambiguous times), returns the first occurrence (earlier UTC).
 * For spring forward (gap), advances to the next valid local minute.
 */
function localDateToUtc(
	timezone: string,
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
): Date {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

	// Collect all matching UTC candidates
	const candidates: Date[] = [];

	for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 30) {
		const candidateUtc = new Date(
			Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offsetMinutes * 60 * 1000,
		);

		const parts = formatter.formatToParts(candidateUtc);
		const getPart = (type: string) => {
			const part = parts.find((p) => p.type === type);
			return part ? Number.parseInt(part.value, 10) : 0;
		};

		if (
			getPart("year") === year &&
			getPart("month") === month &&
			getPart("day") === day &&
			getPart("hour") === hour &&
			getPart("minute") === minute
		) {
			candidates.push(candidateUtc);
		}
	}

	if (candidates.length > 0) {
		// Fall back: return the earliest UTC time (first occurrence)
		candidates.sort((a, b) => a.getTime() - b.getTime());
		return candidates[0];
	}

	// Spring forward: the requested local time doesn't exist.
	return resolveSpringForward(timezone, year, month, day, hour, minute);
}

/**
 * When the scheduled local time does not exist (spring forward),
 * advance to the next valid local minute and return its UTC equivalent.
 */
function resolveSpringForward(
	timezone: string,
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
): Date {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

	// Scan forward from the target time to find the next valid local minute
	const targetMinuteOfDay = hour * 60 + minute;

	for (let offset = 1; offset <= 120; offset++) {
		const candidateMinuteOfDay = targetMinuteOfDay + offset;
		const candidateHour = Math.floor(candidateMinuteOfDay / 60) % 24;
		const candidateMinute = candidateMinuteOfDay % 60;
		const candidateDay = candidateMinuteOfDay >= 1440 ? day + 1 : day;

		// Try all reasonable offsets for this candidate time
		for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 30) {
			const candidateUtc = new Date(
				Date.UTC(year, month - 1, candidateDay, candidateHour, candidateMinute, 0, 0) -
					offsetMinutes * 60 * 1000,
			);

			const parts = formatter.formatToParts(candidateUtc);
			const getPart = (type: string) => {
				const part = parts.find((p) => p.type === type);
				return part ? Number.parseInt(part.value, 10) : 0;
			};

			if (
				getPart("year") === year &&
				getPart("month") === month &&
				getPart("day") === (candidateDay > 31 ? 1 : candidateDay) &&
				getPart("hour") === candidateHour &&
				getPart("minute") === candidateMinute
			) {
				return candidateUtc;
			}
		}
	}

	// Fallback: shouldn't happen with valid IANA timezones
	return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
}

/**
 * Compute a deterministic dedupe key for a reminder schedule window.
 */
export function computeDedupeKey(userId: string, cadence: string, windowId: string): string {
	return `reminder:${userId}:${cadence}:${windowId}`;
}

/**
 * Check whether `now` is within the catch-up window after `scheduledUtc`.
 * Returns true if 0 <= (now - scheduledUtc) <= windowHours * 3600000.
 */
export function isWithinCatchUpWindow(scheduledUtc: Date, now: Date, windowHours: number): boolean {
	const diff = now.getTime() - scheduledUtc.getTime();
	return diff >= 0 && diff <= windowHours * 60 * 60 * 1000;
}

/**
 * Get the user's local date string (YYYY-MM-DD) from a UTC Date.
 */
export function getLocalDateString(timezone: string, utcDate: Date): string {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	return formatter.format(utcDate);
}

/**
 * Get the ISO week string (YYYY-Wnn) for a UTC Date in a given timezone.
 */
export function getIsoWeekString(timezone: string, utcDate: Date): string {
	const localDateStr = getLocalDateString(timezone, utcDate);
	const [y, m, d] = localDateStr.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	const dayOfWeek = date.getUTCDay() || 7; // Monday = 1, Sunday = 7
	date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek); // Thursday of the week
	const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
	const weekNumber = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}
