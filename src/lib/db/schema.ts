import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const businesses = sqliteTable(
  "businesses",
  {
    id: integer("id").primaryKey(),
    bizNoNormalized: text("biz_no_normalized").notNull(),
    bizNoDisplay: text("biz_no_display"),
    businessName: text("business_name"),
    representativeName: text("representative_name"),
    address: text("address"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("businesses_biz_no_unique").on(table.bizNoNormalized),
    index("businesses_business_name_idx").on(table.businessName),
  ],
);

export const contractRecords = sqliteTable(
  "contract_records",
  {
    id: integer("id").primaryKey(),
    businessId: integer("business_id").references(() => businesses.id),
    sourceDataset: text("source_dataset").notNull(),
    sourceRowHash: text("source_row_hash").notNull(),
    businessCategory: text("business_category").notNull().default("unknown"),
    noticeNo: text("notice_no"),
    noticeOrder: text("notice_order"),
    noticeName: text("notice_name"),
    contractNo: text("contract_no"),
    unifiedContractNo: text("unified_contract_no"),
    contractName: text("contract_name").notNull(),
    contractDate: text("contract_date").notNull(),
    currentContractAmount: integer("current_contract_amount"),
    totalContractAmount: integer("total_contract_amount"),
    demandAgencyCode: text("demand_agency_code"),
    demandAgencyName: text("demand_agency_name"),
    contractAgencyCode: text("contract_agency_code"),
    contractAgencyName: text("contract_agency_name"),
    contractMethod: text("contract_method"),
    winningMethod: text("winning_method"),
    businessNameAtContract: text("business_name_at_contract"),
    bizNoNormalized: text("biz_no_normalized").notNull(),
    contractDetailUrl: text("contract_detail_url"),
    noticeDetailUrl: text("notice_detail_url"),
    rawSourceUrl: text("raw_source_url"),
    sourceStatus: text("source_status").notNull().default("local_only"),
    lastImportedAt: text("last_imported_at").notNull(),
    lastEnrichedAt: text("last_enriched_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("contract_records_biz_no_idx").on(table.bizNoNormalized),
    index("contract_records_contract_date_idx").on(table.contractDate),
    index("contract_records_notice_no_idx").on(table.noticeNo),
    index("contract_records_contract_no_idx").on(table.contractNo),
    index("contract_records_unified_contract_no_idx").on(table.unifiedContractNo),
    index("contract_records_biz_no_contract_date_idx").on(table.bizNoNormalized, table.contractDate),
    uniqueIndex("contract_records_source_dataset_row_hash_unique").on(
      table.sourceDataset,
      table.sourceRowHash,
    ),
  ],
);

export const apiEnrichmentLogs = sqliteTable("api_enrichment_logs", {
  id: integer("id").primaryKey(),
  contractRecordId: integer("contract_record_id").references(() => contractRecords.id),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  requestParamsJson: text("request_params_json"),
  responseStatus: text("response_status"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const importRuns = sqliteTable("import_runs", {
  id: integer("id").primaryKey(),
  sourceName: text("source_name").notNull(),
  sourceFileName: text("source_file_name"),
  rowCount: integer("row_count").notNull().default(0),
  insertedCount: integer("inserted_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text("finished_at"),
  status: text("status").notNull(),
  notes: text("notes"),
});

export const shoppingMallDeliveryRequestInfoCacheChunks = sqliteTable(
  "shopping_mall_delivery_request_info_cache_chunks",
  {
    id: integer("id").primaryKey(),
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to").notNull(),
    totalCount: integer("total_count").notNull().default(0),
    cachedRowCount: integer("cached_row_count").notNull().default(0),
    refreshedAt: text("refreshed_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("shopping_delivery_cache_chunk_unique").on(table.dateFrom, table.dateTo),
  ],
);

export const shoppingMallDeliveryRequestInfoCache = sqliteTable(
  "shopping_mall_delivery_request_info_cache",
  {
    id: integer("id").primaryKey(),
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to").notNull(),
    sourceRowHash: text("source_row_hash").notNull(),
    deliveryRequestNo: text("delivery_request_no"),
    deliveryRequestChangeOrder: text("delivery_request_change_order"),
    receiptDate: text("receipt_date"),
    corpBizno: text("corp_bizno"),
    corpName: text("corp_name"),
    contractMethod: text("contract_method"),
    deliveryRequestName: text("delivery_request_name"),
    rawJson: text("raw_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("shopping_delivery_cache_chunk_idx").on(table.dateFrom, table.dateTo),
    index("shopping_delivery_cache_chunk_biz_idx").on(table.dateFrom, table.dateTo, table.corpBizno),
    uniqueIndex("shopping_delivery_cache_request_unique").on(table.dateFrom, table.dateTo, table.sourceRowHash),
  ],
);
