# Market Basis Split

## Approved behavior

- `나라장터 공고`: one final awarded target notice counts as one market fact.
- `종합쇼핑몰`: one final shopping-mall delivery request for detailed product code `3912180101` counts as one market fact.
- `통합`: the selected notice facts and shopping-mall facts are concatenated and counted together.
- Year, quarter, nationwide/Busan filtering and excellent-company classification apply identically to all three modes.
- Remove the generic public-standard-contract scan. It is not part of these modes and currently causes the provider page-format error.
- Use the same basis wording in the UI and Excel export.

## Verification

- One focused report test covers all three totals.
- Existing market MVP tests and the production build must pass.
