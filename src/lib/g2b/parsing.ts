import { z } from "zod";

export const optionalApiString = z
  .unknown()
  .transform((value) => {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    return null;
  });

const responseItemsSchema = z
  .object({
    response: z
      .object({
        body: z
          .object({
            items: z.unknown().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export type ApiItemResult = {
  matched: boolean;
  item: unknown;
};

export function firstApiItemResult(response: unknown): ApiItemResult {
  const parsed = responseItemsSchema.parse(response);
  const items = parsed.response?.body?.items;

  if (Array.isArray(items)) {
    return items.length > 0 ? { matched: true, item: items[0] } : { matched: false, item: {} };
  }

  if (items !== null && typeof items === "object" && "item" in items) {
    const item = (items as { item?: unknown }).item;
    if (Array.isArray(item)) {
      return item.length > 0 ? { matched: true, item: item[0] } : { matched: false, item: {} };
    }

    return item === null || item === undefined
      ? { matched: false, item: {} }
      : { matched: true, item };
  }

  return { matched: false, item: {} };
}

export function firstApiItem(response: unknown): unknown {
  return firstApiItemResult(response).item;
}
