export type DateChunk = {
  dateFrom: string;
  dateTo: string;
  granularity: "month" | "week" | "day";
};

type Granularity = DateChunk["granularity"];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseIsoDate(value: string, fieldName: "dateFrom" | "dateTo"): Date {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(
      `Invalid date range: ${fieldName} must be a valid ISO date (YYYY-MM-DD)`,
    );
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (formatIsoDate(date) !== value) {
    throw new Error(
      `Invalid date range: ${fieldName} must be a valid ISO date (YYYY-MM-DD)`,
    );
  }

  return date;
}

function parseDateRange(dateFrom: string, dateTo: string): { start: Date; end: Date } {
  const start = parseIsoDate(dateFrom, "dateFrom");
  const end = parseIsoDate(dateTo, "dateTo");

  if (start.getTime() > end.getTime()) {
    throw new Error("Invalid date range: dateFrom must be before or equal to dateTo");
  }

  return { start, end };
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function makeChunk(dateFrom: Date, dateTo: Date, granularity: Granularity): DateChunk {
  return {
    dateFrom: formatIsoDate(dateFrom),
    dateTo: formatIsoDate(dateTo),
    granularity,
  };
}

export function splitDateRangeIntoMonths(dateFrom: string, dateTo: string): DateChunk[] {
  const { start, end } = parseDateRange(dateFrom, dateTo);
  const chunks: DateChunk[] = [];
  let current = start;

  while (current.getTime() <= end.getTime()) {
    const monthEnd = new Date(
      Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0),
    );
    const chunkEnd = minDate(monthEnd, end);
    chunks.push(makeChunk(current, chunkEnd, "month"));
    current = addDays(chunkEnd, 1);
  }

  return chunks;
}

export function splitDateRangeIntoWeeks(dateFrom: string, dateTo: string): DateChunk[] {
  const { start, end } = parseDateRange(dateFrom, dateTo);
  const chunks: DateChunk[] = [];
  let current = start;

  while (current.getTime() <= end.getTime()) {
    const chunkEnd = minDate(addDays(current, 6), end);
    chunks.push(makeChunk(current, chunkEnd, "week"));
    current = addDays(chunkEnd, 1);
  }

  return chunks;
}

export function splitDateRangeIntoDays(dateFrom: string, dateTo: string): DateChunk[] {
  const { start, end } = parseDateRange(dateFrom, dateTo);
  const chunks: DateChunk[] = [];
  let current = start;

  while (current.getTime() <= end.getTime()) {
    chunks.push(makeChunk(current, current, "day"));
    current = addDays(current, 1);
  }

  return chunks;
}
