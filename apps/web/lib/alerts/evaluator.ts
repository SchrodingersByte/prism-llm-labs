import { createClient } from "@supabase/supabase-js";
import { sendAlertEmail, sendSlackAlert, sendCustomWebhook } from "./notify";

// â”€â”€ Admin client â€” lazy so Next.js build doesn't evaluate env vars at import time

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface AlertRule {
  id:              string;
  org_id:          string;
  project_id:      string | null;
  name:            string;
  trigger_type:    string;
  threshold_value: number;
  channels:        string[];
  slack_webhook:   string | null;
  custom_webhook:  string | null;
  last_fired_at:   string | null;
}

// â”€â”€ Date helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function tbDate(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// â”€â”€ Tinybird query (no-store â€” always fresh for evaluator) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function queryTb(pipe: string, params: Record<string, string>): Promise<unknown[]> {
  const base  = process.env.TINYBIRD_API_URL;
  const token = process.env.TINYBIRD_ADMIN_TOKEN;
  if (!base || !token) return [];

  const qs  = new URLSearchParams(params).toString();
  const res = await fetch(`${base}/v0/pipes/${pipe}.json?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data: unknown[] };
  return json.data ?? [];
}

// â”€â”€ Admin email lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function getAdminEmails(orgId: string): Promise<string[]> {
  const { data: members } = await getAdmin()
    .from("members")
    .select("user_id")
    .eq("org_id", orgId)
    .in("role", ["owner", "administrator", "developer"]);

  if (!members?.length) return [];

  const userIds = new Set((members as { user_id: string }[]).map(m => m.user_id));

  // Single batch call instead of N individual getUserById calls
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: authData } = await (getAdmin() as any).auth.admin.listUsers({ perPage: 1000 });
  return (authData?.users ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((u: any) => userIds.has(u.id) && u.email)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((u: any) => u.email as string);
}

// â”€â”€ Org name lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function getOrgName(orgId: string): Promise<string> {
  const { data } = await getAdmin()
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .single();
  return (data as { name: string } | null)?.name ?? "your organization";
}

// â”€â”€ Threshold checks per trigger type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function checkBudgetThreshold(rule: AlertRule): Promise<{ fires: boolean; value: number }> {
  // Find monthly budget for org/project
  const budgetQuery = getAdmin()
    .from("budgets")
    .select("amount_usd")
    .eq("org_id", rule.org_id)
    .eq("period", "monthly");

  const finalQuery = rule.project_id
    ? budgetQuery.eq("project_id", rule.project_id)
    : budgetQuery.is("project_id", null);

  const { data: budgets } = await finalQuery.limit(1);
  const budget = ((budgets as { amount_usd: number }[] | null)?.[0])?.amount_usd;
  if (!budget || budget <= 0) return { fires: false, value: 0 };

  const now   = new Date();
  const rows  = await queryTb("overview_metrics", {
    org_id:    rule.org_id,
    from_date: tbDate(startOfMonth()),
    to_date:   tbDate(now),
  }) as { total_cost_usd?: number }[];

  const spend   = rows[0]?.total_cost_usd ?? 0;
  const pct     = (spend / budget) * 100;
  return { fires: pct >= rule.threshold_value, value: pct };
}

async function checkSpendSpike(rule: AlertRule): Promise<{ fires: boolean; value: number }> {
  const now       = new Date();
  const today     = startOfToday();
  const yesterday = new Date(today.getTime() - 86_400_000);

  const rows = await queryTb("timeseries_daily", {
    org_id:     rule.org_id,
    project_id: rule.project_id ?? "",
    from_date:  tbDate(yesterday),
    to_date:    tbDate(now),
  }) as { date: string; cost_usd: number }[];

  const todayStr     = today.toISOString().slice(0, 10);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const todaySpend     = rows.find(r => r.date === todayStr)?.cost_usd ?? 0;
  const yesterdaySpend = rows.find(r => r.date === yesterdayStr)?.cost_usd ?? 0;

  if (yesterdaySpend <= 0) return { fires: false, value: 0 };

  const ratio = todaySpend / yesterdaySpend;
  return { fires: ratio >= rule.threshold_value, value: ratio };
}

// â”€â”€ Statistical anomaly alert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Reuses the anomaly_detection pipe (rolling 7-day average + spike_ratio),
// which is statistically sturdier than checkSpendSpike's day-over-day ratio â€”
// a single unusually-quiet "yesterday" can't make a normal day look anomalous.
// threshold_value = minimum spike_ratio (Ã— rolling 7-day avg) required to fire.

async function checkStatisticalAnomaly(rule: AlertRule): Promise<{ fires: boolean; value: number }> {
  const rows = await queryTb("anomaly_detection", {
    org_id: rule.org_id,
  }) as { date?: string; daily_cost?: number; rolling_7d_avg?: number; spike_ratio?: number }[];

  if (!rows.length) return { fires: false, value: 0 };

  // The pipe pre-filters to spike_ratio > 2 and sorts DESC by date â€”
  // the first row is the most recent anomalous day (today's is partial-day
  // but still meaningful: a sharp burst can clear the bar before the day ends).
  const latest = rows[0]!;

  const todayStr     = startOfToday().toISOString().slice(0, 10);
  const yesterdayStr = new Date(startOfToday().getTime() - 86_400_000).toISOString().slice(0, 10);

  // Only fire on fresh anomalies â€” an older spike already had its chance to
  // alert (and re-firing on it every cooldown window would just be noise).
  if (latest.date !== todayStr && latest.date !== yesterdayStr) {
    return { fires: false, value: 0 };
  }

  const ratio = latest.spike_ratio ?? 0;
  return { fires: ratio >= rule.threshold_value, value: ratio };
}

async function checkErrorRate(rule: AlertRule): Promise<{ fires: boolean; value: number }> {
  const now    = new Date();
  const oneHourAgo = new Date(now.getTime() - 3_600_000);

  const rows = await queryTb("overview_metrics", {
    org_id:    rule.org_id,
    from_date: tbDate(oneHourAgo),
    to_date:   tbDate(now),
  }) as { error_rate?: number; total_requests?: number }[];

  const row = rows[0];
  if (!row || (row.total_requests ?? 0) === 0) return { fires: false, value: 0 };

  const rate = (row.error_rate ?? 0) * 100;
  return { fires: rate >= rule.threshold_value, value: rate / 100 };
}

async function checkSingleCallCost(rule: AlertRule): Promise<{ fires: boolean; value: number }> {
  const now        = new Date();
  const oneHourAgo = new Date(now.getTime() - 3_600_000);

  // max_cost_per_call pipe must be pushed to Tinybird (see tinybird/pipes/max_cost_per_call.pipe)
  const rows = await queryTb("max_cost_per_call", {
    org_id:    rule.org_id,
    from_date: tbDate(oneHourAgo),
    to_date:   tbDate(now),
  }) as { max_cost_usd?: number }[];

  const maxCost = rows[0]?.max_cost_usd ?? 0;
  return { fires: maxCost >= rule.threshold_value, value: maxCost };
}

async function checkToolCallLoop(rule: AlertRule): Promise<{ fires: boolean; value: number }> {
  // Fires when the same tool is called >= threshold_value times in the past 5 minutes
  const now        = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);

  const rows = await queryTb("agent_loop_detection", {
    org_id:    rule.org_id,
    from_date: tbDate(fiveMinAgo),
    to_date:   tbDate(now),
    min_calls: String(rule.threshold_value),
  }) as { call_count?: number; session_id?: string; tool_name?: string }[];

  if (!rows.length) return { fires: false, value: 0 };
  const maxCalls = Math.max(...rows.map((r) => r.call_count ?? 0));
  return { fires: maxCalls >= rule.threshold_value, value: maxCalls };
}

async function checkSessionBudgetThreshold(rule: AlertRule): Promise<{ fires: boolean; value: number }> {
  // Fires when any active session exceeds threshold_value USD in combined LLM + tool cost
  const now    = new Date();
  const oneHourAgo = new Date(now.getTime() - 3_600_000);

  const rows = await queryTb("session_costs", {
    org_id:     rule.org_id,
    session_id: "",   // empty = evaluate all sessions (pipe returns all when session_id is "")
  }) as { total_cost_usd?: number; session_id?: string }[];

  // Reusing the single-session pipe won't work for "any session" â€” use the sessions_list pipe
  const sessionRows = await queryTb("sessions_list", {
    org_id:    rule.org_id,
    from_date: tbDate(oneHourAgo),
    to_date:   tbDate(now),
    limit:     "500",
  }) as { llm_cost_usd?: number; session_id?: string }[];

  const overBudget = sessionRows.filter(
    (s) => (s.llm_cost_usd ?? 0) >= rule.threshold_value,
  );
  const maxCost = Math.max(...sessionRows.map((s) => s.llm_cost_usd ?? 0), 0);
  void rows; // silence unused warning
  return { fires: overBudget.length > 0, value: maxCost };
}

async function checkDailyLimit(rule: AlertRule): Promise<{ fires: boolean; value: number }> {
  const now   = new Date();
  const today = startOfToday();

  const rows = await queryTb("timeseries_daily", {
    org_id:     rule.org_id,
    project_id: rule.project_id ?? "",
    from_date:  tbDate(today),
    to_date:    tbDate(now),
  }) as { date: string; cost_usd: number }[];

  const todayStr   = today.toISOString().slice(0, 10);
  const todaySpend = rows.find(r => r.date === todayStr)?.cost_usd ?? 0;
  return { fires: todaySpend >= rule.threshold_value, value: todaySpend };
}

async function checkVelocitySpike(rule: AlertRule): Promise<{ fires: boolean; value: number }> {
  // Compares spend in the most-recent complete 5-minute window against the
  // preceding window. `threshold_value` is the multiplier (e.g. 3 = fires
  // when current window spend is 3Ã— the previous window).
  const rows = await queryTb("spend_velocity_5min", {
    org_id:           rule.org_id,
    lookback_minutes: "20",   // look back 4 windows to find at least 2
  }) as { window_start: string; window_cost_usd: number }[];

  if (rows.length < 2) return { fires: false, value: 0 };

  // rows are DESC by window_start â€” first entry is most recent window
  const current  = rows[0]!.window_cost_usd;
  const previous = rows[1]!.window_cost_usd;

  if (previous === 0) return { fires: false, value: current };

  const ratio = current / previous;
  return {
    fires: ratio >= rule.threshold_value,
    value: current,
  };
}

// â”€â”€ PII detection alert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// threshold_value = max PII incidents allowed per hour before alerting

async function checkPiiDetection(rule: AlertRule): Promise<{ fires: boolean; value: number }> {
  const admin = getAdmin();
  const since = new Date(Date.now() - 3_600_000).toISOString(); // last 1 hour

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (admin as any)
    .from("pii_incidents" as any)
    .select("id", { count: "exact", head: true })
    .eq("org_id", rule.org_id)
    .gte("created_at", since) as { count: number | null; error: unknown };

  if (error || count === null) return { fires: false, value: 0 };

  return {
    fires: count >= rule.threshold_value,
    value: count,
  };
}

// PRD-5: fire when the latest overall embedding drift (PSI) crosses the threshold
// (rule of thumb: 0.25 = significant shift). Reads drift_metrics written by the
// compute-drift cron.
async function checkDrift(rule: AlertRule): Promise<{ fires: boolean; value: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (getAdmin() as any)
    .from("drift_metrics")
    .select("value, computed_at")
    .eq("org_id", rule.org_id)
    .eq("segment", "all")
    .eq("metric", "psi")
    .order("computed_at", { ascending: false })
    .limit(1) as { data: { value: number | null }[] | null };

  const value = data?.[0]?.value;
  if (value == null) return { fires: false, value: 0 };
  return { fires: Number(value) >= rule.threshold_value, value: Number(value) };
}

// PRD-1 (P1.7): fire when the most-recent day's online-eval pass-rate drops by
// >= threshold_value (e.g. 0.1 = a 10-point drop) versus the trailing baseline.
// Reads quality_timeseries (fed by the eval_score_events mirror). Requires a
// minimum of scores in both windows so a thin day can't trip it.
async function checkQualityDrop(rule: AlertRule): Promise<{ fires: boolean; value: number }> {
  const now  = new Date();
  const from = new Date(now.getTime() - 14 * 86_400_000);
  const rows = await queryTb("quality_timeseries", {
    org_id:    rule.org_id,
    from_date: tbDate(from),
    to_date:   tbDate(now),
  }) as { date: string; scores: number; pass_rate: number }[];

  if (rows.length < 2) return { fires: false, value: 0 };
  const sorted   = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const latest   = sorted[sorted.length - 1]!;
  const baseline = sorted.slice(0, -1);

  const recentScores = latest.scores ?? 0;
  const baseScores   = baseline.reduce((s, r) => s + (r.scores ?? 0), 0);
  if (recentScores < 3 || baseScores < 5) return { fires: false, value: 0 };

  // Volume-weighted baseline pass-rate (each day's pass_rate weighted by its score count).
  const baseRate = baseline.reduce((s, r) => s + (r.pass_rate ?? 0) * (r.scores ?? 0), 0) / baseScores;
  const drop     = baseRate - (latest.pass_rate ?? 0);
  return { fires: drop >= rule.threshold_value, value: Math.round(drop * 10000) / 10000 };
}

// â”€â”€ Cooldown check (1 hour between firings per rule) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function isOnCooldown(rule: AlertRule): boolean {
  if (!rule.last_fired_at) return false;
  return Date.now() - new Date(rule.last_fired_at).getTime() < 3_600_000;
}

// â”€â”€ Fire an alert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function fireAlert(rule: AlertRule, metricValue: number): Promise<void> {
  const orgName = await getOrgName(rule.org_id);
  const base = {
    ruleName:    rule.name,
    orgName,
    triggerType: rule.trigger_type,
    metricValue,
    threshold:   rule.threshold_value,
  };

  const tasks: Promise<void>[] = [];

  if (rule.channels.includes("email")) {
    const emails = await getAdminEmails(rule.org_id);
    if (emails.length > 0) {
      tasks.push(sendAlertEmail({ ...base, to: emails }).catch(console.error));
    }
  }

  if (rule.channels.includes("slack") && rule.slack_webhook) {
    tasks.push(sendSlackAlert({ ...base, webhookUrl: rule.slack_webhook }).catch(console.error));
  }

  if (rule.channels.includes("webhook") && rule.custom_webhook) {
    tasks.push(sendCustomWebhook({ ...base, url: rule.custom_webhook }).catch(console.error));
  }

  await Promise.allSettled(tasks);

  // Update last_fired_at
  await getAdmin()
    .from("alert_rules")
    .update({ last_fired_at: new Date().toISOString() })
    .eq("id", rule.id);
}

// â”€â”€ Evaluate a single rule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function evaluateRule(rule: AlertRule): Promise<void> {
  if (isOnCooldown(rule)) return;

  let result: { fires: boolean; value: number };

  switch (rule.trigger_type) {
    case "budget_threshold":        result = await checkBudgetThreshold(rule);        break;
    case "spend_spike":             result = await checkSpendSpike(rule);             break;
    case "statistical_anomaly":     result = await checkStatisticalAnomaly(rule);     break;
    case "error_rate":              result = await checkErrorRate(rule);              break;
    case "single_call_cost":        result = await checkSingleCallCost(rule);        break;
    case "daily_limit":             result = await checkDailyLimit(rule);             break;
    case "tool_call_loop":          result = await checkToolCallLoop(rule);           break;
    case "session_budget_threshold":result = await checkSessionBudgetThreshold(rule); break;
    case "velocity_spike":          result = await checkVelocitySpike(rule);          break;
    case "pii_detection":           result = await checkPiiDetection(rule);           break;
    case "drift":                   result = await checkDrift(rule);                  break;
    case "quality_drop":            result = await checkQualityDrop(rule);            break;
    default: return;
  }

  if (result.fires) {
    await fireAlert(rule, result.value);
  }
}

// â”€â”€ Public: evaluate all active rules for an org â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function evaluateOrgAlerts(orgId: string): Promise<{ fired: number; evaluated: number }> {
  const { data: rules } = await getAdmin()
    .from("alert_rules")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true);

  if (!rules?.length) return { fired: 0, evaluated: 0 };

  let fired = 0;
  for (const rule of rules as AlertRule[]) {
    const beforeFired = rule.last_fired_at;
    await evaluateRule(rule).catch(console.error);
    // Reload to check if it fired
    const { data: updated } = await getAdmin()
      .from("alert_rules")
      .select("last_fired_at")
      .eq("id", rule.id)
      .single();
    if ((updated as { last_fired_at: string | null } | null)?.last_fired_at !== beforeFired) fired++;
  }

  return { fired, evaluated: rules.length };
}

// â”€â”€ Key expiry checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ExpiringKey {
  id:               string;
  name:             string;
  org_id:           string;
  expires_at:       string;
}

async function checkExpiringKeys(): Promise<void> {
  const admin = getAdmin();
  const now     = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Keys expiring within 7 days that are still active
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: expiringKeys } = await (admin as any)
    .from("api_keys")
    .select("id, name, org_id, expires_at")
    .eq("is_active", true)
    .gte("expires_at", now.toISOString())
    .lte("expires_at", in7Days.toISOString());

  if (!expiringKeys?.length) return;

  // Keys that have already passed expiry â€” deactivate them
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: expiredKeys } = await (admin as any)
    .from("api_keys")
    .select("id, name, org_id")
    .eq("is_active", true)
    .lt("expires_at", now.toISOString());

  if (expiredKeys?.length) {
    const expiredIds = (expiredKeys as ExpiringKey[]).map(k => k.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from("api_keys").update({ is_active: false }).in("id", expiredIds);
    for (const key of expiredKeys as ExpiringKey[]) {
      await (admin as any).from("audit_log").insert({
        org_id:        key.org_id,
        actor_user_id: null,
        action:        "key.expired",
        target_type:   "api_key",
        target_id:     key.id,
        metadata:      { name: key.name },
      }).catch(console.error);
    }
  }

  // Send expiry warning emails
  const { sendAlertEmail } = await import("./notify");
  const { Resend } = await import("resend");

  if (!process.env.RESEND_API_KEY) return;
  const resend = new Resend(process.env.RESEND_API_KEY);

  for (const key of expiringKeys as ExpiringKey[]) {
    const daysLeft = Math.ceil(
      (new Date(key.expires_at).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
    );

    // assigned_user_id was dropped from api_keys — expiry warnings now go to org owners only
    const recipientIds: string[] = [];

    // Notify org admins
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: admins } = await (admin as any)
      .from("members").select("user_id").eq("org_id", key.org_id).in("role", ["owner"]);
    (admins ?? []).forEach((a: { user_id: string }) => {
      if (!recipientIds.includes(a.user_id)) recipientIds.push(a.user_id);
    });

    for (const uid of recipientIds) {
      const { data: { user } } = await admin.auth.admin.getUserById(uid);
      if (!user?.email) continue;
      await resend.emails.send({
        from:    process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev",
        to:      user.email,
        subject: `Prism key "${key.name}" expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        html: `
          <p>Hi,</p>
          <p>Your Prism API key <strong>${key.name}</strong> will expire in <strong>${daysLeft} day${daysLeft === 1 ? "" : "s"}</strong> on ${new Date(key.expires_at).toLocaleDateString()}.</p>
          <p>Ask your admin to issue a new key before it expires to avoid service interruption.</p>
        `,
      }).catch(console.error);
    }
  }
}

// â”€â”€ Public: evaluate all orgs (called by cron) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function evaluateAllOrgs(): Promise<{ orgs: number; fired: number }> {
  // Check and deactivate expired keys + send expiry warnings (runs every cron tick)
  await checkExpiringKeys().catch(console.error);

  // Get distinct org_ids that have active alert rules
  const { data: rows } = await getAdmin()
    .from("alert_rules")
    .select("org_id")
    .eq("is_active", true);

  if (!rows?.length) return { orgs: 0, fired: 0 };

  const orgIds = Array.from(new Set((rows as { org_id: string }[]).map(r => r.org_id)));
  let totalFired = 0;

  const results = await Promise.allSettled(
    orgIds.map(id => evaluateOrgAlerts(id))
  );

  for (const r of results) {
    if (r.status === "fulfilled") totalFired += r.value.fired;
  }

  return { orgs: orgIds.length, fired: totalFired };
}
