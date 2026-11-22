[日本語](KNOWN_ISSUES.md) | **English**

# Known issues affecting values, aggregates and Methods

This list covers bugs affecting extracted values, decisions, persistence, agreement, costs, exports or Methods text, including historical data that may need checking after an update. For display or usability issues and new features, see [CHANGELOG.md](CHANGELOG.md) and the related PRs. This list is not guaranteed to be exhaustive.

## Versions and records

- Version ranges include both endpoints. A fixed version is the first release containing the fix, rather than the package.json version present while the fix was being developed. Store publication dates may differ.
- Ranges were reconstructed from release merges, version bumps and fix commits on origin/master. Starts inferred from the original implementation are marked “estimated”. Early v0.1.0 development continued under the same version around public launch, so the contents of individual distributed builds cannot be established from the version alone.
- “Sheet” means your project's Google spreadsheet. Identify fields using `SchemaFields.field_id` / `field_name` / `entity_level` / `section`. `Evidence` holds original AI output, `StudyData` / `ResultsData` hold values per annotator, and `Decisions` holds decision history.
- Check `ExtractionRuns.extension_version` for the version used for extraction and `Decisions.app_version` for the version used for decisions, when recorded. Do not assume these columns exist or contain values in older rows. Blank means unknown, not unaffected.
- When the version is unknown, compare `ExtractionRuns.started_at`, `Decisions.decided_at`, `LLMApiLog.timestamp`, `prompt_version`, saved release zip files and contemporaneous work records. Dates alone cannot establish a version. Prompt versions and extension versions are different identifiers.
- Updating does not repair historical values, logs, exported CSVs or manuscript text. Back up the sheet and recalculate or export again with a fixed version or later. Where re-extraction is needed, compare against the paper and redo human verification and adjudication. Keep historical audit rows rather than deleting them in bulk.

## Overview

| ID | Symptom | Affected versions | Fixed version |
| --- | --- | --- | --- |
| KI-001 | One result split into separate rows across sections | v0.1.0 (estimated) to v0.32.0 | Mitigated in v0.32.0; splitting prevented in v0.33.0 |
| KI-002 | Result arm keys use names instead of numbers | v0.1.0 (estimated) to v0.12.0 | v0.13.0 |
| KI-003 | Duplicate data rows block saving and omit values from exports | v0.1.0 (estimated) to v0.8.0 | v0.9.0 |
| KI-004 | Partial Sheets writes treated as success | v0.1.0 (estimated) to v0.10.0 | v0.11.0 |
| KI-005 | Cached input charged at the ordinary rate in estimates | v0.1.0 (estimated) to v0.10.0 | v0.11.0 |
| KI-006 | Gemini thinking tokens omitted from costs | v0.1.0 (estimated) to v0.10.0 | v0.11.0 |
| KI-007 | OpenRouter estimates preferred over reported costs | v0.1.0 (estimated) to v0.10.0 | v0.11.0 |
| KI-008 | Paper questions omitted from costs; log upload failures lose responses | Questions: v0.11.0 to v0.19.1; upload failures: v0.1.0 (estimated) to v0.19.1 | v0.20.0 |
| KI-009 | Extraction ignores the reasoning effort configured in Options | v0.7.0 to v0.19.1 | v0.20.0 |
| KI-010 | Methods claims procedures or completion unsupported by records | v0.2.0 to v0.19.1 | v0.20.0 |
| KI-011 | Agreement and pilot aggregates include blank or unfinished work | Agreement and pilot: v0.2.0 (estimated) to v0.19.1 | v0.20.0 |
| KI-012 | Agreement ignores corrected arm mappings | v0.2.0 (estimated) | v0.3.0 |
| KI-013 | Abstract findings or Methods design fields may be marked unreported | v0.23.0 to v0.32.0 | v0.33.0 |
| KI-014 | The tiab-review included list contains duplicates or AI decisions not in use | v0.2.0 (estimated) to v0.34.0 | v0.35.0 |
| KI-015 | The same column name appears twice in the R set ma.csv header | v0.2.0 (estimated) to v0.36.0 | v0.36.1 |
| KI-016 | An export right after confirming a version uses the previous table design | v0.1.0 (estimated) to v0.36.0 | v0.36.1 |
| KI-017 | The same column name appears twice in the R set tab1.csv header | v0.2.0 (estimated) to v0.36.1 | v0.36.2 |
| KI-018 | study_label appears twice in the study_wide.csv header | v0.1.0 (estimated) to v0.36.1 | v0.36.2 |

## Checks and remedies

### KI-001 Results split into rows across sections

- Symptom: separate section calls can assign different `entity_key` strings to the same result, creating separate verification and export rows with many apparently empty cells.
- Affected versions: v0.1.0 (estimated, initial section splitting in `06e90ff9`) to v0.32.0. Prompt version 15 in v0.32.0 mitigates the problem by asking later calls to reuse earlier keys. v0.33.0 sends all outcome_result fields together to prevent splitting caused by separate section calls.
- Check: within the same `Evidence.run_id` / `study_id`, look for outcome_result fields belonging to different `SchemaFields.section` values whose keys differ despite referring to the same result. Compare `ResultsData.study_id` / `field_id` / `entity_key` / `value` too. Take care not to merge genuinely different results.
- Remedy: on v0.33.0 or later, start again from extraction in a new project for the affected studies, check the paper, and redo verification, adjudication and exports. Re-extracting in the same project leaves rows with decisions or adjudications under old keys, and those rows are also included in CSV exports.
- Related: [PR #473](https://github.com/youkiti/sr-data-extraction-plugin/pull/473), [PR #476](https://github.com/youkiti/sr-data-extraction-plugin/pull/476).

### KI-002 Non-numeric arm keys in result-only batches

- Symptom: batches without arm fields lacked arm-numbering instructions. Using arm names in keys can break arm correspondence and result matching.
- Affected versions: v0.1.0 (estimated, initial result-key instructions) to v0.12.0. v0.13.0 introduced numbering instructions in prompt version 11 and rejection of invalid keys.
- Check: check that the part after `arm:` in `Evidence.entity_key` / `ResultsData.entity_key` is a positive integer and corresponds to the same arm in `ArmStructures.arm_key`, matching by `study_id`. For example, `arm:placebo` is invalid.
- Remedy: update and re-extract affected results, check the paper and arm structure, and redo decisions. Replacing strings in old keys cannot establish the correct arm correspondence.
- Related: [PR #302](https://github.com/youkiti/sr-data-extraction-plugin/pull/302).

### KI-003 Concurrent saves create duplicates and block later saves or exports

- Symptom: concurrent decision or adjudication writes could create rows with duplicate keys and block later transfers and saves. Duplicate human StudyData rows could also exclude a study from final-value exports.
- Affected versions: v0.1.0 (estimated, read-then-append annotation implementation) to v0.8.0. v0.9.0 introduced serialized writes and duplicate resolution when reading.
- Check: find duplicate `StudyData.study_id` / `annotator` combinations, or duplicate `ResultsData.study_id` / `annotator` / `entity_key` / `field_id` combinations. Compare their `updated_at` and values. Check whether the expected `action` / `value` reached `Decisions`.
- Remedy: after updating, the row with the greatest `updated_at` wins, with the lower row winning ties. Historical rows remain. Compare the selected value with decision history, redo unsaved decisions, and export again. Serialization within a browser does not guarantee serialization across devices.
- Related: [PR #238](https://github.com/youkiti/sr-data-extraction-plugin/pull/238), [PR #240](https://github.com/youkiti/sr-data-extraction-plugin/pull/240).

### KI-004 Extraction succeeds despite partially saved rows

- Symptom: any HTTP 2xx Sheets response was treated as success, even if fewer rows were written than requested. An observed run was marked done with only 1 of 69 Evidence rows saved. Missing values, evidence or decisions could go unnoticed.
- Affected versions: v0.1.0 (estimated, append response row counts unchecked) to v0.10.0. Fixed in v0.11.0.
- Check: compare `ExtractionRuns.run_id` / `study_ids` / `field_ids` / `status` with `Evidence.run_id` / `study_id` / `field_id`, and compare saved output with the response at `LLMApiLog.response_ref`. Compare `Decisions.study_id` / `field_id` / `action` with work records too. Empty historical `warnings` do not establish that nothing was lost.
- Remedy: update, re-extract missing data and redo verification. The fix treats partial saves as failures and records `evidence_row_count` in `ExtractionRuns.warnings`. Check existing rows before resending, since an unconditional retry after partial saving can create duplicates.
- Related: [PR #250](https://github.com/youkiti/sr-data-extraction-plugin/pull/250).

### KI-005 Cache discounts omitted from estimates

- Symptom: cached input tokens were estimated at the ordinary input rate, overstating costs. Older records may lack the data needed to calculate discounts.
- Affected versions: v0.1.0 (estimated, initial estimator) to v0.10.0. Fixed in v0.11.0.
- Check: compare `LLMApiLog.provider` / `model` / `tokens_in` / `cost_estimate_usd` with usage and cache information in `response_ref`. `cached_tokens_in` may be blank or absent in rows predating its introduction.
- Remedy: use retained responses, historical prices and provider billing records to check historical costs. Updating does not rewrite old `cost_estimate_usd` values. Distinguish estimated and billed costs in research reports.
- Related: [PR #257](https://github.com/youkiti/sr-data-extraction-plugin/pull/257).

### KI-006 Gemini thinking tokens omitted from output costs

- Symptom: only response text tokens were counted, understating recorded output tokens and costs for responses with thinking. Pre-run estimates also omitted thinking.
- Affected versions: v0.1.0 (estimated, initial Gemini usage handling) to v0.10.0. Fixed in v0.11.0.
- Check: for `LLMApiLog.provider=gemini`, compare `tokens_out` / `cost_estimate_usd` with `usageMetadata.candidatesTokenCount` / `thoughtsTokenCount` in `response_ref`. Historical `ExtractionRuns.tokens_out` / `cost_estimate` totals are also affected.
- Remedy: if the original response remains, recalculate using text plus thinking tokens at historical prices and compare against billing. Without the response, the missing amount cannot be recovered precisely. The fix applies to subsequent records and estimates.
- Related: [PR #269](https://github.com/youkiti/sr-data-extraction-plugin/pull/269).

### KI-007 OpenRouter estimates used instead of reported costs

- Symptom: estimates from static prices took precedence over response `usage.cost`. A deepseek-v4-flash record was half the reported cost; this ratio does not apply to all models.
- Affected versions: v0.1.0 (estimated, initial OpenRouter estimation) to v0.10.0. Fixed in v0.11.0.
- Check: for `LLMApiLog.provider=openrouter`, compare `model` / `cost_estimate_usd` with `usage.cost` in `response_ref` or provider billing.
- Remedy: correct historical reporting from responses or billing records. Updated versions prefer a finite non-negative `usage.cost` when available, but leave old rows unchanged.
- Related: [PR #272](https://github.com/youkiti/sr-data-extraction-plugin/pull/272).

### KI-008 Questions omitted from costs; log upload failures also lose responses

- Symptom: question log rows with empty reference URLs were mistaken for warning-only rows and excluded from costs and usage. Separately, failure to save a log payload to Drive could lose both a billed response and its log row, potentially preventing extracted values from reaching the caller.
- Affected versions: question aggregation from its introduction in v0.11.0 to v0.19.1; payload upload failures from v0.1.0 (estimated, initial logger) to v0.19.1. Fixed in v0.20.0.
- Check: find `LLMApiLog.purpose=ask_paper` rows with empty `prompt_ref` / `response_ref` but populated `latency_ms` / `tokens_in` / `tokens_out` / `cost_estimate_usd`, and compare with historical usage.csv files and totals. Lost log rows cannot be identified from the sheet alone: compare `ExtractionRuns.status`, contemporaneous errors and billing records.
- Remedy: update and regenerate cost aggregates and exports for questions. Missing responses and costs are not automatically recovered. Re-run failed extractions and check against the paper. The fix retains responses and log rows despite payload upload failures, marking `prompt_summary` with `[payload_upload_failed]`.
- Related: [PR #388](https://github.com/youkiti/sr-data-extraction-plugin/pull/388).

### KI-009 Configured reasoning effort not passed to extraction

- Symptom: pilot, full extraction and failed-study retries did not pass the reasoning effort configured in Options. Actual conditions could differ from the selected conditions, affecting extracted values and settings described in Methods.
- Affected versions: from the setting's introduction in v0.7.0 to v0.19.1. Fixed in v0.20.0. Unsupported settings or settings equal to the provider default may make no difference.
- Check: compare `ExtractionRuns.provider` / `requested_model` / `started_at`, contemporaneous Options records and settings retained at `LLMApiLog.prompt_ref` only where actual sent values were recorded. Blank historical `reasoning_effort` / `sent_settings` columns added later do not establish what was sent. Historical Options values alone cannot establish the actual sent settings.
- Remedy: describe confirmed actual settings in Methods, identifying unknowns as unknown. If extraction under specified conditions is required, update and repeat extraction and verification, starting with a pilot.
- Related: [PR #388](https://github.com/youkiti/sr-data-extraction-plugin/pull/388).

### KI-010 Methods asserts procedures unsupported by project records

- Symptom: statements about drafting, piloting, revision, extraction of all fields for all studies, verification of every cell, independent extraction or completed adjudication could differ from actual work. Drafting and extraction models were not distinguished either.
- Affected versions: v0.2.0 to v0.19.1.
  The store release of v0.2.0 includes the Methods card, while v0.1.0 is thought not to include it, though this cannot be established because the submitted commit was not recorded.
  Fixed in v0.20.0.
- Check: compare previously copied text with `ExtractionRuns.run_type` / `status` / `study_ids` / `field_ids`, `LLMApiLog.purpose` / `model` / `error` / `prompt_summary`, `StudyData` / `ResultsData.annotator_type`, and `Decisions.action`. In particular, check `[batch_failed]` / `[transfer_failed]`, unverified cells and whether consensus rows exist.
- Remedy: regenerate the text after updating, check it against what was actually done, and revise the manuscript. The currently installed extension version may differ from the version used for historical extraction. Do not claim procedures that older records cannot establish.
- Related: [PR #390](https://github.com/youkiti/sr-data-extraction-plugin/pull/390) (`2b881c79` / `4eea8fcf`).

### KI-011 Agreement and pilot statistics include blank or unfinished work

- Symptom: adjudication counted cells blank for both reviewers as agreement and allowed bulk adoption. Agreement reports included studies with unfinished verification. Pilot aggregates mixed unreviewed cells into errors, and human not-reported decisions were not counted as acceptance when the AI also reported nothing.
- Affected versions: agreement and pilot from v0.2.0 (estimated, first release containing their introduction) to v0.19.1. The both-blank adjudication behavior was also present in v0.2.0. Fixed in v0.20.0.
- Check: compare the two reviewers' `annotator` / `value` in `StudyData` / `ResultsData` for the same study, field and entity_key, together with `Decisions.action` / `annotator` / `field_id`. Distinguish blank cells from verified not-reported decisions. Compare `Evidence.not_reported` with human `not_reported` decisions, and compare historical agreement, kappa and pilot CSVs with regenerated statistics.
- Remedy: finish both reviewers' verification and regenerate agreement and pilot statistics with a fixed version. If blank cells were previously bulk-adopted, check `Decisions.annotator_type=consensus` values against the paper and redo decisions as needed.
- Related: [PR #391](https://github.com/youkiti/sr-data-extraction-plugin/pull/391).

### KI-012 Agreement uses positional keys despite corrected arm mappings

- Symptom: even after B's arms were correctly mapped in adjudication, agreement reports compared B's raw keys, potentially counting cells as disagreements when adjudication showed agreement.
- Affected versions: v0.2.0 (estimated, after arm mapping and agreement were introduced). Fixed in v0.3.0.
- Check: for the same `study_id`, compare the confirmed consensus mapping in `ArmStructures.annotator` / `version` / `note` with `ResultsData.annotator` / `entity_key` / `field_id` / `value`. Historical agreement and kappa for studies with reordered arms are affected.
- Remedy: check arm correspondence and regenerate statistics and exports with a fixed version. If consensus arm structure is unconfirmed, confirm the mapping first.
- Related: [PR #146](https://github.com/youkiti/sr-data-extraction-plugin/pull/146) (`780f147c`).

### KI-013 Abstract findings and Methods design fields may be omitted

- Symptom: the rule limiting outcome_result extraction to the study's own results could be applied too strictly to abstract-only findings or design fields such as tests, scales and thresholds described in Methods, marking them unreported. Not every run is affected.
- Affected versions: v0.23.0, which introduced the rule, to v0.32.0 (prompt versions 13 to 15). Fixed in v0.33.0 (version 16).
- Check: inspect `LLMApiLog.prompt_version` and `Evidence.study_id` / `field_id` / `entity_key` / `not_reported` / `value`, comparing outcome_result design fields and abstract-only findings with the PDF's Methods and Abstract. Check missing `ResultsData.value` too. For older logs lacking the column, inspect retained payloads.
- Remedy: re-extract affected fields on v0.33.0 or later and verify against the paper. Version 16 explicitly includes Abstract findings as the study's own results and permits design fields to be extracted from Methods or Abstract.
- Related: [PR #477](https://github.com/youkiti/sr-data-extraction-plugin/pull/477), rule introduced in [PR #417](https://github.com/youkiti/sr-data-extraction-plugin/pull/417).

### KI-014 The tiab-review included list differs from tiab-review's own decisions

- Symptom: when loading the included list from tiab-review, references removed as duplicates in tiab-review (rows whose `References.duplicate_of` is not blank) were still counted as candidates. Full-text candidates were also decided using decisions from AI runs not in use. The included list and counts were shown even before the tiab-review key was opened. Only the set of imported references is affected. Extracted values and decisions made after import are not changed.
- Affected versions: v0.2.0 (estimated), which introduced the tiab-review hand-off, to v0.34.0. Fixed in v0.35.0.
- Check: confirm that no reference with a non-blank `References.duplicate_of` in the tiab-review sheet was imported into this extension's `Studies` / `Documents`. Compare full-text candidates with those decided only by the run in use in tiab-review's `LLM_Runs` and its `LLM_Executions` decisions. If import counts were used in a PRISMA diagram or Methods, check those numbers too.
- Remedy: reload the included list on v0.35.0 or later and compare candidates and counts. Exclude documents imported in error on the import screen (the exclusion remains recorded for audit). Correct any counts reported in the manuscript.
- Related: [PR #510](https://github.com/youkiti/sr-data-extraction-plugin/pull/510), [issue #480](https://github.com/youkiti/sr-data-extraction-plugin/issues/480), hand-off introduced in `c3fd3ec1`.

### KI-015 Key columns and field names collide in the ma.csv header

- Symptom: when the table design had an outcome_result field with the same name as an ma.csv key column, such as `outcome_id` or `timepoint`, the same column name appeared twice in the header of the R set ma.csv and ma_status.csv. R's `read.csv` renames the later column (for example `outcome_id.1`), and Python's `csv.DictReader` lets the later column (the field value) overwrite the earlier one (the key). AI drafts sometimes created fields with these names. Values in the sheet are not changed.
- Affected versions: v0.2.0 (estimated), which introduced the R set, to v0.36.0. Fixed in v0.36.1. Only projects whose table design has an outcome_result field with a key column name are affected.
- Check: in `SchemaFields`, look for rows with `entity_level=outcome_result` whose `field_name` is one of `study_id`, `study_label`, `outcome_id`, `outcome_label`, `timepoint`, `timepoint_value`, `timepoint_unit`, `arm_id`, `arm_label`, `rob_tool`, `rob_overall_judgement` or `schema_version`. Also check that no column name appears twice in the first row of exported ma.csv files. For any R or Python analysis that read such a file, confirm that the key columns were read correctly.
- Remedy: export the R set again on v0.36.1 or later. Colliding fields are renamed to `<name>_field` (with numbered suffixes for further collisions), so update column names in analysis code. v0.36.1 asked for a rename when the table design was saved; from v0.36.2, existing fields can be saved as they are.
- Related: [PR #551](https://github.com/youkiti/sr-data-extraction-plugin/pull/551), [issue #549](https://github.com/youkiti/sr-data-extraction-plugin/issues/549), R set introduced in `d17b463a`.

### KI-016 An export right after confirming a version keeps the previous table design

- Symptom: after the export screen had been opened once, confirming a new version in the table design and returning to the export screen in the same tab built the CSV files and R set from data assembled with the previous fields and outcome list. The verification, dashboard and adjudication screens also kept showing the previous content. Reloading the page, or reloading on the export screen, used the new version. Values in the sheet are not changed.
- Affected versions: v0.1.0 (estimated) to v0.36.0. With the outcome list (v0.36.0), it also left removed outcomes in exports. Fixed in v0.36.1.
- Check: compare `SchemaVersions.created_at` with the time each exported file was made. Files exported in the same tab after confirming a version, without reloading the page, are affected. For an R set, check that `schema_version` in export_manifest (and `outcome_list_schema_version` in list mode) matches the latest version at the time of export.
- Remedy: export the affected files again on v0.36.1 or later.
- Related: [PR #554](https://github.com/youkiti/sr-data-extraction-plugin/pull/554), [issue #547](https://github.com/youkiti/sr-data-extraction-plugin/issues/547).

### KI-017 Key columns and field names collide in the tab1.csv header

- Symptom: when the table design had a study-level field with the same name as a tab1.csv key column, such as `study_label`, `registration_id` or `n_documents`, the same column name appeared twice in the header of the R set tab1.csv and tab1_status.csv. R's `read.csv` renames the later column (for example `registration_id.1`), and Python's `csv.DictReader` lets the later column (the field value) overwrite the earlier one (the key). Values in the sheet are not changed. This is the same kind of collision as KI-015 (ma.csv).
- Affected versions: v0.2.0 (estimated), which introduced the R set, to v0.36.1. Fixed in v0.36.2. Only projects whose table design has a study-level field with a key column name are affected.
- Check: in `SchemaFields`, look for rows with `entity_level=study` whose `field_name` is `study_label`, `registration_id` or `n_documents`. Also check that no column name appears twice in the first row of exported tab1.csv files. For any R or Python analysis that read such a file, confirm that the key columns (such as the trial registration number) were read correctly.
- Remedy: export the R set again on v0.36.2 or later. Colliding fields are renamed to `<name>_field` (with numbered suffixes for further collisions), so update column names in analysis code. Existing fields can stay as they are without renaming (StudyData stores columns by field name, so renaming would not carry verified values to the new column).
- Related: [issue #553](https://github.com/youkiti/sr-data-extraction-plugin/issues/553), KI-015, R set introduced in `d17b463a`.

### KI-018 study_label collides in the study_wide.csv header

- Symptom: when the table design had a study-level field named `study_label`, the `study_wide.csv` header contained `study_label` twice: the leading column (the study label from Studies) and the field's own column. R's `read.csv` renames the later column to `study_label.1`, and Python's `csv.DictReader` lets the later column (the field value) overwrite the earlier one (the study label). Values in the sheet are not changed. This is the same kind of collision as KI-017 (tab1.csv). From v0.36.2 new fields can no longer use this name, but existing fields are still allowed.
- Affected versions: v0.1.0 (estimated) to v0.36.1. Fixed in v0.36.2. Only projects whose table design has a study-level field named `study_label` are affected.
- Check: in `SchemaFields`, look for rows with `entity_level=study` and `field_name` `study_label`. Also check that `study_label` does not appear twice in the first row of exported study_wide.csv files. For any analysis or Table 1 built from such a file, confirm that the study label column was read correctly.
- Remedy: export study_wide.csv again on v0.36.2 or later. That field's column is named `study_label_field` (with numbered suffixes for further collisions), so update column names in analysis code. Multi-select 1/0 columns, the `__source` columns of AI drafts and the values in `consult_fields` keep the original field name.
- Related: [issue #561](https://github.com/youkiti/sr-data-extraction-plugin/issues/561), KI-017.

## Version evidence

Principal commits containing fixed-version bumps: v0.3.0 `3cab8541`, v0.9.0 `7e3e95cc`, v0.11.0 `189a24b2`, v0.13.0 `be45c85f`, v0.20.0 `a486e0d8`, v0.32.0 `654b44bf`, v0.33.0 `878c6313`. Methods was introduced in `fffeb545`, reasoning effort configuration in `f4c2c845`, and paper questions in `66a08abe`. Ranges come from matching introductions to release boundaries, not verification of individual store packages.
