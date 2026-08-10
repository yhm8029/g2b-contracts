import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const businesses = sqliteTable(
  "businesses",
  {
    id: integer("id").primaryKey(),
    bizNoNormalized: text("biz_no_normalized").notNull(),
    bizNoDisplay: text("biz_no_display"),
    businessName: text("business_name"),
    representativeName: text("representative_name"),
    address: text("address"),
    phone: text("phone"),
    profileSource: text("profile_source"),
    lastSyncedAt: text("last_synced_at"),
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

export const competitorContractQueryCache = sqliteTable(
  "competitor_contract_query_cache",
  {
    bizNoNormalized: text("biz_no_normalized").notNull(),
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to").notNull(),
    resultJson: text("result_json").notNull(),
    cachedAtMs: integer("cached_at_ms").notNull(),
    resultVersion: text("result_version").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bizNoNormalized, table.dateFrom, table.dateTo] }),
    index("competitor_contract_query_cache_expiry_idx").on(table.cachedAtMs),
  ],
);

export const competitorContractIntervalCache = sqliteTable(
  "competitor_contract_interval_cache",
  {
    bizNoNormalized: text("biz_no_normalized").notNull(),
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to").notNull(),
    resultJson: text("result_json").notNull(),
    cachedAtMs: integer("cached_at_ms").notNull(),
    resultVersion: text("result_version").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bizNoNormalized, table.dateFrom, table.dateTo] }),
    index("competitor_contract_interval_cache_lookup_idx").on(
      table.bizNoNormalized,
      table.dateFrom,
      table.dateTo,
    ),
    index("competitor_contract_interval_cache_expiry_idx").on(table.cachedAtMs),
  ],
);

export const competitorThirdPartyDeliveryMonthlyCache = sqliteTable(
  "competitor_third_party_delivery_monthly_cache",
  {
    registryKey: text("registry_key").notNull(),
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to").notNull(),
    resultJson: text("result_json").notNull(),
    cachedAtMs: integer("cached_at_ms").notNull(),
    resultVersion: text("result_version").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.registryKey, table.dateFrom, table.dateTo] }),
    index("competitor_third_party_delivery_monthly_cache_expiry_idx").on(table.cachedAtMs),
  ],
);

export const excellentProducts = sqliteTable(
  "excellent_products",
  {
    id: integer("id").primaryKey(),
    bizNoNormalized: text("biz_no_normalized").notNull(),
    designationNo: text("designation_no").notNull(),
    companyNameCsv: text("company_name_csv").notNull(),
    representativeNameCsv: text("representative_name_csv"),
    phoneCsv: text("phone_csv"),
    addressCsv: text("address_csv"),
    productName: text("product_name").notNull(),
    productSpec: text("product_spec"),
    productClassificationNo: text("product_classification_no").notNull(),
    productClassificationNormalized: text("product_classification_normalized").notNull(),
    productClassificationName: text("product_classification_name"),
    designationStartDate: text("designation_start_date"),
    designationEndDate: text("designation_end_date"),
    certificationDetailsRaw: text("certification_details_raw"),
    sanctionType: text("sanction_type"),
    sourceDataset: text("source_dataset").notNull(),
    sourceRowHash: text("source_row_hash").notNull(),
    sourceFileName: text("source_file_name"),
    sourceImportedAt: text("source_imported_at").notNull(),
    rawJson: text("raw_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("excellent_products_biz_no_idx").on(table.bizNoNormalized),
    index("excellent_products_classification_idx").on(table.productClassificationNormalized),
    uniqueIndex("excellent_products_source_dataset_row_hash_unique").on(
      table.sourceDataset,
      table.sourceRowHash,
    ),
  ],
);

export const factoryLocations = sqliteTable(
  "factory_locations",
  {
    id: integer("id").primaryKey(),
    bizNoNormalized: text("biz_no_normalized").notNull(),
    location: text("location").notNull(),
    source: text("source").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("factory_locations_biz_no_idx").on(table.bizNoNormalized),
    uniqueIndex("factory_locations_unique").on(
      table.bizNoNormalized,
      table.location,
      table.source,
    ),
  ],
);

export const companyIndustries = sqliteTable(
  "company_industries",
  {
    id: integer("id").primaryKey(),
    bizNoNormalized: text("biz_no_normalized").notNull(),
    industryCode: text("industry_code").notNull(),
    industryName: text("industry_name").notNull(),
    status: text("status"),
    source: text("source").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("company_industries_biz_no_idx").on(table.bizNoNormalized),
    uniqueIndex("company_industries_unique").on(
      table.bizNoNormalized,
      table.industryCode,
      table.industryName,
      table.source,
    ),
  ],
);