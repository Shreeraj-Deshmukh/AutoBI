import type { CatalogueMetric } from '@/types';

/**
 * ProcDNA Reporting KPI Catalogue v2 — sheet "Case and FRM Management".
 * Generated from "ProcDNA Reporting KPI Catalogue_v2.xlsx"; edit the workbook and regenerate rather than hand-editing.
 * The agents use it as the reference vocabulary for FRM / case-management reporting:
 * metric names, business definitions, computations and recommended visuals.
 */
export const KPI_CATALOGUE: CatalogueMetric[] = [
 {
  "category": "Case Management",
  "name": "Total Cases Received",
  "definition": "Number of new patient support cases opened in the period.",
  "computation": "COUNT(case_id) WHERE case_create_date BETWEEN period_start AND period_end",
  "dataSource": "Case Management System ,Hub, CRM",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Bar/Column Chart, Monthly/Quarterly/Yearly Line Chart, Stacked Bar/Column (by case type/region), KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Total Cases Closed",
  "definition": "Number of cases closed/resolved in the period.",
  "computation": "COUNT(case_id) WHERE case_status = 'Closed' AND close_date BETWEEN period_start AND period_end",
  "dataSource": "Case Management System ,Hub, CRM",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Bar/Column Chart, Monthly/Quarterly/Yearly Line Chart, Stacked Bar/Column, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Open Case Backlog",
  "definition": "Number of active/open cases at period end.",
  "computation": "COUNT(case_id) WHERE case_status IN ('Open','Pending') AS OF period_end_date",
  "dataSource": "Case Management System ,Hub, CRM",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart (by region), Stacked Bar, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Average Case Resolution Time (days)",
  "definition": "Average days taken to resolve a case.",
  "computation": "AVG(DATEDIFF(day, case_create_date, close_date)) FOR cases closed in period",
  "dataSource": "Case Management System",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart (by case type), KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Median Case Resolution Time (days)",
  "definition": "Median days taken to resolve cases (less sensitive to outliers).",
  "computation": "MEDIAN(DATEDIFF(day, case_create_date, close_date)) FOR cases closed in period",
  "dataSource": "Case Management System",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "First Contact Resolution Rate (%)",
  "definition": "Share of cases resolved on the first contact.",
  "computation": "COUNT(case_id WHERE contacts = 1 AND status='Closed') / COUNT(closed cases) * 100",
  "dataSource": "Case Management System",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Average Time to First Response (hrs)",
  "definition": "Avg time between case creation and first agent response.",
  "computation": "AVG(DATEDIFF(hour, case_create_date, first_response_timestamp))",
  "dataSource": "Case Management System",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Case Escalation Rate (%)",
  "definition": "Share of cases escalated to higher-tier support.",
  "computation": "COUNT(cases escalated) / COUNT(total cases) * 100",
  "dataSource": "Case Management System",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, Stacked Bar, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Cases per Case Manager",
  "definition": "Avg number of active cases owned by each case manager.",
  "computation": "COUNT(active cases) GROUP BY case_manager -> AVG()",
  "dataSource": "Case Management System",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Bar/Column Chart (by manager), Monthly/Quarterly/Yearly Line Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Case Reopen Rate (%)",
  "definition": "Share of closed cases that were reopened within X days.",
  "computation": "COUNT(reopened_cases within X days) / COUNT(closed cases) * 100",
  "dataSource": "Case Management System",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Benefit Verification Turnaround Time (hrs)",
  "definition": "Avg time to complete benefit verification.",
  "computation": "AVG(DATEDIFF(hour, bv_request_time, bv_completion_time))",
  "dataSource": "Case Management System , Payer responses",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Prior Authorization (PA) Submission Rate (%)",
  "definition": "Share of eligible patients for whom PA was submitted.",
  "computation": "COUNT(PA submissions) / COUNT(eligible prescriptions) * 100",
  "dataSource": "Case Management System , Rx orders",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart (by payer), Stacked Bar, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "PA Approval Rate (%)",
  "definition": "Share of PA submissions that received payer approval.",
  "computation": "COUNT(PA approved) / COUNT(PA submitted) * 100",
  "dataSource": "Payer, Claims data ,Case Management System",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart (by payer), Stacked Bar (approved vs denied), Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "PA Denial Rate (%)",
  "definition": "Share of PA submissions denied by payer.",
  "computation": "COUNT(PA denied) / COUNT(PA submitted) * 100",
  "dataSource": "Payer, Claims data",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart (by payer), Pie Chart, Donut Chart, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Appeal Success Rate (%)",
  "definition": "Share of appealed denials overturned to approval.",
  "computation": "COUNT(appeals approved) / COUNT(appeals submitted) * 100",
  "dataSource": "Case Management System , Payer decisions",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Time to Therapy Start (days)",
  "definition": "Avg days from enrollment or prescription to therapy initiation.",
  "computation": "AVG(DATEDIFF(day, enrollment_date OR rx_date, therapy_start_date))",
  "dataSource": "Case Management System ,Hub ,claims",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Time to First Fill (days)",
  "definition": "Avg days between prescription and first pharmacy fill.",
  "computation": "AVG(DATEDIFF(day, prescription_date, first_fill_date))",
  "dataSource": "Rx claims , Hub data",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Prescription Abandonment Rate (%)",
  "definition": "Share of new prescriptions not filled within X days.",
  "computation": "COUNT(new Rx with no fill within X days) / COUNT(new Rx) * 100",
  "dataSource": "Rx claims + EHR/Rx orders",
  "vendors": "Provider Data, Interactions/Activity Data",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Medication Adherence (MPR or PDC %)",
  "definition": "Measure of how consistently patients refill medication.",
  "computation": "MPR = (sum days_supply dispensed during period) / period_days; PDC = days covered / period_days",
  "dataSource": "Pharmacy claims",
  "vendors": "Provider Data, MIRFs",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart (by cohort), Stacked Bar, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Treatment Persistence Rate (%)",
  "definition": "Share of patients remaining on therapy at 6/12 months.",
  "computation": "COUNT(patients with continuous refills for X months) / COUNT(starters) *100",
  "dataSource": "Pharmacy claims",
  "vendors": "Provider Data, MIRFs",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Copay Assistance Utilization (%)",
  "definition": "Share of eligible patients who used copay assistance.",
  "computation": "COUNT(patients receiving copay aid) / COUNT(copay-eligible patients) * 100",
  "dataSource": "Copay Program System , Case Management System, Hub",
  "vendors": "Provider Data, MIRFs",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Financial Assistance Utilization (count)",
  "definition": "Number of patients receiving PAP/grants in period.",
  "computation": "COUNT(distinct patient_id WHERE assistance_granted_date BETWEEN period)",
  "dataSource": "PAP system , Case Management System, Hub",
  "vendors": "Provider Data, MIRFs",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Bar/Column Chart, Monthly/Quarterly/Yearly Line Chart, Pie Chart, Donut Chart, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Avg Out-of-Pocket Cost per Fill",
  "definition": "Average patient-paid amount per dispense.",
  "computation": "AVG(patient_copay + coinsurance) FROM pharmacy_claims per fill",
  "dataSource": "Pharmacy claims",
  "vendors": "Provider Data, MIRFs",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart (by payer), Waterfall Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Triage-to-Shipment Rate (%)",
  "definition": "Share of triages that result in medication shipment.",
  "computation": "COUNT(cases with shipment) / COUNT(triages) * 100",
  "dataSource": "Case Management System,Hub , SP shipping logs",
  "vendors": "Provider Data, MIRFs",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Funnel Chart, Sankey Diagram, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Manual Intervention Rate (per case)",
  "definition": "Avg number of manual steps required per case.",
  "computation": "AVG(number_of_manual_tasks_logged per case)",
  "dataSource": "Case Management System",
  "vendors": "Provider Data, MIRFs",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Script-to-Ship Time (days)",
  "definition": "Avg time between script received and medication shipped.",
  "computation": "AVG(DATEDIFF(day, script_date, ship_date))",
  "dataSource": "Case Management System,Hub , SP shipping logs",
  "vendors": "Provider Data, MIRFs",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "No-Show / Failed Delivery Rate (%)",
  "definition": "Share of scheduled deliveries that failed or were not received.",
  "computation": "COUNT(failed deliveries) / COUNT(scheduled deliveries) * 100",
  "dataSource": "SP shipping logs",
  "vendors": "Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "Patient Onboarding Completion Rate (%)",
  "definition": "Share of enrolled patients who complete onboarding tasks.",
  "computation": "COUNT(onboarded patients) / COUNT(enrolled patients) *100",
  "dataSource": "Case Management System, Hub , onboarding system",
  "vendors": "In-house,IQVIA, Cencora (Lash), EVERSANA,Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Funnel Chart, Bar/Column Chart, Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "Case Management",
  "name": "High-Risk Patient Identification Rate (%)",
  "definition": "Share of patients flagged as high-risk for access/adherence issues.",
  "computation": "COUNT(flagged_high_risk) / COUNT(active patients) *100",
  "dataSource": "Case Management System, Hub , risk model outputs",
  "vendors": "In-house , Analytics vendor,IQVIA, Cencora (Lash), EVERSANA,Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": true,
   "accountType": false
  }
 },
 {
  "category": "FRM Management",
  "name": "Total HCP Contacts (calls/visits)",
  "definition": "Total provider contacts made by FRMs in period.",
  "computation": "COUNT(contact_id) WHERE contact_type IN ('call','visit') AND date BETWEEN period",
  "dataSource": "CRM activity logs",
  "vendors": "Veeva",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Bar/Column Chart, Monthly/Quarterly/Yearly Line Chart, Stacked Bar (by call type), KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "HCP Contacts per FRM",
  "definition": "Average number of HCP contacts logged per FRM rep.",
  "computation": "COUNT(contacts) GROUP BY frm_rep -> AVG()",
  "dataSource": "CRM activity logs",
  "vendors": "Veeva",
  "isKpi": false,
  "visuals": "Bar/Column Chart (by FRM), Monthly/Quarterly/Yearly Line Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Call Objective Completion Rate (%)",
  "definition": "Share of FRM calls where planned objective was met.",
  "computation": "COUNT(calls with objective_met_flag) / COUNT(total calls) *100",
  "dataSource": "CRM activity logs",
  "vendors": "Veeva",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Field Time Utilization (%)",
  "definition": "Share of available work hours spent in field activities.",
  "computation": "(sum(field_hours_logged) / sum(total_work_hours_available)) *100",
  "dataSource": "Time tracking , CRM",
  "vendors": "In-house , Veeva",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "FRM Training Hours",
  "definition": "Total training hours completed by FRMs.",
  "computation": "SUM(training_hours) FROM LMS records for FRM team",
  "dataSource": "LMS , HR systems",
  "vendors": "In-house",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Bar/Column Chart, Monthly/Quarterly/Yearly Line Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "PA Submission Rate (FRM-driven) (%)",
  "definition": "Share of PAs submitted that involved FRM intervention.",
  "computation": "COUNT(PA_submissions_flagged_FRM) / COUNT(total PA submissions) *100",
  "dataSource": "CRM , Case Management System, Hub logs",
  "vendors": "Veeva , IQVIA, Cencora (Lash), EVERSANA,Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart (by payer), Stacked Bar, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "PA Approval Rate (FRM-driven) (%)",
  "definition": "Approval rate for PAs where FRM assisted.",
  "computation": "COUNT(PA_approved_flag_FRM) / COUNT(PA_submitted_flag_FRM) *100",
  "dataSource": "Payer , Claims , CRM flags",
  "vendors": "Veeva, Surgery, IQVIA Rx/Mx/Patient, SHS Claims, MNIT Claims, Definitive, Optum Claims, Patient Details, Diagnosis/Medical/Procedure Claims, Komodo Health, PTD Claims",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart (by payer), Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "First-Fill Conversion Rate (FRM-influenced) (%)",
  "definition": "Share of patients starting therapy after FRM engagement.",
  "computation": "COUNT(patients with fill within X days of FRM engagement) / COUNT(patients engaged) *100",
  "dataSource": "CRM , Rx claims",
  "vendors": "Veeva Surgery, IQVIA Rx/Mx/Patient, SHS Claims, MNIT Claims, Definitive, Optum Claims, Patient Details, Diagnosis/Medical/Procedure Claims, Komodo Health, PTD Claims",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Funnel Chart, Sankey Diagram, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Denial Overturn Rate (FRM) (%)",
  "definition": "Share of denials overturned after FRM appeal.",
  "computation": "COUNT(denials_overturned_with_FRM_support) / COUNT(denials FRM engaged) *100",
  "dataSource": "Case Management System, hub , payer decisions",
  "vendors": "IQVIA , Komodo, Cencora (Lash), EVERSANA,Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics, Komodo Health",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Cases Assigned to FRM (count)",
  "definition": "Number of access cases routed to FRM team.",
  "computation": "COUNT(case_id WHERE assigned_team='FRM')",
  "dataSource": "Case Management System, Hub , CRM",
  "vendors": "In-house , Veeva, IQVIA, Cencora (Lash), EVERSANA,Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Bar/Column Chart, Monthly/Quarterly/Yearly Line Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Cases Closed by FRM (count)",
  "definition": "Number of FRM-assigned cases resolved in period.",
  "computation": "COUNT(case_id WHERE assigned_team='FRM' AND status='Closed')",
  "dataSource": "Case Management System, Hub",
  "vendors": "In-house, IQVIA, Cencora (Lash), EVERSANA,Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Bar/Column Chart, Monthly/Quarterly/Yearly Line Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "FRM Response Time (days)",
  "definition": "Avg days from case referral to first FRM action.",
  "computation": "AVG(DATEDIFF(day, referral_date, first_FRM_action_date))",
  "dataSource": "CRM , Case Management System, Hub timestamps",
  "vendors": "Veeva , In-house,IQVIA, Cencora (Lash), EVERSANA,Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Provider Satisfaction (FRM)",
  "definition": "HCP satisfaction with FRM interactions (survey).",
  "computation": "AVG(survey_score) FROM provider_feedback WHERE event = FRM_interaction",
  "dataSource": "Survey system , CRM feedback",
  "vendors": "In-house , Veeva",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "FRM Program NPS",
  "definition": "Net Promoter Score for FRM services among HCPs.",
  "computation": "NPS calculation from survey responses (promoters - detractors)",
  "dataSource": "Survey system",
  "vendors": "In-house",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Educational Events by FRM (count)",
  "definition": "Number of HCP educational sessions delivered by FRMs.",
  "computation": "COUNT(event_id WHERE host='FRM' AND date BETWEEN period)",
  "dataSource": "CRM , Event logs",
  "vendors": "Veeva",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Bar/Column Chart, Monthly/Quarterly/Yearly Line Chart, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "HCP Coverage Penetration (%)",
  "definition": "Share of target HCPs that received at least one FRM contact.",
  "computation": "COUNT(target HCPs with >=1 contact) / COUNT(target HCPs) *100",
  "dataSource": "CRM, Target list",
  "vendors": "Veeva",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart (by territory), Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "HCP Reach Rate (%)",
  "definition": "Share of HCPs in territory engaged during period.",
  "computation": "COUNT(HCPs_contacted in territory) / COUNT(HCPs_in_territory) *100",
  "dataSource": "CRM , Master HCP list",
  "vendors": "Veeva , IQVIA",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "HCP Activation Rate (%)",
  "definition": "Share of engaged HCPs who take a desired action (e.g., submit PA).",
  "computation": "COUNT(HCPs_with_desired_action) / COUNT(HCPs_engaged) *100",
  "dataSource": "CRM , PA logs",
  "vendors": "Veeva , Case Hub",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Funnel Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Field-driven Enrollment Rate (%)",
  "definition": "Share of patient enrollments attributed to FRM activity.",
  "computation": "COUNT(enrollments flagged FRM_source) / COUNT(total enrollments) *100",
  "dataSource": "Case Management System, Hub , CRM flags",
  "vendors": "In-house , Veeva,IQVIA, Cencora (Lash), EVERSANA,Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Funnel Chart, Sankey Diagram, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Field-influenced Conversion Rate (%)",
  "definition": "Share of FRM-influenced opportunities converting to therapy starts.",
  "computation": "COUNT(starters flagged FRM_influence) / COUNT(opportunities FRM touched) *100",
  "dataSource": "CRM , Rx claims",
  "vendors": "Veeva Surgery, IQVIA Rx/Mx/Patient, SHS Claims, MNIT Claims, Definitive, Optum Claims, Patient Details, Diagnosis/Medical/Procedure Claims, Komodo Health, PTD Claims",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Funnel Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "FRM Visit Effectiveness (actions per visit)",
  "definition": "Avg number of actions (PAs started, enrollments) per FRM visit.",
  "computation": "SUM(actions_logged during visits) / COUNT(visits)",
  "dataSource": "CRM activity logs",
  "vendors": "Veeva",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart (by FRM), KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "FRM Travel Time (hrs)",
  "definition": "Avg travel hours per FRM (logistics efficiency).",
  "computation": "AVG(travel_time_logged) FROM travel logs",
  "dataSource": "CRM , Time logs",
  "vendors": "In-house, Veeva",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "FRM Cost per Contact (USD)",
  "definition": "Average cost incurred per HCP contact by FRM.",
  "computation": "SUM(frm_team_costs) / COUNT(HCP_contacts)",
  "dataSource": "Financials , CRM activity",
  "vendors": "Finance systems , Veeva",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Waterfall Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "FRM ROI (starts per $)",
  "definition": "Return on FRM investment measured by therapy starts per dollar spent.",
  "computation": "COUNT(therapy_starts attributed to FRM) / SUM(costs for FRM program)",
  "dataSource": "CRM , Finance ,Rx claims",
  "vendors": "In-house , Veeva,Surgery, IQVIA Rx/Mx/Patient, SHS Claims, MNIT Claims, Definitive, Optum Claims, Patient Details, Diagnosis/Medical/Procedure Claims, Komodo Health, PTD Claims",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Waterfall Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Denials by Reason (count)",
  "definition": "Breakdown of denials by payer reason codes for FRM attention.",
  "computation": "GROUP BY denial_reason_code COUNT(denial_id)",
  "dataSource": "Payer claims , Case Management System, Hub",
  "vendors": "Cencora (Lash), EVERSANA,Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics, Surgery, IQVIA Rx/Mx/Patient, SHS Claims, MNIT Claims, Definitive, Optum Claims, Patient Details, Diagnosis/Medical/Procedure Claims, Komodo Health, PTD Claims",
  "isKpi": false,
  "visuals": "Stacked Bar Chart, Bar/Column Chart, Pie Chart, Donut Chart, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Denial Rate by Payer (%)",
  "definition": "Share of claims/PA denied by each payer.",
  "computation": "COUNT(denials WHERE payer= X) / COUNT(submissions WHERE payer=X) *100",
  "dataSource": "Payer claims",
  "vendors": "Surgery, IQVIA Rx/Mx/Patient, SHS Claims, MNIT Claims, Definitive, Optum Claims, Patient Details, Diagnosis/Medical/Procedure Claims, Komodo Health, PTD Claims",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart (by payer), Stacked Bar, Pie Chart, Donut Chart, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Appeals Turnaround Time (days)",
  "definition": "Avg days from appeal submission to decision.",
  "computation": "AVG(DATEDIFF(day, appeal_submit_date, appeal_decision_date))",
  "dataSource": "Case Management System, Hub , Payer responses",
  "vendors": "IQVIA , Cencora (Lash), EVERSANA, Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, Komodo Health,Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, RareMed Hub, Onco360, McKesson Biologics",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "FRM Case Backlog (count)",
  "definition": "Number of FRM-assigned cases open past SLA.",
  "computation": "COUNT(cases WHERE assigned_team='FRM' AND days_open > SLA_days)",
  "dataSource": "Case Management System, Hub",
  "vendors": "In-house, IQVIA, Cencora (Lash), EVERSANA, Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "FRM Cycle Time (days)",
  "definition": "Avg days taken by FRM to fully resolve assigned cases.",
  "computation": "AVG(DATEDIFF(day, FRM_assignment_date, FRM_case_close_date))",
  "dataSource": "CRM , Case Management System, Hub",
  "vendors": "Veeva , In-house,IQVIA, Cencora (Lash), EVERSANA,Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "FRM Case Escalation Rate (%)",
  "definition": "Share of FRM cases escalated to clinical or legal teams.",
  "computation": "COUNT(FRM cases escalated) / COUNT(FRM cases) *100",
  "dataSource": "Case Management System, Hub",
  "vendors": "In-house,IQVIA, Cencora (Lash), EVERSANA,Sales Transactions, Patient Statistics SP/SD/HUB Shipments & Inventory, Copay Enrollments and transactions, PANTHERx, RareMed Hub, Onco360, McKesson Biologics",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Average Time Spent per HCP (mins)",
  "definition": "Average duration of a single HCP interaction.",
  "computation": "AVG(duration_minutes) FROM CRM contact logs",
  "dataSource": "CRM",
  "vendors": "Veeva",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "Field-driven PA Win Lift (%)",
  "definition": "Percent improvement in PA approvals in FRM-targeted HCPs vs baseline.",
  "computation": "(ApprovalRate_target - ApprovalRate_baseline)/ApprovalRate_baseline *100",
  "dataSource": "CRM , Payer approvals",
  "vendors": "Veeva , IQVIA, Komodo Health",
  "isKpi": true,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Waterfall Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 },
 {
  "category": "FRM Management",
  "name": "HCP Follow-up Compliance (%)",
  "definition": "Share of HCPs who adhered to agreed follow-up actions post-FRM visit.",
  "computation": "COUNT(HCPs completing follow-up actions) / COUNT(HCPs with planned follow-ups) *100",
  "dataSource": "CRM, Follow-up logs",
  "vendors": "Veeva",
  "isKpi": false,
  "visuals": "Monthly/Quarterly/Yearly Line Chart, Bar/Column Chart, Pie Chart, Donut Chart, KPI Card, Table",
  "granularity": {
   "geographyLevel": true,
   "geographyName": true,
   "product": true,
   "payer": false,
   "accountType": true
  }
 }
];
