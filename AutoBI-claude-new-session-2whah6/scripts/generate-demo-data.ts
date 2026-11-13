/**
 * Writes the synthetic demo data kits to public/sample-data so they can be
 * downloaded from the app and attached to a new project.
 *   npx vite-node scripts/generate-demo-data.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { generateSampleData, generateRetailData, generatePharmaData, generateAccessData, SAMPLE_NARRATIVE, RETAIL_NARRATIVE, PHARMA_NARRATIVE, ACCESS_NARRATIVE } from '../src/lib/sampleData';
import { toCsv } from '../src/lib/util';

const root = path.resolve(__dirname, '../public/sample-data');
const write = (dir: string, file: string, content: string | Buffer) => {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, dir, file), content);
};

const hcp = generateSampleData();
write('hcp', 'account_master.csv', toCsv(hcp.accounts));
write('hcp', 'call_activity.csv', toCsv(hcp.calls));
write('hcp', 'email_activity.json', JSON.stringify(hcp.emails, null, 0));
write('hcp', 'campaign_master.csv', toCsv(hcp.campaigns));
write("hcp", "brief.txt", `Project: HCP Engagement & Performance Analytics\nPaste this requirement into "Describe the dashboard":\n\n${SAMPLE_NARRATIVE}\n`);

const retail = generateRetailData();
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(retail.stores), 'Stores');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(retail.products), 'Products');
write('retail', 'store_and_product_master.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
write('retail', 'sales_transactions.csv', toCsv(retail.sales));
write('retail', 'brief.txt', `Project: Retail Sales Performance\nPaste this requirement into "Describe the dashboard":\n\n${RETAIL_NARRATIVE}\n`);

const brand = generatePharmaData();
write('brand', 'hcp_universe.csv', toCsv(brand.hcps));
const twb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(twb, XLSX.utils.json_to_sheet(brand.territories), 'Alignment');
write('brand', 'territory_alignment.xlsx', XLSX.write(twb, { type: 'buffer', bookType: 'xlsx' }));
write('brand', 'rx_weekly.csv', toCsv(brand.rx));
write('brand', 'field_calls.json', JSON.stringify({ data: brand.calls }));
write('brand', 'brief.txt', `Project: Zentrava Brand Performance\nClient / BU: Oncology Brand Team\nAudience: Commercial leadership and district managers\nFrequency: Weekly\n\nPaste this requirement into "Describe the dashboard":\n\n${PHARMA_NARRATIVE}\n\nFiles to attach in the Data step:\n- hcp_universe.csv        HCP universe (specialty, decile, segment, territory, target flag)\n- territory_alignment.xlsx territory > district > region alignment with rep roster\n- rx_weekly.csv           weekly TRx / NRx by HCP and product (Zentrava vs competitors)\n- field_calls.json        field calls (channel, status, samples, key message)\n`);

const acc = generateAccessData();
write('access', 'sp_patient_journey.csv', toCsv(acc.journey));
write('access', 'payer_plan_pbm.csv', toCsv(acc.plans));
write('access', 'frm_cases.csv', toCsv(acc.cases));
write('access', 'product_master.csv', toCsv(acc.products));
// corrected payer file: the data owner adds the plan that 3 SP cases reference
write('access/corrections', 'payer_plan_pbm.csv', toCsv([...acc.plans, { Plan_ID: 'PL-9999', Plan_Name: 'Highmark BCBS PPO', Payer: 'BCBS (regional plans)', Channel: 'Commercial', PBM: 'Prime Therapeutics', Formulary_Status: 'Covered with PA' }]));
const awb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(awb, XLSX.utils.json_to_sheet(acc.hcps), 'HCPs');
XLSX.utils.book_append_sheet(awb, XLSX.utils.json_to_sheet(acc.territories), 'FRM Territories');
write('access', 'hcp_frm_alignment.xlsx', XLSX.write(awb, { type: 'buffer', bookType: 'xlsx' }));
write('access', 'brief.txt', `Project: Spacysla FRM Patient Funnel
Client / BU: Sanofi – Rare Blood Disorders, Patient Support Services
Audience: Field Reimbursement Managers (FRMs) and access leadership
Frequency: Weekly

Paste this requirement into "Describe the dashboard":

${ACCESS_NARRATIVE}

Files to attach in the Data step:
- sp_patient_journey.csv   specialty pharmacy patient journey: referral → benefits verification → PA → decision / appeal → therapy start
- payer_plan_pbm.csv       payer, plan, channel, PBM and formulary status
- hcp_frm_alignment.xlsx   sheet "HCPs" (HCP, specialty, institution, sales territory, FRM territory) and sheet "FRM Territories" (territory, region, FRM)
- frm_cases.csv            FRM case log: one row per access case (benefit investigation, PA support, appeal,
                           reimbursement support, query) with product, PSP / self-enrolled flags, status (Open / Escalated / Closed),
                           priority, escalation, open / first action / close dates
- product_master.csv       products (Spacysla, Qalvora) and their market

What the FRM view shows (ProcDNA FRM report layout):
- Reporting Foundation → "ProcDNA KPI Catalogue" tab: which Case and FRM Management catalogue metrics the data
  computes (and which need CRM / survey / finance data).
- Filters: Region, FRM Territory, Sales Territory, Market, Product, Account, PBM, Payer, time period (calendar YTD by default) and custom dates.
- Design Studio → page "Field Reimbursement Management": Cases, Time to Resolution, Resolution Rate by Case Type and
  Time to First Fill cards, Priority Prescribers with flags, Open Case Aging and the Case Overview list
  (Overall Cases / Escalated Cases; click a case to see where the patient is stuck).
- Page "FRM Performance": territory scorecard (highest / lowest), case volume by territory and product (open / escalated / closed),
  first response time and closure rate by month, product and territory, and case load vs resolution time.

Live change request for the demo (Step 4):
1. Requirements chat:  "FRMs also need to see HCPs where more than five patients are currently experiencing prior authorization delays."
2. Reporting Foundation → Describe a KPI:  "Patients with PA pending for more than 14 days"
3. Design assistant:  "Show HCPs with more than 5 patients with PA pending for more than 14 days to Patient Access Overview"

Planned test failure (Step 5), shows on every run:
  "Patient Activity ↔ Plan Master: 3 records reference a Plan_ID not present in Plan Master"
  (and the FRM cases of those patients: "Case Activity ↔ Plan Master: 4 records …").
  Fix: in the Data step upload corrections/payer_plan_pbm.csv (same file name → replaces the payer file,
  approvals are kept), then Testing → Run automated tests → both tests pass.
Also possible: if a "Total Patients" KPI counts rows instead of unique patients, the
  "counts each patient once" test fails (re-referred patients appear twice). Fix: KPI Definitions →
  edit the KPI → COUNT DISTINCT → re-run.
`);

for (const d of ['hcp', 'retail', 'brand', 'access']) console.log(d, fs.readdirSync(path.join(root, d)).map((f) => `${f} (${Math.round(fs.statSync(path.join(root, d, f)).size / 1024)} KB)`).join(', '));
