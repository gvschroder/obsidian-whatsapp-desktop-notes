// Core Data timestamps. WhatsApp Desktop stores dates as seconds counted from
// Core Data's reference date, 2001-01-01T00:00:00Z ("Mac absolute time").

/** 2001-01-01T00:00:00Z in Unix milliseconds. */
const CORE_DATA_REFERENCE_MS = 978_307_200_000;

/** Core Data seconds → JavaScript Date. */
export function coreDataTimeToDate(seconds: number): Date {
	return new Date(CORE_DATA_REFERENCE_MS + seconds * 1000);
}

/** JavaScript Date → Core Data seconds. */
export function dateToCoreDataTime(date: Date): number {
	return (date.valueOf() - CORE_DATA_REFERENCE_MS) / 1000;
}
