import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("contract_records_biz_no_idx").on(table.bizNoNormalized),
    index("contract_records_contract_date_idx").on(table.contractDate),
    index("contract_records_notice_no_idx").on(table.noticeNo),
    index("contract_records_contract_no_idx").on(table.contractNo),
    index("contract_records_unified_contract_no_idx").on(
      table.unifiedContractNo,
    ),
    index("contract_records_biz_no_contract_date_idx").on(
      table.bizNoNormalized,
      table.contractDate,
    ),
    uniqueIndex("contract_records_source_dataset_row_hash_unique").on(
      table.sourceDataset,
      table.sourceRowHash,
    ),
  ],
);

export const apiEnrichmentLogs = sqliteTable("api_enrichment_logs", {
  id: integer("id").primaryKey(),
  contractRecordId: integer("contract_record_id").references(
    () => contractRecords.id,
  ),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  requestParamsJson: text("request_params_json"),
  responseStatus: text("response_status"),
  errorMessage: text("error_message"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
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
  startedAt: text("started_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("shopping_delivery_cache_chunk_unique").on(
      table.dateFrom,
      table.dateTo,
    ),
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("shopping_delivery_cache_chunk_idx").on(table.dateFrom, table.dateTo),
    index("shopping_delivery_cache_chunk_biz_idx").on(
      table.dateFrom,
      table.dateTo,
      table.corpBizno,
    ),
    uniqueIndex("shopping_delivery_cache_request_unique").on(
      table.dateFrom,
      table.dateTo,
      table.sourceRowHash,
    ),
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
    primaryKey({
      columns: [table.bizNoNormalized, table.dateFrom, table.dateTo],
    }),
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
    primaryKey({
      columns: [table.bizNoNormalized, table.dateFrom, table.dateTo],
    }),
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
    index("competitor_third_party_delivery_monthly_cache_expiry_idx").on(
      table.cachedAtMs,
    ),
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
    productClassificationNormalized: text(
      "product_classification_normalized",
    ).notNull(),
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("excellent_products_biz_no_idx").on(table.bizNoNormalized),
    index("excellent_products_classification_idx").on(
      table.productClassificationNormalized,
    ),
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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

export const buildingControlSchemaMigrations = sqliteTable(
  "building_control_schema_migrations",
  {
    version: integer("version").primaryKey(),
    name: text("name").notNull(),
    checksum: text("checksum").notNull(),
    appliedAt: text("applied_at").notNull(),
  },
  (table) => [
    check(
      "building_control_schema_migrations_checksum_check",
      sql`length(${table.checksum}) = 64`,
    ),
  ],
);

export const buildingControlSyncRuns = sqliteTable(
  "building_control_sync_runs",
  {
    id: integer("id").primaryKey(),
    trigger: text("trigger").notNull(),
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to").notNull(),
    seoulDate: text("seoul_date").notNull(),
    status: text("status").notNull(),
    leaseOwner: text("lease_owner").notNull(),
    leaseFence: integer("lease_fence").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    redactedError: text("redacted_error"),
  },
  (table) => [
    uniqueIndex("building_control_sync_runs_startup_success_unique")
      .on(table.seoulDate)
      .where(
        sql`${table.trigger} = 'startup' AND ${table.status} = 'completed'`,
      ),
    check(
      "building_control_sync_runs_trigger_check",
      sql`${table.trigger} IN ('startup', 'manual', 'resume')`,
    ),
    check(
      "building_control_sync_runs_status_check",
      sql`${table.status} IN ('running', 'completed', 'failed')`,
    ),
    check(
      "building_control_sync_runs_fence_check",
      sql`${table.leaseFence} >= 1`,
    ),
  ],
);

export const buildingControlSyncLeases = sqliteTable(
  "building_control_sync_leases",
  {
    lockName: text("lock_name").primaryKey(),
    owner: text("owner").notNull(),
    fence: integer("fence").notNull(),
    expiresAt: text("expires_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "building_control_sync_leases_name_check",
      sql`${table.lockName} = 'building-control-sync'`,
    ),
    check("building_control_sync_leases_fence_check", sql`${table.fence} >= 1`),
  ],
);

export const buildingControlSourceGenerations = sqliteTable(
  "building_control_source_generations",
  {
    id: integer("id").primaryKey(),
    syncRunId: integer("sync_run_id")
      .notNull()
      .references(() => buildingControlSyncRuns.id),
    source: text("source").notNull(),
    state: text("state").notNull(),
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to").notNull(),
    expectedCount: integer("expected_count").notNull(),
    observedCount: integer("observed_count").notNull(),
    pageCount: integer("page_count").notNull(),
    identitySetHash: text("identity_set_hash").notNull(),
    sourceHashesJson: text("source_hashes_json").notNull(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("building_control_source_generations_run_source_unique").on(
      table.syncRunId,
      table.source,
    ),
    check(
      "building_control_source_generations_source_check",
      sql`${table.source} IN ('notice-publication', 'award-registration', 'notice-product', 'designation-history', 'award-classification')`,
    ),
    check(
      "building_control_source_generations_state_check",
      sql`${table.state} IN ('staging', 'complete', 'failed')`,
    ),
    check(
      "building_control_source_generations_count_check",
      sql`${table.observedCount} >= 0 AND ${table.observedCount} <= ${table.expectedCount}`,
    ),
    check(
      "building_control_source_generations_expected_count_check",
      sql`${table.expectedCount} >= 0`,
    ),
    check(
      "building_control_source_generations_page_count_check",
      sql`${table.pageCount} >= 0`,
    ),
    check(
      "building_control_source_generations_hash_check",
      sql`length(${table.identitySetHash}) = 64`,
    ),
    check(
      "building_control_source_generations_completion_check",
      sql`(${table.state} = 'complete') = (${table.completedAt} IS NOT NULL)`,
    ),
  ],
);

export const buildingControlGenerationMemberships = sqliteTable(
  "building_control_generation_memberships",
  {
    generationId: integer("generation_id")
      .notNull()
      .references(() => buildingControlSourceGenerations.id),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    identityHash: text("identity_hash").notNull(),
    sourceHash: text("source_hash").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.generationId,
        table.entityType,
        table.entityId,
        table.sourceHash,
      ],
    }),
    uniqueIndex("building_control_generation_memberships_identity_unique").on(
      table.generationId,
      table.identityHash,
    ),
    check(
      "building_control_generation_memberships_identity_hash_check",
      sql`length(${table.identityHash}) = 64`,
    ),
    check(
      "building_control_generation_memberships_source_hash_check",
      sql`length(${table.sourceHash}) = 64`,
    ),
  ],
);

export const buildingControlNotices = sqliteTable(
  "building_control_notices",
  {
    id: integer("id").primaryKey(),
    generationId: integer("generation_id")
      .notNull()
      .references(() => buildingControlSourceGenerations.id),
    noticeNo: text("notice_no").notNull(),
    noticeOrder: text("notice_order").notNull(),
    noticeName: text("notice_name").notNull(),
    publicationDate: text("publication_date").notNull(),
    demandAgencyCode: text("demand_agency_code"),
    demandAgencyName: text("demand_agency_name"),
    noticeUrl: text("notice_url"),
    status: text("status").notNull().default("unknown"),
    firstSeenAt: text("first_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    targetParentProductCode: text("target_parent_product_code"),
    targetDetailProductCode: text("target_detail_product_code"),
    rawJson: text("raw_json").notNull(),
    sourceHash: text("source_hash").notNull(),
  },
  (table) => [
    uniqueIndex("building_control_notices_identity_unique").on(
      table.generationId,
      table.noticeNo,
      table.noticeOrder,
      table.sourceHash,
    ),
    check(
      "building_control_notices_source_hash_check",
      sql`length(${table.sourceHash}) = 64`,
    ),
  ],
);

export const buildingControlNoticeProducts = sqliteTable(
  "building_control_notice_products",
  {
    id: integer("id").primaryKey(),
    generationId: integer("generation_id")
      .notNull()
      .references(() => buildingControlSourceGenerations.id),
    noticeId: integer("notice_id")
      .notNull()
      .references(() => buildingControlNotices.id),
    bidClassNo: text("bid_clsfc_no").notNull(),
    parentProductCode: text("parent_product_code"),
    detailProductCode: text("detail_product_code"),
    providerRowIdentity: text("provider_row_identity").notNull(),
    providerRowOrder: integer("provider_row_order"),
    exactMatch: integer("exact_match").notNull().default(0),
    rawJson: text("raw_json").notNull(),
    sourceHash: text("source_hash").notNull(),
  },
  (table) => [
    uniqueIndex("building_control_notice_products_identity_unique").on(
      table.generationId,
      table.noticeId,
      table.bidClassNo,
      table.providerRowIdentity,
      table.sourceHash,
    ),
    check(
      "building_control_notice_products_exact_match_check",
      sql`${table.exactMatch} IN (0, 1)`,
    ),
    check(
      "building_control_notice_products_source_hash_check",
      sql`length(${table.sourceHash}) = 64`,
    ),
  ],
);

export const buildingControlAwardRevisions = sqliteTable(
  "building_control_award_revisions",
  {
    id: integer("id").primaryKey(),
    generationId: integer("generation_id")
      .notNull()
      .references(() => buildingControlSourceGenerations.id),
    noticeId: integer("notice_id")
      .notNull()
      .references(() => buildingControlNotices.id),
    bidClassNo: text("bid_clsfc_no").notNull(),
    rebidNo: text("rbid_no").notNull(),
    providerResultIdentity: text("provider_result_identity").notNull(),
    finalAwardDate: text("final_award_date").notNull(),
    winnerBizNo: text("winner_biz_no").notNull(),
    winnerName: text("winner_name").notNull(),
    sourceStatus: text("source_status").notNull().default("final"),
    winnerRowsJson: text("winner_rows_json").notNull().default("[]"),
    fetchedAt: text("fetched_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    rawJson: text("raw_json").notNull(),
    sourceHash: text("source_hash").notNull(),
  },
  (table) => [
    uniqueIndex("building_control_award_revisions_identity_unique").on(
      table.generationId,
      table.noticeId,
      table.bidClassNo,
      table.rebidNo,
      table.providerResultIdentity,
      table.sourceHash,
    ),
    check(
      "building_control_award_revisions_source_hash_check",
      sql`length(${table.sourceHash}) = 64`,
    ),
  ],
);

export const buildingControlAwards = sqliteTable(
  "building_control_awards",
  {
    id: integer("id").primaryKey(),
    generationId: integer("generation_id")
      .notNull()
      .references(() => buildingControlSourceGenerations.id),
    noticeId: integer("notice_id")
      .notNull()
      .references(() => buildingControlNotices.id),
    selectedRevisionId: integer("selected_revision_id")
      .notNull()
      .references(() => buildingControlAwardRevisions.id),
    finalAwardDate: text("final_award_date").notNull(),
    winnerBizNo: text("winner_biz_no").notNull(),
    winnerName: text("winner_name").notNull(),
    awardAmount: integer("award_amount"),
    awardRate: text("award_rate"),
    finalResultIdentity: text("final_result_identity"),
    rawJson: text("raw_json"),
  },
  (table) => [
    uniqueIndex("building_control_awards_notice_unique").on(
      table.generationId,
      table.noticeId,
    ),
    index("building_control_awards_date_winner_idx").on(
      table.finalAwardDate,
      table.winnerBizNo,
    ),
  ],
);

export const excellentDesignations = sqliteTable(
  "excellent_designations",
  {
    id: integer("id").primaryKey(),
    certificateNo: text("etpm_dsgn_crfc_no").notNull(),
    demandNo: text("etpm_dsgn_dmnd_no").notNull(),
    changeOrder: text("dsgn_dmnd_chg_ord").notNull(),
    sequenceNo: text("etps_sqno").notNull(),
    designationNo: text("designation_no"),
    bizNoNormalized: text("biz_no_normalized"),
  },
  (table) => [
    uniqueIndex("excellent_designations_identity_unique").on(
      table.certificateNo,
      table.demandNo,
      table.changeOrder,
      table.sequenceNo,
    ),
  ],
);

export const excellentDesignationObservations = sqliteTable(
  "excellent_designation_observations",
  {
    id: integer("id").primaryKey(),
    generationId: integer("generation_id")
      .notNull()
      .references(() => buildingControlSourceGenerations.id),
    designationId: integer("designation_id")
      .notNull()
      .references(() => excellentDesignations.id),
    bizNoNormalized: text("biz_no_normalized").notNull(),
    companyName: text("company_name").notNull(),
    startDate: text("start_date").notNull(),
    originalEndDate: text("original_end_date"),
    extensionEndDate: text("extension_end_date"),
    effectiveEndDate: text("effective_end_date"),
    status: text("status").notNull(),
    productName: text("product_name").notNull(),
    classificationCodesJson: text("classification_codes_json").notNull(),
    terminationState: text("termination_state").notNull().default("unverified"),
    terminationEvidenceHash: text("termination_evidence_hash"),
    cancellationDate: text("cancellation_date"),
    revocationDate: text("revocation_date"),
    listIdentity: text("list_identity"),
    detailIdentity: text("detail_identity"),
    listRawJson: text("list_raw_json").notNull(),
    detailRawJson: text("detail_raw_json").notNull(),
    sourceHash: text("source_hash").notNull(),
  },
  (table) => [
    uniqueIndex("excellent_designation_observations_version_unique").on(
      table.designationId,
      table.generationId,
      table.sourceHash,
    ),
    index("excellent_designation_observations_biz_interval_idx").on(
      table.bizNoNormalized,
      table.startDate,
      table.effectiveEndDate,
    ),
    check(
      "excellent_designation_observations_status_check",
      sql`${table.status} IN ('', '유효', '만료', '효력정지')`,
    ),
    check(
      "excellent_designation_observations_source_hash_check",
      sql`length(${table.sourceHash}) = 64`,
    ),
  ],
);

export const awardClassifications = sqliteTable(
  "award_classifications",
  {
    id: integer("id").primaryKey(),
    generationId: integer("generation_id")
      .notNull()
      .references(() => buildingControlSourceGenerations.id),
    awardRevisionId: integer("award_revision_id")
      .notNull()
      .references(() => buildingControlAwardRevisions.id),
    designationGenerationId: integer("designation_generation_id")
      .notNull()
      .references(() => buildingControlSourceGenerations.id),
    rulesVersion: text("rules_version").notNull(),
    evaluatedAwardDate: text("evaluated_award_date").notNull(),
    category: text("category").notNull(),
    matchedObservationId: integer("matched_observation_id").references(
      () => excellentDesignationObservations.id,
    ),
    reason: text("reason").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("award_classifications_evidence_unique").on(
      table.generationId,
      table.awardRevisionId,
    ),
    check(
      "award_classifications_category_check",
      sql`${table.category} IN ('cooperative', 'excellent', 'non_excellent', 'incomplete')`,
    ),
    check(
      "award_classifications_evidence_hash_check",
      sql`length(${table.evidenceHash}) = 64`,
    ),
  ],
);

export const buildingControlCoverage = sqliteTable(
  "building_control_coverage",
  {
    id: integer("id").primaryKey(),
    generationId: integer("generation_id")
      .notNull()
      .unique()
      .references(() => buildingControlSourceGenerations.id),
    source: text("source").notNull(),
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to").notNull(),
    watermark: text("watermark"),
    complete: integer("complete").notNull(),
    expectedCount: integer("expected_count").notNull(),
    observedCount: integer("observed_count").notNull(),
    identitySetHash: text("identity_set_hash").notNull(),
    completedAt: text("completed_at").notNull(),
  },
  (table) => [
    check(
      "building_control_coverage_source_check",
      sql`${table.source} IN ('notice-publication', 'award-registration', 'notice-product', 'designation-history', 'award-classification')`,
    ),
    check(
      "building_control_coverage_complete_check",
      sql`${table.complete} IN (0, 1)`,
    ),
    check(
      "building_control_coverage_expected_check",
      sql`${table.expectedCount} >= 0`,
    ),
    check(
      "building_control_coverage_observed_check",
      sql`${table.observedCount} >= 0`,
    ),
    check(
      "building_control_coverage_hash_check",
      sql`length(${table.identitySetHash}) = 64`,
    ),
  ],
);

export const buildingControlMarketManifests = sqliteTable(
  "building_control_market_manifests",
  {
    id: integer("id").primaryKey(),
    syncRunId: integer("sync_run_id")
      .notNull()
      .references(() => buildingControlSyncRuns.id),
    createdAt: text("created_at").notNull(),
  },
);

export const buildingControlManifestSources = sqliteTable(
  "building_control_manifest_sources",
  {
    manifestId: integer("manifest_id")
      .notNull()
      .references(() => buildingControlMarketManifests.id, {
        onDelete: "cascade",
      }),
    source: text("source").notNull(),
    generationId: integer("generation_id")
      .notNull()
      .references(() => buildingControlSourceGenerations.id),
    coverageId: integer("coverage_id")
      .notNull()
      .references(() => buildingControlCoverage.id),
  },
  (table) => [
    primaryKey({ columns: [table.manifestId, table.source] }),
    uniqueIndex("building_control_manifest_sources_generation_unique").on(
      table.manifestId,
      table.generationId,
    ),
    check(
      "building_control_manifest_sources_source_check",
      sql`${table.source} IN ('notice-publication', 'award-registration', 'notice-product', 'designation-history', 'award-classification')`,
    ),
  ],
);

export const buildingControlActiveManifest = sqliteTable(
  "building_control_active_manifest",
  {
    singleton: integer("singleton").primaryKey(),
    manifestId: integer("manifest_id").references(
      () => buildingControlMarketManifests.id,
    ),
    version: integer("version").notNull(),
  },
  (table) => [
    check(
      "building_control_active_manifest_singleton_check",
      sql`${table.singleton} = 1`,
    ),
    check(
      "building_control_active_manifest_version_check",
      sql`${table.version} >= 0`,
    ),
  ],
);

export const buildingControlCollectorPlans = sqliteTable(
  "building_control_collector_plans",
  {
    id: integer("id").primaryKey(),
    planId: text("plan_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    requestSetHash: text("request_set_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("building_control_collector_plans_id_unique").on(table.planId),
    check(
      "building_control_collector_plans_hash_check",
      sql`length(${table.requestSetHash}) = 64`,
    ),
  ],
);

export const buildingControlSyncExpectedRequests = sqliteTable(
  "building_control_sync_expected_requests",
  {
    id: integer("id").primaryKey(),
    syncRunId: integer("sync_run_id")
      .notNull()
      .references(() => buildingControlSyncRuns.id),
    source: text("source").notNull(),
    role: text("role").notNull(),
    requestKey: text("request_key").notNull(),
    dependencyRequestId: integer("dependency_request_id").references(
      (): AnySQLiteColumn => buildingControlSyncExpectedRequests.id,
    ),
    collectorPlanId: text("collector_plan_id")
      .notNull()
      .references(() => buildingControlCollectorPlans.planId),
    canonicalQueryJson: text("canonical_query_json").notNull(),
    state: text("state").notNull(),
    sealedAt: text("sealed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("building_control_sync_expected_requests_run_key_unique").on(
      table.syncRunId,
      table.requestKey,
    ),
    index("building_control_sync_expected_requests_plan_idx").on(
      table.collectorPlanId,
      table.source,
    ),
    check(
      "building_control_sync_expected_requests_source_check",
      sql`${table.source} IN ('notice-publication', 'award-registration', 'notice-product', 'designation-history', 'award-classification')`,
    ),
    check(
      "building_control_sync_expected_requests_role_check",
      sql`${table.role} IN ('notice-publication-bulk', 'award-registration-bulk', 'notice-identity-lookup', 'designation-list-all', 'designation-detail')`,
    ),
    check(
      "building_control_sync_expected_requests_state_check",
      sql`${table.state} IN ('pending', 'sealed')`,
    ),
  ],
);

export const buildingControlSyncRequestSets = sqliteTable(
  "building_control_sync_request_sets",
  {
    syncRunId: integer("sync_run_id")
      .notNull()
      .references(() => buildingControlSyncRuns.id),
    source: text("source").notNull(),
    collectorPlanId: text("collector_plan_id")
      .notNull()
      .references(() => buildingControlCollectorPlans.planId),
    requestCount: integer("request_count").notNull(),
    requestSetHash: text("request_set_hash").notNull(),
    sealedAt: text("sealed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.syncRunId, table.source] }),
    index("building_control_sync_request_sets_plan_idx").on(
      table.collectorPlanId,
      table.source,
    ),
    check(
      "building_control_sync_request_sets_source_check",
      sql`${table.source} IN ('notice-publication', 'award-registration', 'notice-product', 'designation-history', 'award-classification')`,
    ),
    check(
      "building_control_sync_request_sets_count_check",
      sql`${table.requestCount} >= 1`,
    ),
    check(
      "building_control_sync_request_sets_hash_check",
      sql`length(${table.requestSetHash}) = 64`,
    ),
  ],
);

export const buildingControlGenerationBlocks = sqliteTable(
  "building_control_generation_blocks",
  {
    generationId: integer("generation_id")
      .primaryKey()
      .references(() => buildingControlSourceGenerations.id),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull(),
  },
);

export const buildingControlSyncCheckpoints = sqliteTable(
  "building_control_sync_checkpoints",
  {
    id: integer("id").primaryKey(),
    syncRunId: integer("sync_run_id")
      .notNull()
      .references(() => buildingControlSyncRuns.id),
    source: text("source").notNull(),
    expectedRequestId: integer("expected_request_id")
      .notNull()
      .references(() => buildingControlSyncExpectedRequests.id),
    requestKey: text("request_key").notNull(),
    cursorKind: text("cursor_kind").notNull(),
    nextCursor: integer("next_cursor").notNull(),
    pageSize: integer("page_size").notNull(),
    totalCount: integer("total_count"),
    observedCount: integer("observed_count").notNull().default(0),
    state: text("state").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex(
      "building_control_sync_checkpoints_run_source_request_unique",
    ).on(table.syncRunId, table.source, table.requestKey),
    check(
      "building_control_sync_checkpoints_source_check",
      sql`${table.source} IN ('notice-publication', 'award-registration', 'notice-product', 'designation-history', 'award-classification')`,
    ),
    check(
      "building_control_sync_checkpoints_cursor_kind_check",
      sql`${table.cursorKind} IN ('page', 'detail')`,
    ),
    check(
      "building_control_sync_checkpoints_state_check",
      sql`${table.state} IN ('collecting', 'complete')`,
    ),
    check(
      "building_control_sync_checkpoints_next_cursor_check",
      sql`${table.nextCursor} >= 1`,
    ),
    check(
      "building_control_sync_checkpoints_page_size_check",
      sql`${table.pageSize} >= 1`,
    ),
  ],
);

export const buildingControlSyncCheckpointPages = sqliteTable(
  "building_control_sync_checkpoint_pages",
  {
    id: integer("id").primaryKey(),
    checkpointId: integer("checkpoint_id")
      .notNull()
      .references(() => buildingControlSyncCheckpoints.id),
    cursor: integer("cursor").notNull(),
    pageSize: integer("page_size").notNull(),
    totalCount: integer("total_count").notNull(),
    factJson: text("fact_json").notNull(),
    identityHash: text("identity_hash").notNull(),
    sourceHash: text("source_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex(
      "building_control_sync_checkpoint_pages_checkpoint_cursor_unique",
    ).on(table.checkpointId, table.cursor),
    check(
      "building_control_sync_checkpoint_pages_cursor_check",
      sql`${table.cursor} >= 1`,
    ),
    check(
      "building_control_sync_checkpoint_pages_page_size_check",
      sql`${table.pageSize} >= 1`,
    ),
    check(
      "building_control_sync_checkpoint_pages_total_count_check",
      sql`${table.totalCount} >= 0`,
    ),
    check(
      "building_control_sync_checkpoint_pages_identity_hash_check",
      sql`length(${table.identityHash}) = 64`,
    ),
    check(
      "building_control_sync_checkpoint_pages_source_hash_check",
      sql`length(${table.sourceHash}) = 64`,
    ),
  ],
);

export const buildingControlAwardQuarantine = sqliteTable(
  "building_control_award_quarantine",
  {
    id: integer("id").primaryKey(),
    generationId: integer("generation_id")
      .notNull()
      .references(() => buildingControlSourceGenerations.id),
    noticeNo: text("notice_no"),
    noticeOrder: text("notice_order"),
    bidClassNo: text("bid_clsfc_no"),
    rbidNo: text("rbid_no"),
    providerResultIdentity: text("provider_result_identity").notNull(),
    registeredAt: text("registered_at"),
    finalAwardDate: text("final_award_date"),
    rawJson: text("raw_json").notNull(),
    sourceHash: text("source_hash").notNull(),
    reason: text("reason").notNull(),
    pageNo: integer("page_no").notNull(),
    pageIndex: integer("page_index").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex(
      "building_control_award_quarantine_generation_identity_unique",
    ).on(table.generationId, table.providerResultIdentity, table.sourceHash),
    check(
      "building_control_award_quarantine_source_hash_check",
      sql`length(${table.sourceHash}) = 64`,
    ),
    check(
      "building_control_award_quarantine_reason_check",
      sql`${table.reason} IN ('missing_final_award_date', 'invalid_award_row', 'product_correlation_blocked')`,
    ),
    check(
      "building_control_award_quarantine_page_no_check",
      sql`${table.pageNo} >= 1`,
    ),
    check(
      "building_control_award_quarantine_page_index_check",
      sql`${table.pageIndex} >= 0`,
    ),
  ],
);
