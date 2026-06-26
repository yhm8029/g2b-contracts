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

export function firstApiItem(response: unknown): unknown {
  const parsed = responseItemsSchema.parse(response);
  const items = parsed.response?.body?.items;

  if (Array.isArray(items)) {
    return items[0] ?? {};
  }

  if (items !== null && typeof items === "object" && "item" in items) {
    const item = (items as { item?: unknown }).item;
    if (Array.isArray(item)) {
      return item[0] ?? {};
    }

    return item ?? {};
  }

  return {};
}
