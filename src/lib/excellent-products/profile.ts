import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { businesses } from "@/lib/db/schema";
import {
  EXCELLENT_PRODUCTS_API_SOURCE_NAME,
  EXCELLENT_PRODUCTS_CONTRACT_SOURCE_NAME,
  EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
  getBusinessProfileSourcePriority,
} from "./constants";

export {
  EXCELLENT_PRODUCTS_API_SOURCE_NAME,
  EXCELLENT_PRODUCTS_CONTRACT_SOURCE_NAME,
  EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
} from "./constants";

/**
 * Input shape for the priority-aware business profile upsert.
 *
 * Every optional value defaults to `null`, which signals "do not touch
 * this column". The incoming `profileSource` is the only field used to
 * rank the priority of this upsert against the existing row.
 */
export type BusinessProfilePriorityInput = {
  bizNoNormalized: string;
  bizNoDisplay: string | null;
  businessName: string | null;
  representativeName: string | null;
  address: string | null;
  phone: string | null;
  profileSource: string | null;
  lastSyncedAt: string | null;
};

type BusinessTx = Pick<Db, "insert" | "select" | "update">;

/**
 * Pick the value that should be stored for a single profile column.
 *
 * Priority order: API > excellent-product CSV > contract CSV > unknown.
 *  - A `null` incoming value never erases an existing non-null value.
 *  - If the existing value is `null`, the incoming value (even `null`)
 *    wins because there is nothing to preserve.
 *  - Otherwise the higher-priority source wins; equal-priority sources
 *    fall back to the incoming value so re-importing the same source
 *    remains idempotent and refreshing the same source updates fields.
 */
export function resolveProfileValue(
  existingValue: string | null,
  incomingValue: string | null,
  existingPriority: number,
  incomingPriority: number,
): string | null {
  if (incomingValue === null) {
    return existingValue;
  }
  if (existingValue === null) {
    return incomingValue;
  }
  if (incomingPriority >= existingPriority) {
    return incomingValue;
  }
  return existingValue;
}

/**
 * Upsert a business profile row honouring the priority order
 *
 *   user-info (API) > excellent-products-csv > contract CSV
 *
 * and the invariant that `null` never erases an existing non-null value.
 *
 * Used by both the excellent-products snapshot importer and the
 * contract CSV importer so the priority semantics stay consistent.
 */
export function upsertBusinessProfilePriority(
  tx: BusinessTx,
  row: BusinessProfilePriorityInput,
  now: string,
): void {
  const incomingPriority = getBusinessProfileSourcePriority(row.profileSource);

  const existing = tx
    .select({
      bizNoDisplay: businesses.bizNoDisplay,
      businessName: businesses.businessName,
      representativeName: businesses.representativeName,
      address: businesses.address,
      phone: businesses.phone,
      profileSource: businesses.profileSource,
      lastSyncedAt: businesses.lastSyncedAt,
    })
    .from(businesses)
    .where(eq(businesses.bizNoNormalized, row.bizNoNormalized))
    .get();

  if (existing === undefined) {
    tx.insert(businesses)
      .values({
        bizNoNormalized: row.bizNoNormalized,
        bizNoDisplay: row.bizNoDisplay,
        businessName: row.businessName,
        representativeName: row.representativeName,
        address: row.address,
        phone: row.phone,
        profileSource: row.profileSource,
        lastSyncedAt: row.lastSyncedAt,
        updatedAt: now,
      })
      .run();
    return;
  }

  const existingPriority = getBusinessProfileSourcePriority(existing.profileSource);

  tx.update(businesses)
    .set({
      bizNoDisplay: resolveProfileValue(
        existing.bizNoDisplay,
        row.bizNoDisplay,
        existingPriority,
        incomingPriority,
      ),
      businessName: resolveProfileValue(
        existing.businessName,
        row.businessName,
        existingPriority,
        incomingPriority,
      ),
      representativeName: resolveProfileValue(
        existing.representativeName,
        row.representativeName,
        existingPriority,
        incomingPriority,
      ),
      address: resolveProfileValue(
        existing.address,
        row.address,
        existingPriority,
        incomingPriority,
      ),
      phone: resolveProfileValue(
        existing.phone,
        row.phone,
        existingPriority,
        incomingPriority,
      ),
      profileSource: resolveProfileValue(
        existing.profileSource,
        row.profileSource,
        existingPriority,
        incomingPriority,
      ),
      lastSyncedAt: resolveProfileValue(
        existing.lastSyncedAt,
        row.lastSyncedAt,
        existingPriority,
        incomingPriority,
      ),
      updatedAt: now,
    })
    .where(eq(businesses.bizNoNormalized, row.bizNoNormalized))
    .run();
}
