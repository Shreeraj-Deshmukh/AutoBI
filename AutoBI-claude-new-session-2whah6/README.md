# Celestra — Agentic Reporting Lifecycle Platform (POC)

Celestra takes a reporting project from a natural-language business requirement and raw data to a working interactive dashboard, tested reporting scenarios, analyst UAT and final documentation — in one orchestrated workflow.

```
Business Requirement → Data Understanding → Reporting Foundation → Approved Design → Working Dashboard → Testing & UAT → Documentation
```

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (engine, ingestion, dates, full agent pipelines)
npm run e2e        # Playwright end-to-end lifecycle tests
npm run build      # static build in dist/
```

## AI model: Azure AI Foundry

Celestra calls Azure AI Foundry for language tasks:

- extracting requirements from the brief and running the requirements chat
- writing business descriptions of datasets and columns
- turning free-form design requests into wireframe edits
- writing the executive summary in the documentation

Calculations, data mapping, dashboards and test validation always stay deterministic, so every number can be checked.

```bash
cp .env.example .env.local   # fill in the values below, then restart the server
AZURE_AI_ENDPOINT=https://<resource>.services.ai.azure.com/models   # or https://<resource>.openai.azure.com
AZURE_AI_API_KEY=<key>
AZURE_AI_MODEL=gpt-4o                                               # deployment / model name
```

- **The key stays on the server.** The browser only calls `/api/ai/*`, and the Celestra server (`npm run dev` or `npm run preview`) forwards those calls to Azure (`server/azureFoundry.ts`).
- **The AI Model page shows the connection.** It shows the status, has a *Test connection* button, and lets you switch AI on or off.
- **Every run says which engine produced it.** If an AI call fails, the agent falls back to its deterministic engine and the run says so.
- **Only metadata is sent.** That means column names, types and a few example values. Full rows never are.

## Deploying to Vercel

The AI and warehouse proxies run as Vercel Functions (`api/ai/*`, `api/warehouse/*`), using the same code as the local server in `server/`.

1. Import the repository in Vercel. The framework (Vite), build command and output directory come from `vercel.json`.
2. Under **Settings → Environment Variables**, add `AZURE_AI_ENDPOINT`, `AZURE_AI_API_KEY`, `AZURE_AI_MODEL` and optionally `AZURE_AI_API_VERSION` (plus the Databricks or Snowflake variables if used). Mark the key as **Sensitive**, and select every environment you deploy to (Production and, if you use them, Preview).
3. Redeploy. Environment variables only apply to deployments made after they were saved.

Do **not** prefix these variables with `VITE_`: Vite inlines `VITE_*` variables into the public JavaScript bundle. The key is read only inside the function at request time. The browser receives the model name and endpoint host, never the key.

## Databricks & Snowflake

In the Data step, click **Databricks / Snowflake**, enter the connection details or use the ones configured on the server, browse a catalog and schema, and import tables.

- **Databricks** uses the SQL Statement Execution API.
- **Snowflake** uses the SQL API v2.
- **Credentials stay on the Celestra server.** Calls go through `/api/warehouse/*` (`server/warehouses.ts`), so the browser never receives a token. Server-side defaults can be set in `.env.local` (see `.env.example`).
- **Hosts and identifiers are validated.** Only real Databricks and Snowflake hosts are accepted, and catalog/schema/table names are checked before they go into a query.
- **Imports are capped** at 200,000 rows per table.

## Patient access (FRM) demo storyline

`public/sample-data/access/brief.txt` has the requirement, the files, the live change request and the planned test failure. In short:

1. **Requirements:** paste the brief. The AI writes objectives, user stories, KPIs, filters and rules.
2. **Data:** attach the three files. The agents profile the data and join the specialty-pharmacy journey to plans and PBMs, and to HCPs and FRM territories.
3. **Reporting Foundation:** KPIs such as patients awaiting PA, PA approval rate, average time to therapy and drop-off rate are proposed and validated against the actual values.
4. **Design:** a dashboard in three sections — Patient Funnel, Access Barriers and FRM Actionability. Then make the change request:
   - **KPI:** in *Describe a KPI*, enter "patients with PA pending for more than 14 days".
   - **Visual:** in the design assistant, enter "Show HCPs with more than 5 patients delayed in PA".
5. **Testing:** "Total Patients counts each patient once" fails because re-referrals are counted twice. Fix it by changing the aggregation to COUNT DISTINCT, then re-run. Row-level security for each FRM is tested too.
6. **Release:** View the dashboard as an FRM to see territory-restricted data, generate the documentation, then publish after UAT.

## Field mapping

The reporting name of each field (Reporting Foundation → Field Mapping) is the label used on filters, axes, legends, table headers, exports, test cases and new visual titles. Renaming a field also updates titles in a draft design.

Unticking **Include** removes the field from Design Studio choices and from newly generated designs. Visuals that still use an excluded field are flagged in the wireframe and fail validation in Development.

## Company branding

Dashboards and wireframes follow the company layout: page tabs at the top, filters below them, and the logo in the top-right corner. The logo file is `public/brand/procdna-logo.png`; replace it to change the brand mark.

## Demo data kits

Two synthetic data kits are included for client demos. They are in `public/sample-data/`, and you can regenerate them with `npm run demo-data`.

| Kit | Files | Seeded data issues |
|---|---|---|
| HCP Engagement | `account_master.csv`, `call_activity.csv`, `email_activity.json`, `campaign_master.csv` | 4 calls with unknown accounts, 2 duplicate calls, 5 missing specialties |
| Patient Access (FRM) | `sp_patient_journey.csv`, `payer_plan_pbm.csv`, `hcp_frm_alignment.xlsx` (HCPs + FRM Territories) | 5 re-referred patients (duplicate Patient_ID), 3 cases with an unknown Plan_ID, 4 HCPs without specialty |
| Brand Performance | `hcp_universe.csv`, `territory_alignment.xlsx`, `rx_weekly.csv`, `field_calls.json` | 6 Rx rows for unknown HCPs, 8 HCPs without decile, 3 duplicate calls, 4 calls without channel |
| Retail Sales | `store_and_product_master.xlsx` (2 sheets), `sales_transactions.csv` | 3 sales with unknown products, 8 blank channels |

To use a kit:

1. On **New project**, pick a kit to pre-fill the brief.
2. In the Data step, click the kit name to attach its files.

You can also download the files from the Projects page and upload them yourself.

On first load a preloaded demo project, **HCP Engagement & Performance Analytics**, is created from **synthetic sample data**, labelled as such everywhere. It has gone through the whole lifecycle up to analyst UAT. You can reset it from the Home page. You can also create a new project and upload your own CSV, XLSX or JSON files.

## Architecture

| Layer | Location | Notes |
|---|---|---|
| Domain model | `src/types.ts` | Structured artifacts exchanged between agents |
| Agents | `src/agents/*` | `requirementAgent`, `dataAgent`, `foundationAgent`, `designAgent`, `developmentAgent`, `testingAgent` (+ `validators`), `documentationAgent` |
| Orchestrator | `src/store/orchestrator.ts` | State machine, approval gates, agent invocation with visible steps, version history, downstream "needs review" propagation |
| Semantic engine | `src/lib/engine.ts` | Evaluates KPIs, groupings, time series and tables over ingested rows; resolves filters through many-to-one joins |
| Dashboard renderer | `src/dashboard/*` | Configuration-driven: renders a `DashboardSpec` (pages, components, filters) with Recharts; wireframe editor |
| Ingestion & profiling | `src/lib/ingest.ts`, `src/lib/profile.ts` | PapaParse, SheetJS, JSON; type and role inference, keys, relationships, data-quality checks |
| Persistence | `src/store/store.ts`, `src/lib/rowStore.ts` | Project state is kept in localStorage and uploaded rows in IndexedDB. Data never leaves the browser. |

### Agents and LLMs

All seven agents are **deterministic rules engines**. No external AI service is called, and the UI says so on every run ("Deterministic engine (no LLM configured)"). Each agent takes structured inputs and returns structured outputs, so you can connect a real LLM later through the provider interface in `src/agents/llm.ts` without changing the orchestrator or UI.

### Testing is evidence-based

Automated tests (KPI recomputation, category and series reconciliation, roll-ups, filter application, period logic, join integrity, duplicates, outliers…) recompute each dashboard output **independently from the raw source rows** (`src/agents/validators.ts`, a separate join/filter/aggregation code path) and compare. A test is only marked Passed after that reconciliation succeeds, or after an analyst marks it in UAT. The sample data deliberately contains 4 orphan account references and 2 duplicate call records, so 2 business QC scenarios genuinely fail and raise defects.

### POC boundaries

- No Power BI `.pbix` file is produced and Power BI Desktop is not needed. The dashboard is a code-based web component.
- No physical data mart, warehouse or ETL. The Reporting Foundation is a simulated, interactive modelling workspace, and joins happen at query time.
- Everything runs in the browser, so data volume is limited by browser memory.
