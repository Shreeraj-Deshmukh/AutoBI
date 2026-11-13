import type { Clarification, ProjectInfo, ReqItem, RequirementSection, RequirementSpec } from '@/types';
import { uid, humanize, singular } from '@/lib/util';
import { FRM_REQUIREMENT_KPIS } from '@/lib/catalogue';

/**
 * Requirement Intelligence Agent (deterministic NLP).
 * Extracts objectives, KPIs, dimensions, filters, visuals, datasets, rules and
 * pages from a natural-language brief, and raises clarification questions.
 */

const item = (text: string, source: ReqItem['source'] = 'extracted'): ReqItem => ({ id: uid('req'), text, source });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// metric lexicon: noun stem → KPIs it implies
const METRICS: { re: RegExp; entity: string; kpis: string[]; dataset: string }[] = [
  { re: /\bcalls?\b|\bdetails?\b|\bvisits?\b/i, entity: 'call', kpis: ['Total calls'], dataset: 'Call activity (one row per call, with date, type and account)' },
  {
    re: /\bemails?\b|\be-?mail campaign/i,
    entity: 'email',
    kpis: ['Total emails sent', 'Emails delivered', 'Emails opened', 'Email open rate'],
    dataset: 'Email activity (one row per email sent, with delivery and open status)',
  },
  { re: /\bcampaigns?\b/i, entity: 'campaign', kpis: [], dataset: 'Campaign master (campaign names, types and dates)' },
  // "sales territory" / "sales rep" name a geography or role, not sales data
  { re: /\b(sales|revenue)\b(?!\s+(territor|reps?\b|force|team|region|district|area))/i, entity: 'sale', kpis: ['Total sales'], dataset: 'Sales transactions' },
  { re: /\borders?\b/i, entity: 'order', kpis: ['Total orders'], dataset: 'Order transactions' },
  { re: /\btrx\b|\bnrx\b|\bprescriptions? (volume|data|trend|counts?|share)\b|\bscripts?\b/i, entity: 'prescription', kpis: ['Total TRx', 'Total NRx'], dataset: 'Prescription data (TRx / NRx by HCP, product and week)' },
  { re: /\btickets?\b|\bincidents?\b/i, entity: 'ticket', kpis: ['Total tickets'], dataset: 'Ticket / incident log' },
  { re: /\bpatients?\b/i, entity: 'patient', kpis: ['Total patients'], dataset: 'Patient records' },
  { re: /\bclaims?\b/i, entity: 'claim', kpis: ['Total claims'], dataset: 'Claims data' },
  { re: /\bleads?\b|\bopportunit(y|ies)\b/i, entity: 'lead', kpis: ['Total leads'], dataset: 'Lead / opportunity pipeline' },
];

const STOP = new Set(['the', 'a', 'an', 'different', 'various', 'each', 'all', 'their', 'our', 'my', 'and', 'or', 'of']);

function cleanPhrase(s: string) {
  return s
    .replace(/[.;:!?]+$/, '')
    .split(/\s+/)
    .filter((w) => !STOP.has(w.toLowerCase()))
    .join(' ')
    .trim();
}

function normDim(s: string) {
  let d = cleanPhrase(s.toLowerCase());
  d = d.replace(/\bsegments\b/, 'segment').replace(/\btiers\b/, 'tier').replace(/\bregions\b/, 'region').replace(/\bterritories\b/, 'territory').replace(/\bstates\b/, 'state');
  if (d === 'account segment') d = 'segment';
  return d;
}

function splitList(s: string) {
  return s
    .split(/,|\band\b|\bor\b|\//i)
    .map((x) => cleanPhrase(x))
    .filter((x) => x && x.split(' ').length <= 4);
}

export function extractRequirements(text: string, info: Partial<ProjectInfo>): RequirementSpec {
  const t = ` ${text} ${(info.objective ?? '')} ${(info.keyQuestions ?? []).join('. ')} `;
  const lower = t.toLowerCase();
  const spec: RequirementSpec = { objectives: [], stories: [], kpis: [], dimensions: [], filters: [], visuals: [], datasets: [], rules: [], pages: [], ambiguities: [], missing: [], timeGrain: null, comparison: false };
  const add = (sec: RequirementSection, text: string, source: ReqItem['source'] = 'extracted') => {
    const k = text.toLowerCase();
    if (!text.trim() || spec[sec].some((x) => x.text.toLowerCase() === k)) return;
    spec[sec].push(item(cap(text), source));
  };

  // ── objectives: verb-led clauses
  const sentences = t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const verbRe = /\b(monitor|track|understand|compare|identify|highlight|analy[sz]e|measure|see|report on|evaluate|assess|visuali[sz]e|optimi[sz]e)\b\s+([^,.;]+?)(?=,|\.|;|\band (?:monitor|track|understand|compare|identify|analy[sz]e|measure|see|report|evaluate|assess)\b|$)/gi;
  for (const s of sentences) {
    let m: RegExpExecArray | null;
    verbRe.lastIndex = 0;
    while ((m = verbRe.exec(s))) {
      const phrase = `${m[1]} ${m[2]}`.replace(/\s+/g, ' ').trim();
      if (phrase.split(' ').length >= 2 && phrase.split(' ').length <= 14) add('objectives', phrase);
    }
  }
  if (!spec.objectives.length && info.objective) add('objectives', info.objective);

  // ── metrics & datasets
  const hits = METRICS.filter((m) => m.re.test(t));
  const emailEngagement = /email[^.]*\b(performance|engagement|open|deliver|campaign)/i.test(t);
  for (const h of hits) {
    for (const k of h.kpis) {
      if (h.entity === 'email' && !emailEngagement && k !== 'Total emails sent') continue;
      add('kpis', k);
    }
    add('datasets', h.dataset);
  }
  if (/\b(hcp|account|customer|client|physician|doctor|provider)s?\b/i.test(t)) add('datasets', 'Account / customer master (attributes such as region, territory, tier, specialty)');
  if (/\bengagement\b/i.test(t) && hits.some((h) => h.entity === 'call')) add('objectives', 'Monitor overall engagement levels');

  // ── named rates such as "call completion rate"
  const rateRe = /\b([a-z]+)\s+(completion|conversion|response|open|delivery|refund|retention|adherence)\s+rate\b/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rateRe.exec(t))) add('kpis', `${cap(rm[1].toLowerCase())} ${rm[2].toLowerCase()} rate`);

  // ── "X by Y" patterns → dimensions + breakdown KPIs
  const primary = hits.find((h) => h.kpis.length)?.entity ?? 'record';
  const byRe = /\b([a-z]+)\s+(?:made\s+|sent\s+|delivered\s+)?(?:by|across|per)\s+(?:different\s+|each\s+)?([a-z][a-z\s-]{2,30}?)(?=,|\.|;|\band\b|\bto\b|\bover\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = byRe.exec(lower))) {
    const lead = m[1];
    if (/filter|filtering|sorted|grouped/.test(lead)) continue;
    const dim = normDim(m[2]);
    if (!dim || dim.split(' ').length > 3) continue;
    add('dimensions', humanize(dim));
    if (/\bacross\b/.test(m[0])) continue; // "across regions" = scope, not an explicit breakdown
    const metricEntity = METRICS.find((x) => x.re.test(lead))?.entity ?? (/(activity|engagement|volume)/.test(lead) ? primary : null);
    if (metricEntity) add('kpis', `${cap(metricEntity === 'email' ? 'emails' : `${metricEntity}s`)} by ${dim}`);
  }

  // ── filters
  const fRe = /filter(?:ing|ed|s)?\s+(?:by|on|for)\s+([^.;]+)/gi;
  while ((m = fRe.exec(t))) for (const f of splitList(m[1])) add('filters', humanize(normDim(f)));
  const slicerRe = /slic(?:e|ers?|ing)\s+(?:by\s+)?([^.;]+)/gi;
  while ((m = slicerRe.exec(t))) for (const f of splitList(m[1])) add('filters', humanize(normDim(f)));
  for (const f of spec.filters) if (!/period|date|time/i.test(f.text)) add('dimensions', f.text);
  if (!spec.filters.some((f) => /period|date/i.test(f.text)) && /(over time|trend|period|weekly|monthly|quarterly)/i.test(t)) add('filters', 'Reporting period');

  // ── time & comparison
  if (/\bweekly|\bweek\b|r13w|by week/i.test(t)) spec.timeGrain = 'week';
  else if (/\bmonthly|\bmonth\b|by month/i.test(t)) spec.timeGrain = 'month';
  else if (/\bquarterly|\bquarter\b/i.test(t)) spec.timeGrain = 'quarter';
  if (/(previous|prior|vs\.?|versus|year[- ]over[- ]year|yoy|period[- ]over[- ]period|wow|mom)/i.test(t)) spec.comparison = true;
  const wantsTrend = /(over time|trend|changes? in|growth|evolution|time series)/i.test(t);

  // ── visuals
  if (wantsTrend) add('visuals', `Line chart – ${spec.kpis[0]?.text.toLowerCase() ?? 'activity'} trend over time`);
  for (const k of spec.kpis.filter((k) => / by /i.test(k.text))) add('visuals', `Bar chart – ${k.text.toLowerCase()}`);
  if (spec.kpis.some((k) => /rate/i.test(k.text))) add('visuals', 'KPI cards with current vs previous period');
  else if (spec.kpis.length) add('visuals', 'KPI cards for headline metrics');
  if (/campaign/i.test(t)) add('visuals', 'Table – campaign performance');
  if (/(account|hcp|customer)[- ]level|by account|each account|per account|\bhcps?\b/i.test(t)) add('visuals', 'Table – account-level performance with search and sorting');
  if (/(distribution|mix|share|split)/i.test(t) || spec.dimensions.some((d) => /type/i.test(d.text))) add('visuals', 'Donut chart – category distribution');

  // ── rules
  if (spec.kpis.some((k) => /open rate/i.test(k.text))) add('rules', 'Email open rate = emails opened ÷ emails delivered × 100');
  if (spec.kpis.some((k) => /delivered/i.test(k.text))) add('rules', 'Only emails with a delivered status count as delivered');
  if (spec.filters.some((f) => /period/i.test(f.text))) add('rules', 'Reporting period filter applies to activity dates (call date / sent date)');
  if (spec.dimensions.some((d) => /region|territory|tier|state|specialty/i.test(d.text))) add('rules', 'Account attributes (region, territory, tier) are taken from the account master');
  if (spec.comparison || wantsTrend) add('rules', 'Previous period = the immediately preceding period of equal length');

  // ── patient access / funnel vocabulary (rare disease, specialty products)
  if (/(funnel|prior authori[sz]ation|\bPA\b|therapy initiation|reimbursement|access barrier|patient access)/i.test(t) && /\bpatients?\b/i.test(t)) {
    for (const kpi of ['Total patients', 'Patients awaiting PA', 'PA approval rate', 'Patients initiating therapy', 'Average time to therapy initiation', 'Patient drop-off rate', 'Unresolved access cases by HCP']) add('kpis', kpi);
    for (const d of ['Payer', 'Plan', 'PBM', 'HCP', 'Territory', 'Access barrier', 'Current stage']) add('dimensions', d);
    add('rules', 'Patients awaiting PA = patients whose current stage is PA Pending');
    add('rules', 'PA approval rate = approved PA decisions ÷ all PA decisions');
    add('rules', 'Drop-off = patients who discontinued before therapy initiation');
    add('rules', 'Count each patient once (distinct Patient ID) even if re-referred');
    add('visuals', 'Funnel – patients by stage from referral to therapy initiation');
    add('visuals', 'Table – HCPs with unresolved access issues');
  }

  // ── FRM case management: KPIs, pages and visuals from the ProcDNA KPI catalogue / FRM report
  const frmCases = /\bFRMs?\b|field reimbursement/i.test(t) && /\bcases?\b/i.test(t);
  if (frmCases) {
    for (const k of FRM_REQUIREMENT_KPIS) add('kpis', k, 'catalogue');
    for (const d of ['Case type', 'Priority', 'Region', 'FRM']) add('dimensions', d);
    add('rules', 'Case KPIs follow the ProcDNA KPI Catalogue (Case and FRM Management) definitions');
    add('rules', 'Case closure rate = closed cases ÷ cases opened in the period');
    add('rules', 'Open cases are aged from case open date into 0-7, 8-14, 15-21, 22-30 and 30+ day buckets; the case SLA is 14 days');
    add('rules', 'Time to first fill = days from referral to therapy start');
    add('visuals', 'Case summary cards – total / open / closed / closure rate, time to resolution (average and median), time to first fill');
    add('visuals', 'Table – priority prescribers by pending cases with priority flags');
    add('visuals', 'Bar chart – open case aging buckets');
    add('visuals', 'Case list – open and escalated cases with patient, HCP, payer, case type, priority and days open');
    add('visuals', 'Territory scorecard – highest and lowest territory for volume, closure rate, resolution time, open and escalated cases');
    add('visuals', 'Decomposition tree – case journey by region, territory, case type and status');
    add('datasets', 'FRM case log (one row per access case, with case type, status, priority, escalation and open / first action / close dates)');
  }

  // ── user stories
  const persona = /\bFRMs?\b|field reimbursement/i.test(t) ? 'field reimbursement manager' : info.audience?.trim() ? info.audience.trim().toLowerCase() : 'business user';
  if (frmCases) {
    add('stories', 'As a field reimbursement manager, I want to see each open case with the patient, HCP, payer and where the patient is stuck so that I know which office to call first');
    add('stories', 'As an FRM manager, I want to compare territories on case volume, closure rate and response time so that I can see where intervention is needed');
  }
  for (const o of spec.objectives.slice(0, 6)) add('stories', `As a ${persona}, I want to ${o.text.charAt(0).toLowerCase()}${o.text.slice(1)} so that I can act on it quickly`);
  if (spec.filters.length) add('stories', `As a ${persona}, I want to filter by ${spec.filters.map((f) => f.text.toLowerCase()).join(', ')} so that I only see what is relevant to me`);

  // ── pages
  if (frmCases) {
    add('pages', 'Field Reimbursement Management');
    add('pages', 'FRM Performance');
  }
  // FRM briefs lead with the two FRM report pages instead of a generic executive overview
  if (!frmCases) add('pages', 'Executive Overview');
  for (const h of hits) {
    if (h.entity === 'call') add('pages', 'Call Analytics');
    else if (h.entity === 'email' && emailEngagement) add('pages', 'Email Engagement');
    else if (h.kpis.length) add('pages', `${cap(singular(h.entity))} Analytics`);
  }
  if (spec.visuals.some((v) => /account-level/i.test(v.text))) add('pages', 'Account-Level Performance');

  // ── clarifications (kept deliberately short – do not over-question)
  if (wantsTrend && !spec.timeGrain)
    spec.ambiguities.push({ id: uid('clar'), field: 'timeGrain', question: 'You asked to track changes over time. Should trends be shown weekly, monthly, or quarterly?', options: ['Weekly', 'Monthly', 'Quarterly'] });
  if ((wantsTrend || /compare/i.test(t)) && !spec.comparison)
    spec.ambiguities.push({ id: uid('clar'), field: 'comparison', question: 'Should KPI cards compare the selected period with the previous period of equal length?', options: ['Yes, show current vs previous', 'No comparison needed'] });
  if (!info.audience?.trim())
    spec.ambiguities.push({ id: uid('clar'), field: 'audience', question: 'Who is the primary audience for this dashboard?', options: ['Commercial leadership', 'Regional / territory managers', 'Brand & marketing teams', 'Analysts'] });

  // ── missing information (non-blocking)
  if (!spec.kpis.length) spec.missing.push('No measurable KPIs could be identified — describe what should be counted or summed.');
  if (!spec.filters.length) spec.missing.push('No filters were specified — default filters will be proposed from the data.');
  if (!info.frequency?.trim()) spec.missing.push('Reporting refresh frequency not specified (assumed weekly).');
  if (!info.period?.trim()) spec.missing.push('Default reporting period not specified (assumed rolling 13 weeks).');
  if (/campaign/i.test(t) && !/campaign (name|type)/i.test(t)) spec.missing.push('Campaign attributes to report on (name, type) were not specified — will use what the data provides.');
  return spec;
}

/** Apply an answer to a clarification question. */
export function applyClarification(spec: RequirementSpec, c: Clarification, answer: string): RequirementSpec {
  const next: RequirementSpec = { ...spec, ambiguities: spec.ambiguities.map((a) => (a.id === c.id ? { ...a, answer } : a)) };
  const a = answer.toLowerCase();
  if (c.field === 'timeGrain') {
    next.timeGrain = a.includes('week') ? 'week' : a.includes('quarter') ? 'quarter' : 'month';
    next.rules = [...next.rules, item(`Trends are reported at ${next.timeGrain}ly grain`, 'clarification')];
  }
  if (c.field === 'comparison') {
    next.comparison = !a.startsWith('no');
    if (next.comparison) next.rules = [...next.rules, item('KPI cards show current vs previous period change', 'clarification')];
  }
  if (c.field === 'audience') next.rules = [...next.rules, item(`Primary audience: ${answer}`, 'clarification')];
  return next;
}

export interface ChatResult {
  spec: RequirementSpec;
  reply: string;
  infoPatch?: Partial<ProjectInfo>;
}

/** Conversational refinement: answer pending questions or merge new requirements. */
export function respondToMessage(spec: RequirementSpec, message: string, info: ProjectInfo): ChatResult {
  const msg = message.trim();
  const pending = spec.ambiguities.find((a) => !a.answer);
  const low = msg.toLowerCase();

  // explicit commands
  const cmd = /^(add|remove|delete)\s+(kpi|metric|filter|dimension|page|objective|rule)s?\s*[:-]?\s*(.+)$/i.exec(msg);
  if (cmd) {
    const secMap: Record<string, RequirementSection> = { kpi: 'kpis', metric: 'kpis', filter: 'filters', dimension: 'dimensions', page: 'pages', objective: 'objectives', rule: 'rules' };
    const sec = secMap[cmd[2].toLowerCase()];
    const val = cmd[3].trim();
    if (cmd[1].toLowerCase() === 'add') return { spec: { ...spec, [sec]: [...spec[sec], item(cap(val), 'user')] }, reply: `Added "${cap(val)}" to ${humanize(sec)}.` };
    const before = spec[sec].length;
    const kept = spec[sec].filter((x) => !x.text.toLowerCase().includes(val.toLowerCase()));
    return { spec: { ...spec, [sec]: kept }, reply: before === kept.length ? `I couldn't find "${val}" in ${humanize(sec)}.` : `Removed ${before - kept.length} item(s) matching "${val}" from ${humanize(sec)}.` };
  }

  // answer to pending clarification
  if (pending) {
    const opt = pending.options.find((o) => low.includes(o.toLowerCase().split(/[ ,/]/)[0].toLowerCase()));
    const yesNo = pending.field === 'comparison' && /^(y|yes|sure|ok|no|n)\b/.test(low);
    const grain = pending.field === 'timeGrain' && /(week|month|quarter)/.test(low);
    if (opt || yesNo || grain || pending.field === 'audience') {
      const answer = opt ?? (yesNo ? (low.startsWith('n') ? 'No comparison needed' : 'Yes, show current vs previous') : msg);
      const next = applyClarification(spec, pending, answer);
      const after = next.ambiguities.find((a) => !a.answer);
      const infoPatch = pending.field === 'audience' && !info.audience ? { audience: answer } : pending.field === 'timeGrain' && !info.frequency ? { frequency: humanize(next.timeGrain + 'ly') } : undefined;
      return { spec: next, infoPatch, reply: `Noted — ${pendingSummary(pending, answer)}.${after ? ` One more: ${after.question}` : ' All open questions are resolved. Review the extracted sections and generate the Requirements Specification when ready.'}` };
    }
  }

  // otherwise treat as additional requirement text and merge
  const extra = extractRequirements(msg, { audience: info.audience || 'x', frequency: 'x', period: 'x' });
  const merged: RequirementSpec = { ...spec };
  const added: string[] = [];
  (['objectives', 'kpis', 'dimensions', 'filters', 'visuals', 'datasets', 'rules'] as RequirementSection[]).forEach((sec) => {
    for (const it of extra[sec]) {
      if (!merged[sec].some((x) => x.text.toLowerCase() === it.text.toLowerCase())) {
        merged[sec] = [...merged[sec], { ...it, source: 'user' }];
        added.push(`${humanize(sec).replace(/s$/, '')}: ${it.text}`);
      }
    }
  });
  if (extra.timeGrain && !spec.timeGrain) merged.timeGrain = extra.timeGrain;
  if (extra.comparison) merged.comparison = true;
  if (!added.length)
    return { spec, reply: pending ? `I didn't catch an answer to: "${pending.question}" Options: ${pending.options.join(', ')}.` : 'I did not find new requirements in that message. You can also type commands like "add filter Specialty" or "remove kpi Emails opened".' };
  return { spec: merged, reply: `I've added ${added.length} item(s):\n• ${added.slice(0, 8).join('\n• ')}${pending ? `\n\nStill open: ${pending.question}` : ''}` };
}

function pendingSummary(c: Clarification, answer: string) {
  if (c.field === 'timeGrain') return `trends will be reported ${answer.toLowerCase()}`;
  if (c.field === 'comparison') return answer.toLowerCase().startsWith('no') ? 'no period comparison on KPI cards' : 'KPI cards will show current vs previous period';
  if (c.field === 'audience') return `primary audience is ${answer}`;
  return `answer recorded: ${answer}`;
}

export function specCounts(s: RequirementSpec) {
  return { objectives: s.objectives.length, kpis: s.kpis.length, dimensions: s.dimensions.length, filters: s.filters.length, pages: s.pages.length, open: s.ambiguities.filter((a) => !a.answer).length };
}
