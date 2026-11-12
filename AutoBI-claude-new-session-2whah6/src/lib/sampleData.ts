import type { Row } from '@/types';
import { seeded, pad } from './util';

/**
 * SYNTHETIC SAMPLE DATA — deterministic (seeded) so KPI totals, charts and
 * automated tests are reproducible. This is not real client data.
 *
 * A handful of realistic data-quality issues are deliberately included so the
 * Data Intelligence and Testing agents have something real to detect:
 *  - 4 call records reference Account_IDs that do not exist in the Account Master
 *  - 6 accounts have a missing Specialty
 *  - 2 call records are exact duplicates
 */

const REGIONS: Record<string, Record<string, string[]>> = {
  Northeast: { 'NE-Boston': ['MA', 'NH', 'ME'], 'NE-New York': ['NY', 'NJ'], 'NE-Philadelphia': ['PA', 'DE'] },
  Southeast: { 'SE-Atlanta': ['GA', 'SC'], 'SE-Miami': ['FL'], 'SE-Charlotte': ['NC', 'VA'] },
  Midwest: { 'MW-Chicago': ['IL', 'WI'], 'MW-Detroit': ['MI', 'OH'], 'MW-Minneapolis': ['MN', 'IA'] },
  West: { 'W-Los Angeles': ['CA'], 'W-Seattle': ['WA', 'OR'], 'W-Denver': ['CO', 'UT'] },
  Southwest: { 'SW-Dallas': ['TX', 'OK'], 'SW-Phoenix': ['AZ', 'NM'] },
};
const SPECIALTIES = ['Cardiology', 'Oncology', 'Endocrinology', 'Primary Care', 'Neurology', 'Rheumatology'] as const;
const FIRST = ['Sarah', 'James', 'Priya', 'Michael', 'Elena', 'David', 'Aisha', 'Robert', 'Mei', 'Carlos', 'Laura', 'Ahmed', 'Grace', 'Daniel', 'Sofia', 'Thomas', 'Nina', 'Kevin', 'Hannah', 'Omar', 'Julia', 'Samuel', 'Rachel', 'Victor'];
const LAST = ['Chen', 'Patel', 'Johnson', 'Garcia', 'Okafor', 'Nguyen', 'Miller', 'Rossi', 'Kim', 'Hernandez', 'Schmidt', 'Haddad', 'Walker', 'Sato', 'Dubois', 'Brennan', 'Kowalski', 'Mendes', 'Larsen', 'Ibrahim', 'Fischer', 'Moreau'];

export const SAMPLE_START = Date.UTC(2025, 10, 3); // Mon 3 Nov 2025
export const SAMPLE_END = Date.UTC(2026, 9, 30); // Fri 30 Oct 2026
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface SampleBundle {
  accounts: Row[];
  calls: Row[];
  emails: Row[];
  campaigns: Row[];
}

let cache: SampleBundle | null = null;

export function generateSampleData(): SampleBundle {
  if (cache) return cache;
  const r = seeded(20251103);

  // ── Account Master ──
  const accounts: Row[] = [];
  const territories: { region: string; territory: string; states: string[] }[] = [];
  for (const [region, terrs] of Object.entries(REGIONS)) for (const [territory, states] of Object.entries(terrs)) territories.push({ region, territory, states });
  const usedNames = new Set<string>();
  for (let i = 1; i <= 240; i++) {
    const t = territories[(i * 5) % territories.length]; // 5 is coprime with 14 → all territories used
    let name = '';
    do name = `Dr. ${r.pick(FIRST)} ${r.pick(LAST)}`;
    while (usedNames.has(name));
    usedNames.add(name);
    const tier = r.weighted([['Tier 1', 20], ['Tier 2', 35], ['Tier 3', 45]] as const);
    accounts.push({
      Account_ID: `A${pad(1000 + i, 4)}`,
      Account_Name: name,
      Specialty: i % 41 === 0 ? null : r.pick(SPECIALTIES),
      Region: t.region,
      Territory: t.territory,
      State: r.pick(t.states),
      Account_Tier: tier,
    });
  }

  // ── Campaign Master ──
  const campaignDefs: [string, string, number, number][] = [
    ['CardioPlus Launch', 'Product Launch', 0, 120],
    ['Winter Clinical Data Series', 'Education', 30, 150],
    ['Diabetes Care Update', 'Education', 90, 230],
    ['Spring Congress Invitation', 'Event', 140, 200],
    ['Patient Support Program', 'Awareness', 160, 330],
    ['Oncology Pathway Insights', 'Education', 210, 330],
    ['Formulary Access Update', 'Awareness', 250, 361],
    ['Autumn Symposium Invitation', 'Event', 300, 361],
  ];
  const campaigns: Row[] = campaignDefs.map(([n, type, s, e], i) => ({
    Campaign_ID: `CMP${pad(i + 1, 2)}`,
    Campaign_Name: n,
    Campaign_Type: type,
    Start_Date: iso(SAMPLE_START + s * DAY),
    End_Date: iso(SAMPLE_START + e * DAY),
  }));
  const templateByType: Record<string, string[]> = {
    'Product Launch': ['Launch Announcement', 'Product Overview'],
    Education: ['Clinical Data Update', 'Webinar Recap'],
    Event: ['Event Invitation', 'Event Reminder'],
    Awareness: ['Patient Support Program', 'Formulary Update'],
  };

  // ── Call Activity ──
  const calls: Row[] = [];
  const segOf = (tier: string) =>
    tier === 'Tier 1'
      ? r.weighted([['High Prescriber', 60], ['Growth', 30], ['Maintain', 10]] as const)
      : tier === 'Tier 2'
        ? r.weighted([['Growth', 50], ['Maintain', 30], ['High Prescriber', 10], ['Emerging', 10]] as const)
        : r.weighted([['Emerging', 50], ['Maintain', 35], ['Growth', 15]] as const);
  const repOf = (territory: string) => `R${pad(territories.findIndex((t) => t.territory === territory) * 2 + 1 + r.int(0, 1), 3)}`;
  const totalDays = Math.round((SAMPLE_END - SAMPLE_START) / DAY) + 1;
  let callN = 0;
  for (let d = 0; d < totalDays; d++) {
    const t = SAMPLE_START + d * DAY;
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const month = new Date(t).getUTCMonth();
    const growth = 1 + (d / totalDays) * 0.35; // engagement grows over the year
    const seasonal = month === 11 || month === 7 ? 0.65 : 1; // Dec / Aug dip
    const base = 17 * growth * seasonal;
    const n = Math.max(0, Math.round(base + (r.next() - 0.5) * 8));
    for (let k = 0; k < n; k++) {
      const tierPick = r.weighted([['Tier 1', 50], ['Tier 2', 32], ['Tier 3', 18]] as const);
      const pool = accounts.filter((a) => a.Account_Tier === tierPick);
      const acc = r.pick(pool);
      callN++;
      calls.push({
        Call_ID: `C${pad(callN, 6)}`,
        Account_ID: acc.Account_ID,
        Call_Date: iso(t),
        Call_Type: r.weighted([['In-Person', 55], ['Virtual', 30], ['Phone', 15]] as const),
        Segment: segOf(String(acc.Account_Tier)),
        Representative_ID: repOf(String(acc.Territory)),
      });
    }
  }
  // Data quality issues (documented above)
  const orphanIds = ['A9001', 'A9002', 'A9001', 'A9003'];
  orphanIds.forEach((id, i) => {
    callN++;
    calls.push({ Call_ID: `C${pad(callN, 6)}`, Account_ID: id, Call_Date: iso(SAMPLE_START + (60 + i * 70) * DAY), Call_Type: 'Phone', Segment: 'Emerging', Representative_ID: 'R001' });
  });
  calls.push({ ...calls[120] }, { ...calls[2400] });

  // ── Email Activity ──
  const emails: Row[] = [];
  let emailN = 0;
  for (let ci = 0; ci < campaigns.length; ci++) {
    const c = campaigns[ci];
    const [, type, s, e] = campaignDefs[ci];
    const targets = accounts.filter((_, i) => (i + ci * 3) % (type === 'Event' ? 3 : 2) === 0);
    const waves = type === 'Event' ? 2 : 3;
    for (let w = 0; w < waves; w++) {
      const sendDay = s + Math.round(((e - s) / waves) * w) + r.int(0, 5);
      for (const acc of targets) {
        if (r.next() < 0.12) continue;
        let t = SAMPLE_START + Math.min(sendDay + r.int(0, 3), totalDays - 1) * DAY;
        const dow = new Date(t).getUTCDay();
        if (dow === 0) t += DAY;
        if (dow === 6) t += 2 * DAY;
        if (t > SAMPLE_END) t = SAMPLE_END;
        const progress = (t - SAMPLE_START) / (SAMPLE_END - SAMPLE_START);
        const delivery = r.weighted([['Delivered', 93], ['Bounced', 5], ['Failed', 2]] as const);
        const openP = (acc.Account_Tier === 'Tier 1' ? 0.4 : acc.Account_Tier === 'Tier 2' ? 0.32 : 0.24) + progress * 0.08;
        emailN++;
        emails.push({
          Email_ID: `E${pad(emailN, 6)}`,
          Account_ID: acc.Account_ID,
          Campaign_ID: c.Campaign_ID,
          Sent_Date: iso(t),
          Delivery_Status: delivery,
          Open_Status: delivery === 'Delivered' && r.next() < openP ? 'Opened' : 'Not Opened',
          Email_Template: templateByType[type][w % 2],
        });
      }
    }
  }
  emails.sort((a, b) => String(a.Sent_Date).localeCompare(String(b.Sent_Date)));

  cache = { accounts, calls, emails, campaigns };
  return cache;
}

export const SAMPLE_FILES = [
  { key: 'accounts', fileName: 'account_master.csv' },
  { key: 'calls', fileName: 'call_activity.csv' },
  { key: 'emails', fileName: 'email_activity.csv' },
  { key: 'campaigns', fileName: 'campaign_master.csv' },
] as const;

export const SAMPLE_NARRATIVE =
  'Build a dashboard to monitor HCP engagement across regions. I want to understand calls made by different account segments, compare activity by account tier, track email campaign performance, and identify changes in engagement over time. The dashboard should allow filtering by region, territory, call type, and reporting period.';

// ───────────────────────── Retail demo kit (second domain) ─────────────────────────
/**
 * SYNTHETIC retail sales data used to show Celestra is not tied to one domain.
 * Includes deliberate issues: 3 sales reference an unknown Product_ID, 8 rows have a blank Channel.
 */
export function generateRetailData() {
  const r = seeded(424242);
  const regions: Record<string, string[]> = { North: ['Leeds', 'Manchester', 'Newcastle'], South: ['London', 'Brighton', 'Southampton'], Midlands: ['Birmingham', 'Nottingham'], Scotland: ['Glasgow', 'Edinburgh'] };
  const stores: Row[] = [];
  let n = 0;
  for (const [region, cities] of Object.entries(regions))
    for (const city of cities)
      for (let k = 0; k < 2; k++) {
        n++;
        stores.push({ Store_ID: `ST${pad(n, 3)}`, Store_Name: `${city} ${k ? 'Retail Park' : 'High Street'}`, Region: region, City: city, Store_Format: k ? 'Retail Park' : 'High Street', Opened_Year: 2008 + ((n * 3) % 14) });
      }
  const cats: Record<string, [string, number][]> = {
    Apparel: [['Denim Jacket', 79], ['Cotton T-Shirt', 18], ['Wool Jumper', 55], ['Chinos', 45]],
    Footwear: [['Running Shoe', 95], ['Leather Boot', 130], ['Canvas Trainer', 48]],
    Accessories: [['Leather Belt', 29], ['Backpack', 60], ['Sunglasses', 85]],
    Beauty: [['Face Serum', 32], ['Fragrance 50ml', 68], ['Lip Balm Set', 12]],
  };
  const products: Row[] = [];
  for (const [cat, list] of Object.entries(cats)) for (const [name, price] of list) products.push({ Product_ID: `P${pad(products.length + 1, 3)}`, Product_Name: name, Category: cat, Brand: r.pick(['Northline', 'Aurel', 'Kestrel', 'Mono']), Unit_Price: price });
  const sales: Row[] = [];
  const start = Date.UTC(2025, 10, 1);
  for (let d = 0; d < 365; d++) {
    const t = start + d * DAY;
    const m = new Date(t).getUTCMonth();
    const season = m === 10 || m === 11 ? 1.6 : m === 0 ? 0.7 : 1;
    const count = Math.round((14 + (d / 365) * 6) * season + (r.next() - 0.5) * 6);
    for (let k = 0; k < count; k++) {
      const p = r.pick(products);
      const qty = r.weighted([[1, 70], [2, 20], [3, 10]] as const);
      const discount = r.weighted([[0, 70], [0.1, 20], [0.25, 10]] as const);
      sales.push({ Transaction_ID: `TX${pad(sales.length + 1, 6)}`, Store_ID: r.pick(stores).Store_ID, Product_ID: p.Product_ID, Sale_Date: iso(t), Channel: r.weighted([['In-store', 65], ['Online', 25], ['Click & Collect', 10]] as const), Quantity: qty, Net_Amount: Math.round(Number(p.Unit_Price) * qty * (1 - discount) * 100) / 100, Payment_Status: r.weighted([['Completed', 93], ['Refunded', 5], ['Cancelled', 2]] as const) });
    }
  }
  [40, 900, 3100].forEach((i) => (sales[i].Product_ID = 'P999'));
  for (let i = 0; i < 8; i++) sales[500 + i * 311].Channel = null;
  return { stores, products, sales };
}

export const RETAIL_NARRATIVE =
  'Build a retail performance dashboard. Track net sales revenue and number of transactions over time, monthly, and compare with the previous period. Show sales by region, by product category and by channel, and identify top stores and top products. Track refund rate. Filter by region, category, channel and reporting period.';

// ───────────────────────── Pharma brand performance (commercial analytics) ─────────────────────────
/**
 * Brand performance dataset in the shape of a typical life-sciences commercial
 * analytics engagement: HCP universe, territory alignment / roster, weekly
 * prescription data (TRx/NRx for the brand and competitors) and field calls.
 * Deterministic. Seeded issues: 6 Rx rows for HCP IDs not in the universe,
 * 9 HCPs without a decile, 3 duplicated call records, 4 calls with no channel.
 */
export function generatePharmaData() {
  const r = seeded(77001);
  const regionsDef: Record<string, [string, string[]][]> = {
    East: [['Boston', ['MA', 'CT']], ['New York', ['NY', 'NJ']], ['Mid-Atlantic', ['PA', 'MD']]],
    South: [['Atlanta', ['GA', 'AL']], ['Florida', ['FL']], ['Texas', ['TX']]],
    Central: [['Chicago', ['IL', 'IN']], ['Ohio Valley', ['OH', 'KY']], ['Twin Cities', ['MN', 'WI']]],
    West: [['Bay Area', ['CA']], ['Pacific NW', ['WA', 'OR']], ['Mountain', ['CO', 'AZ']]],
  };
  const REPS = ['Alex Morgan', 'Jordan Lee', 'Sam Patel', 'Taylor Brooks', 'Casey Nguyen', 'Riley Chen', 'Morgan Diaz', 'Jamie Foster', 'Avery Kim', 'Quinn Shah', 'Drew Walsh', 'Harper Liu', 'Rowan Price', 'Skyler Grant', 'Emerson Hale', 'Logan Reyes', 'Parker Stone', 'Reese Cohen', 'Blake Ortiz', 'Cameron Fox', 'Dakota Wynn', 'Elliot Park', 'Finley Moss', 'Hayden Cruz'];
  const territories: Row[] = [];
  let ti = 0;
  for (const [region, districts] of Object.entries(regionsDef))
    for (const [district, states] of districts)
      for (let k = 0; k < 2; k++) {
        ti++;
        territories.push({ Territory_ID: `T${pad(ti, 3)}`, Territory_Name: `${district} ${k ? 'North' : 'South'}`, District: district, Region: region, Rep_ID: `REP${pad(ti, 3)}`, Rep_Name: REPS[ti - 1], State_Coverage: states.join('/') });
      }
  const SPEC: [string, number][] = [['Oncology', 30], ['Hematology', 20], ['Internal Medicine', 25], ['Pulmonology', 15], ['Nurse Practitioner', 10]];
  const FN = ['Anna', 'Brian', 'Chloe', 'Deepak', 'Elena', 'Farid', 'Grace', 'Hiro', 'Irene', 'Jamal', 'Karen', 'Luis', 'Maya', 'Nikhil', 'Olivia', 'Pedro', 'Rosa', 'Sanjay', 'Tara', 'Victor', 'Wen', 'Yusuf'];
  const LN = ['Abbott', 'Bhatt', 'Carter', 'Dominguez', 'Ellis', 'Fischer', 'Gupta', 'Hoffman', 'Iyer', 'Jensen', 'Kowalski', 'Lindqvist', 'Mehta', 'Novak', 'Okoye', 'Park', 'Quinn', 'Rossi', 'Sato', 'Turner', 'Underwood', 'Varga'];
  const hcps: Row[] = [];
  const used = new Set<string>();
  for (let i = 1; i <= 420; i++) {
    const t = territories[(i * 7) % territories.length];
    let name = '';
    do name = `${r.pick(FN)} ${r.pick(LN)}`;
    while (used.has(name));
    used.add(name);
    const decile = r.weighted([[10, 4], [9, 5], [8, 7], [7, 9], [6, 10], [5, 12], [4, 13], [3, 13], [2, 13], [1, 14]] as const);
    const segment = decile >= 8 ? 'High Value' : decile >= 5 ? 'Grow' : decile >= 3 ? 'Maintain' : 'Low Potential';
    hcps.push({ HCP_ID: `H${100000 + i * 13}`, HCP_Name: `${name}, ${r.weighted([['MD', 80], ['DO', 10], ['NP', 10]] as const)}`, Specialty: r.weighted(SPEC), Decile: i % 47 === 0 ? null : decile, Segment: segment, Territory_ID: t.Territory_ID, State: String(t.State_Coverage).split('/')[i % String(t.State_Coverage).split('/').length], Target_Flag: decile >= 6 ? 'Target' : 'Non-Target' });
  }
  // weekly Rx — 26 weeks ending Saturdays
  const firstWeek = Date.UTC(2026, 4, 2); // Sat 2 May 2026
  const rx: Row[] = [];
  for (let w = 0; w < 26; w++) {
    const t = firstWeek + w * 7 * DAY;
    const brandGrowth = 1 + w * 0.025; // launch-phase uptake
    for (const h of hcps) {
      const dec = Number(h.Decile ?? 3);
      const market = dec * 0.9 + r.next() * 2;
      if (r.next() > 0.35 + dec * 0.06) continue; // not every HCP writes every week
      const shares: [string, number][] = [['Zentrava', 0.18 * brandGrowth * (h.Target_Flag === 'Target' ? 1.25 : 0.8)], ['Competitor A', 0.45], ['Competitor B', 0.3]];
      for (const [product, sh] of shares) {
        const trx = Math.round(market * sh + (r.next() - 0.4));
        if (trx <= 0) continue;
        const nrx = Math.max(0, Math.round(trx * (product === 'Zentrava' ? 0.45 : 0.3) + (r.next() - 0.5)));
        rx.push({ Rx_ID: `RX${pad(rx.length + 1, 7)}`, HCP_ID: h.HCP_ID, Product: product, Week_Ending: iso(t), TRx: trx, NRx: nrx });
      }
    }
  }
  ['H999001', 'H999002', 'H999003', 'H999001', 'H999004', 'H999002'].forEach((id, k) => (rx[200 + k * 1500].HCP_ID = id));
  // field calls
  const calls: Row[] = [];
  const start = firstWeek - 6 * DAY;
  for (let d = 0; d < 182; d++) {
    const t = start + d * DAY;
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const n = 26 + Math.round(r.next() * 10);
    for (let k = 0; k < n; k++) {
      const h = r.weighted(hcps.map((x) => [x, x.Target_Flag === 'Target' ? 4 : 1] as const));
      const terr = territories.find((x) => x.Territory_ID === h.Territory_ID)!;
      calls.push({ Call_ID: `CL${pad(calls.length + 1, 6)}`, HCP_ID: h.HCP_ID, Rep_ID: terr.Rep_ID, Call_Date: iso(t), Channel: r.weighted([['In-Person', 60], ['Virtual', 25], ['Phone', 10], ['Email Follow-up', 5]] as const), Call_Status: r.weighted([['Completed', 88], ['Cancelled', 7], ['No Show', 5]] as const), Samples_Dropped: r.weighted([[0, 50], [2, 25], [4, 15], [6, 10]] as const), Key_Message: r.weighted([['Efficacy', 40], ['Safety Profile', 25], ['Dosing', 20], ['Patient Support', 15]] as const) });
    }
  }
  for (let k = 0; k < 4; k++) calls[900 + k * 977].Channel = null;
  calls.push({ ...calls[50] }, { ...calls[1050] }, { ...calls[2050] });
  return { hcps, territories, rx, calls };
}

export const PHARMA_NARRATIVE =
  'Build a brand performance dashboard for Zentrava for the commercial leadership team and district managers. Track TRx and NRx weekly by product, compare with the previous period, and show prescriptions by region, by specialty and by HCP decile. Monitor field calls and call completion rate by channel and by segment, and identify the top prescribing HCPs. Filter by region, district, product, specialty and reporting period.';

// ───────────────────────── Rare disease patient access (FRM patient funnel) ─────────────────────────
/**
 * Patient-access dataset for a newly launched rare blood disorder therapy
 * ("Spacysla"): specialty pharmacy patient journey, payer / plan / PBM master,
 * HCP list and FRM territory alignment. Deterministic.
 * Seeded issues: 5 patients re-referred (same Patient_ID appears twice), 3 cases
 * reference a Plan_ID missing from the payer file, 4 HCPs without specialty.
 */
export const ACCESS_AS_OF = Date.UTC(2026, 9, 30);

export function generateAccessData() {
  const r = seeded(31415);
  const asOf = ACCESS_AS_OF;
  // FRM territories
  const terrDef: [string, string, string][] = [
    ['Northeast', 'New England', 'MA/CT/RI'], ['Northeast', 'Metro New York', 'NY/NJ'], ['Northeast', 'Mid-Atlantic', 'PA/MD/DE'],
    ['Southeast', 'Carolinas', 'NC/SC'], ['Southeast', 'Florida', 'FL'], ['Southeast', 'Gulf South', 'GA/AL/TN'],
    ['Central', 'Great Lakes', 'IL/MI/WI'], ['Central', 'Ohio Valley', 'OH/KY/IN'], ['Central', 'Texas', 'TX/OK'],
    ['West', 'Southern California', 'CA'], ['West', 'Pacific Northwest', 'WA/OR'], ['West', 'Mountain', 'CO/AZ/UT'],
  ];
  const FRMS = ['Dana Whitfield', 'Marcus Bell', 'Priya Nair', 'Owen Gallagher', 'Lucia Romero', 'Andre Thompson', 'Hannah Kowal', 'Brian Osei', 'Isabel Vega', 'Kevin Tran', 'Nora Lindgren', 'Ethan Brooks'];
  const territories: Row[] = terrDef.map(([region, name, states], i) => ({ Territory_ID: `FRM-${pad(i + 1, 2)}`, Territory_Name: name, Region: region, States: states, FRM_Name: FRMS[i], FRM_Email: `${FRMS[i].toLowerCase().replace(/[^a-z]+/g, '.')}@example.com` }));

  // HCPs (hematologists / HTC physicians)
  const FN = ['Alicia', 'Benjamin', 'Carmen', 'Daniel', 'Esther', 'Felix', 'Gloria', 'Henry', 'Ingrid', 'Javier', 'Kavya', 'Leon', 'Miriam', 'Nathan', 'Olga', 'Paul', 'Rebecca', 'Stefan', 'Tessa', 'Umar', 'Valerie', 'William'];
  const LN = ['Adler', 'Banerjee', 'Castillo', 'Delgado', 'Eriksen', 'Fontaine', 'Gallo', 'Hartmann', 'Ibarra', 'Jovanovic', 'Khatri', 'Lombardi', 'Meyer', 'Nakamura', 'Ortega', 'Pereira', 'Rahman', 'Silva', 'Tanaka', 'Usman', 'Volkov', 'Weiss'];
  const INST = ['University Hemophilia Treatment Center', 'Regional Medical Center', "Children's Hospital Hematology", 'Cancer & Blood Institute', 'Community Hematology Associates', 'Academic Medical Center'];
  const hcps: Row[] = [];
  const seen = new Set<string>();
  for (let i = 1; i <= 150; i++) {
    const t = territories[(i * 5) % territories.length];
    let n = '';
    do n = `${r.pick(FN)} ${r.pick(LN)}`;
    while (seen.has(n));
    seen.add(n);
    const states = String(t.States).split('/');
    hcps.push({ HCP_ID: `HCP-${pad(2000 + i * 7, 5)}`, HCP_Name: `Dr. ${n}`, Specialty: i % 37 === 0 ? null : r.weighted([['Hematology', 55], ['Pediatric Hematology', 20], ['Hematology/Oncology', 25]] as const), Institution: r.pick(INST), Account_Type: r.weighted([['HTC', 35], ['Academic', 30], ['Community', 35]] as const), State: states[i % states.length], Territory_ID: t.Territory_ID });
  }

  // Payer / plan / PBM
  const payerDef: [string, string, string, number][] = [
    ['UnitedHealthcare', 'Commercial', 'OptumRx', 4], ['Aetna', 'Commercial', 'CVS Caremark', 3], ['Cigna', 'Commercial', 'Express Scripts', 3], ['Elevance Health', 'Commercial', 'CarelonRx', 3],
    ['BCBS (regional plans)', 'Commercial', 'Prime Therapeutics', 5], ['Humana', 'Medicare Part D', 'CenterWell Pharmacy', 3], ['UnitedHealthcare', 'Medicare Part D', 'OptumRx', 2], ['Aetna', 'Medicare Part D', 'CVS Caremark', 2],
    ['State Medicaid', 'Medicaid', 'State FFS', 4], ['Centene', 'Medicaid', 'Envolve / CVS Caremark', 3], ['Molina', 'Medicaid', 'CVS Caremark', 2], ['TRICARE', 'Government', 'Express Scripts', 1],
  ];
  const plans: Row[] = [];
  for (const [payer, channel, pbm, n] of payerDef)
    for (let k = 1; k <= n; k++)
      plans.push({ Plan_ID: `PL-${pad(plans.length + 101, 4)}`, Plan_Name: `${payer} ${channel === 'Commercial' ? ['PPO', 'HMO', 'EPO', 'HDHP', 'POS'][k % 5] : channel === 'Medicaid' ? `Managed Care ${k}` : `Plan ${k}`}`, Payer: payer, Channel: channel, PBM: pbm, Formulary_Status: r.weighted([['Covered with PA', 70], ['Not Covered (Exception Required)', 18], ['Covered with Step Therapy', 12]] as const) });

  // patient journey
  const DAY_MS = 86_400_000;
  const launch = Date.UTC(2026, 0, 12);
  const span = Math.round((asOf - launch) / DAY_MS);
  // a few high-volume treatment centres; some of them struggle with PA documentation (slow decisions)
  const problemHcps = new Set(hcps.filter((_, i) => i % 19 === 0).map((h) => h.HCP_ID));
  const hcpWeights = hcps.map((h, i) => [h, i % 19 === 0 ? 16 : i % 7 === 0 ? 5 : 1] as const);
  const SP = ['Rare Care Specialty Pharmacy', 'HemaPath Specialty', 'Accent Specialty Rx'];
  const journey: Row[] = [];
  const iso = (t: number | null) => (t == null ? null : new Date(t).toISOString().slice(0, 10));
  for (let i = 1; i <= 880; i++) {
    const h = r.weighted(hcpWeights);
    const plan = r.pick(plans);
    // referrals ramp up after launch
    const u = Math.sqrt(r.next());
    const ref = launch + Math.floor(u * span) * DAY_MS;
    const channel = String(plan.Channel);
    const pbmSlow = /Express Scripts|State FFS/.test(String(plan.PBM)) ? 6 : /CVS/.test(String(plan.PBM)) ? 3 : 0;
    const bv = ref + r.int(2, 6) * DAY_MS;
    const paSubmit = bv + r.int(1, 4) * DAY_MS;
    const problem = problemHcps.has(String(h.HCP_ID));
    const decisionDays = r.int(4, 16) + pbmSlow + (plan.Formulary_Status !== 'Covered with PA' ? 6 : 0) + (problem ? r.int(18, 40) : 0);
    const paDecision = paSubmit + decisionDays * DAY_MS;
    const approveP = (channel === 'Commercial' ? 0.8 : channel === 'Medicare Part D' ? 0.7 : 0.6) - (plan.Formulary_Status === 'Not Covered (Exception Required)' ? 0.25 : plan.Formulary_Status === 'Covered with Step Therapy' ? 0.12 : 0) - (h.Account_Type === 'Community' ? 0.08 : 0);
    let stage = '';
    let barrier = 'None';
    let outcome: string | null = null;
    let decisionDate: number | null = null;
    let start: number | null = null;
    let reason: string | null = null;
    let stageSince = ref;
    if (r.next() < 0.03) {
      stage = 'Discontinued';
      reason = 'Patient Unreachable';
      barrier = 'Patient Unreachable';
      stageSince = bv;
    } else if (bv > asOf) {
      stage = 'Benefits Verification';
      stageSince = ref;
    } else if (paSubmit > asOf) {
      stage = 'Benefits Verification';
      stageSince = bv;
      barrier = r.next() < 0.3 ? 'Missing Documentation' : 'None';
    } else if (paDecision > asOf) {
      stage = 'PA Pending';
      stageSince = paSubmit;
      barrier = r.next() < (problem ? 0.6 : 0.25) ? 'Missing Documentation' : 'PA Pending';
    } else if (r.next() < approveP) {
      outcome = 'Approved';
      decisionDate = paDecision;
      const ship = paDecision + r.int(3, 9) * DAY_MS;
      if (ship > asOf) {
        stage = 'PA Approved';
        stageSince = paDecision;
      } else {
        stage = 'Therapy Initiated';
        start = ship;
        stageSince = ship;
      }
    } else {
      outcome = 'Denied';
      decisionDate = paDecision;
      barrier = plan.Formulary_Status === 'Covered with Step Therapy' ? 'Step Therapy Required' : plan.Formulary_Status === 'Not Covered (Exception Required)' ? 'Non-Formulary' : r.weighted([['PA Denied - Medical Necessity', 60], ['Missing Documentation', 25], ['High Out-of-Pocket Cost', 15]] as const);
      const appealDone = paDecision + r.int(10, 30) * DAY_MS;
      if (r.next() < 0.65 && appealDone > asOf) {
        stage = 'Appeal';
        stageSince = paDecision;
      } else if (r.next() < 0.5) {
        outcome = 'Approved on Appeal';
        decisionDate = appealDone;
        const ship = appealDone + r.int(3, 9) * DAY_MS;
        if (ship > asOf) {
          stage = 'PA Approved';
          stageSince = appealDone;
        } else {
          stage = 'Therapy Initiated';
          start = ship;
          stageSince = ship;
        }
      } else {
        stage = 'Discontinued';
        reason = r.weighted([['Coverage Denied', 55], ['Switched Therapy', 25], ['Patient Choice', 20]] as const);
        stageSince = paDecision;
      }
    }
    if (stage === 'Therapy Initiated') barrier = 'None';
    const open = !['Therapy Initiated', 'Discontinued'].includes(stage) && barrier !== 'None';
    journey.push({
      Patient_ID: `PT-${pad(100000 + i * 3, 6)}`,
      HCP_ID: h.HCP_ID,
      Plan_ID: plan.Plan_ID,
      Specialty_Pharmacy: r.pick(SP),
      Referral_Date: iso(ref),
      BV_Complete_Date: bv <= asOf ? iso(bv) : null,
      PA_Submitted_Date: paSubmit <= asOf && stage !== 'Benefits Verification' && reason !== 'Patient Unreachable' ? iso(paSubmit) : null,
      PA_Outcome: outcome,
      PA_Decision_Date: iso(decisionDate),
      Therapy_Start_Date: iso(start),
      Current_Stage: stage,
      Access_Barrier: barrier,
      Access_Case_Status: barrier === 'None' ? 'No Case' : open ? 'Open' : 'Resolved',
      Days_in_Current_Stage: ['Therapy Initiated', 'Discontinued'].includes(stage) ? null : Math.round((asOf - stageSince) / DAY_MS),
      Days_to_Therapy: start == null ? null : Math.round((start - ref) / DAY_MS),
      Copay_Program: channel === 'Commercial' ? r.weighted([['Enrolled', 70], ['Not Enrolled', 30]] as const) : 'Ineligible (Government)',
      Discontinuation_Reason: reason,
    });
  }
  // seeded issues
  // re-referrals: 5 recent patients were referred twice, so their ID appears on two rows (both within the last 13 weeks)
  const recent = journey.filter((j) => Date.parse(String(j.Referral_Date)) >= asOf - 60 * DAY_MS);
  [3, 11, 19, 27, 35].map((k) => recent[k % recent.length]).forEach((prior) => {
    journey.push({ ...prior, Referral_Date: iso(Date.parse(String(prior.Referral_Date)) - 12 * DAY_MS), BV_Complete_Date: null, PA_Submitted_Date: null, PA_Decision_Date: null, Current_Stage: 'Discontinued', Discontinuation_Reason: 'Re-referred', Access_Barrier: 'None', Access_Case_Status: 'No Case', Days_in_Current_Stage: null, Therapy_Start_Date: null, Days_to_Therapy: null, PA_Outcome: null });
  });
  [55, 300, 640].forEach((k) => (journey[k].Plan_ID = 'PL-9999'));
  journey.sort((a, b) => String(a.Referral_Date).localeCompare(String(b.Referral_Date)));
  return { journey, plans, hcps, territories };
}

export const ACCESS_NARRATIVE = `Create a patient access dashboard for Spacysla, our newly launched rare disease therapy, for the Field Reimbursement Manager (FRM) team.
The dashboard should:
- Track patients from prescription through therapy initiation.
- Identify patients experiencing delays or drop-offs.
- Highlight prior authorization and reimbursement barriers.
- Analyze issues by payer, plan, and PBM.
- Identify HCPs associated with access challenges.
- Allow FRMs to filter by territory, HCP, and payer.`;
