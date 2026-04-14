/**
 * Campaign Analytics Routes
 *
 * Per-step analytics, reply trends, send time analysis,
 * sequence comparison, CSV export
 */

import type http from "node:http";
import type BetterSqlite3 from "better-sqlite3";

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function q<T>(db: BetterSqlite3.Database, sql: string, params: unknown[] = []): T[] {
  try { return db.prepare(sql).all(...params) as T[]; } catch { return []; }
}
function q1<T>(db: BetterSqlite3.Database, sql: string, params: unknown[] = []): T | undefined {
  try { return db.prepare(sql).get(...params) as T | undefined; } catch { return undefined; }
}

// ─── Per-Step Analytics ─────────────────────────────────────────

function handleStepAnalytics(db: BetterSqlite3.Database, sequenceId: string, res: http.ServerResponse): void {
  // Get sequence steps
  const sequence = q1<{ steps: string; name: string }>(db, "SELECT steps, name FROM email_sequences WHERE id = ?", [sequenceId]);
  if (!sequence) { json(res, { error: "Sequence not found" }, 404); return; }

  let steps: any[] = [];
  try { steps = JSON.parse(sequence.steps || "[]"); } catch {}

  // Get tracking data per step
  const stepStats = steps.map((step: any, idx: number) => {
    const sent = (q1<{ c: number }>(db, "SELECT COUNT(*) as c FROM open_click_tracking WHERE enrollment_id IN (SELECT id FROM sequence_enrollments WHERE sequence_id = ?) AND sequence_step = ? AND tracking_type = 'open'", [sequenceId, idx]) || { c: 0 }).c;
    const opens = (q1<{ c: number }>(db, "SELECT COUNT(DISTINCT enrollment_id) as c FROM open_click_tracking WHERE enrollment_id IN (SELECT id FROM sequence_enrollments WHERE sequence_id = ?) AND sequence_step = ? AND tracking_type = 'open'", [sequenceId, idx]) || { c: 0 }).c;
    const clicks = (q1<{ c: number }>(db, "SELECT COUNT(*) as c FROM open_click_tracking WHERE enrollment_id IN (SELECT id FROM sequence_enrollments WHERE sequence_id = ?) AND sequence_step = ? AND tracking_type = 'click'", [sequenceId, idx]) || { c: 0 }).c;

    // Count enrollments that reached this step
    const reached = (q1<{ c: number }>(db, "SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND current_step > ?", [sequenceId, idx]) || { c: 0 }).c;
    const total = (q1<{ c: number }>(db, "SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ?", [sequenceId]) || { c: 0 }).c;

    return {
      step: idx,
      day: step.day || 0,
      subject: step.subject || step.action || `Step ${idx + 1}`,
      reached,
      opens,
      clicks,
      openRate: reached > 0 ? Math.round((opens / reached) * 100) : 0,
      clickRate: reached > 0 ? Math.round((clicks / reached) * 100) : 0,
      dropoffRate: total > 0 ? Math.round(((total - reached) / total) * 100) : 0,
    };
  });

  json(res, { sequenceId, sequenceName: sequence.name, steps: stepStats });
}

// ─── Reply Rate Trends ──────────────────────────────────────────

function handleReplyTrends(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const days = Math.min(90, parseInt(params.get("days") || "30", 10));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Daily sent vs replied
  const dailySent = q<{ day: string; count: number }>(db,
    "SELECT DATE(created_at) as day, COUNT(*) as count FROM email_events WHERE event_type = 'sent' AND created_at >= ? GROUP BY DATE(created_at) ORDER BY day", [since]);
  const dailyReplied = q<{ day: string; count: number }>(db,
    "SELECT DATE(created_at) as day, COUNT(*) as count FROM email_events WHERE event_type = 'replied' AND created_at >= ? GROUP BY DATE(created_at) ORDER BY day", [since]);
  const dailyOpened = q<{ day: string; count: number }>(db,
    "SELECT DATE(created_at) as day, COUNT(*) as count FROM email_events WHERE event_type = 'opened' AND created_at >= ? GROUP BY DATE(created_at) ORDER BY day", [since]);

  // Merge into single timeline
  const dayMap: Record<string, { sent: number; replied: number; opened: number }> = {};
  for (const d of dailySent) dayMap[d.day] = { sent: d.count, replied: 0, opened: 0 };
  for (const d of dailyReplied) { if (!dayMap[d.day]) dayMap[d.day] = { sent: 0, replied: 0, opened: 0 }; dayMap[d.day].replied = d.count; }
  for (const d of dailyOpened) { if (!dayMap[d.day]) dayMap[d.day] = { sent: 0, replied: 0, opened: 0 }; dayMap[d.day].opened = d.count; }

  const timeline = Object.entries(dayMap).sort((a, b) => a[0].localeCompare(b[0])).map(([day, data]) => ({
    day,
    ...data,
    replyRate: data.sent > 0 ? Math.round((data.replied / data.sent) * 100) : 0,
    openRate: data.sent > 0 ? Math.round((data.opened / data.sent) * 100) : 0,
  }));

  json(res, { timeline, periodDays: days });
}

// ─── Best Send Time Analysis ────────────────────────────────────

function handleSendTimeAnalysis(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  // Analyze which hours get best open/reply rates
  const hourlyOpens = q<{ hour: number; opens: number; total: number }>(db, `
    SELECT CAST(strftime('%H', e_open.created_at) AS INTEGER) as hour,
      COUNT(*) as opens,
      (SELECT COUNT(*) FROM email_events WHERE event_type = 'sent' AND CAST(strftime('%H', created_at) AS INTEGER) = CAST(strftime('%H', e_open.created_at) AS INTEGER)) as total
    FROM email_events e_open
    WHERE e_open.event_type = 'opened'
    GROUP BY hour ORDER BY hour
  `);

  const hourlyReplies = q<{ hour: number; replies: number }>(db, `
    SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as replies
    FROM email_events WHERE event_type = 'replied'
    GROUP BY hour ORDER BY hour
  `);

  // Build 24-hour heatmap
  const hours = Array.from({ length: 24 }, (_, i) => {
    const openData = hourlyOpens.find(h => h.hour === i);
    const replyData = hourlyReplies.find(h => h.hour === i);
    return {
      hour: i,
      label: `${i.toString().padStart(2, "0")}:00`,
      opens: openData?.opens || 0,
      replies: replyData?.replies || 0,
      openRate: openData && openData.total > 0 ? Math.round((openData.opens / openData.total) * 100) : 0,
    };
  });

  // Find best hours
  const bestOpenHour = hours.reduce((best, h) => h.openRate > best.openRate ? h : best, hours[0]);
  const bestReplyHour = hours.reduce((best, h) => h.replies > best.replies ? h : best, hours[0]);

  // Day of week analysis
  const dayOfWeek = q<{ day: number; opens: number; sent: number }>(db, `
    SELECT CAST(strftime('%w', created_at) AS INTEGER) as day, COUNT(*) as opens,
      (SELECT COUNT(*) FROM email_events WHERE event_type = 'sent') as sent
    FROM email_events WHERE event_type = 'opened'
    GROUP BY day ORDER BY day
  `);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdays = DAYS.map((name, i) => {
    const data = dayOfWeek.find(d => d.day === i);
    return { day: i, name, opens: data?.opens || 0 };
  });

  json(res, { hours, weekdays, bestOpenHour: bestOpenHour.label, bestReplyHour: bestReplyHour.label });
}

// ─── Sequence Comparison ────────────────────────────────────────

function handleSequenceComparison(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const sequences = q<{ id: string; name: string; status: string }>(db, "SELECT id, name, status FROM email_sequences ORDER BY created_at DESC");

  const comparison = sequences.map(seq => {
    const enrolled = (q1<{ c: number }>(db, "SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ?", [seq.id]) || { c: 0 }).c;
    const active = (q1<{ c: number }>(db, "SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND status = 'active'", [seq.id]) || { c: 0 }).c;
    const completed = (q1<{ c: number }>(db, "SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND status = 'completed'", [seq.id]) || { c: 0 }).c;
    const replied = (q1<{ c: number }>(db, "SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND status = 'replied'", [seq.id]) || { c: 0 }).c;
    const bounced = (q1<{ c: number }>(db, "SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND status = 'bounced'", [seq.id]) || { c: 0 }).c;

    return {
      id: seq.id,
      name: seq.name,
      status: seq.status,
      enrolled,
      active,
      completed,
      replied,
      bounced,
      replyRate: enrolled > 0 ? Math.round((replied / enrolled) * 100) : 0,
      completionRate: enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0,
    };
  });

  json(res, { sequences: comparison });
}

// ─── Export Campaign Analytics CSV ──────────────────────────────

function handleExportAnalytics(db: BetterSqlite3.Database, campaignId: string, res: http.ServerResponse): void {
  const campaign = q1<any>(db, "SELECT * FROM campaigns WHERE id = ?", [campaignId]);
  if (!campaign) { json(res, { error: "Campaign not found" }, 404); return; }

  const events = q<{ event_type: string; created_at: string; prospect_id: string }>(db,
    "SELECT event_type, created_at, prospect_id FROM email_events WHERE campaign_id = ? ORDER BY created_at", [campaignId]);

  const headers = ["event_type", "prospect_id", "created_at"];
  const csv = [
    `# Campaign: ${campaign.name}`,
    `# Sent: ${campaign.total_sent}, Opened: ${campaign.total_opened}, Clicked: ${campaign.total_clicked}, Replied: ${campaign.total_replied}, Converted: ${campaign.total_converted}`,
    headers.join(","),
    ...events.map(e => `${e.event_type},${e.prospect_id || ""},${e.created_at}`),
  ];

  res.writeHead(200, {
    "Content-Type": "text/csv",
    "Content-Disposition": `attachment; filename=campaign_${campaignId}_analytics.csv`,
  });
  res.end(csv.join("\n"));
}

// ─── Route Handler ──────────────────────────────────────────────

export async function handleAnalyticsRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: BetterSqlite3.Database,
  pathOnly: string,
  method: string,
  url: string,
): Promise<boolean> {
  const stepMatch = pathOnly.match(/^\/api\/analytics\/steps\/([^/]+)$/);
  const exportMatch = pathOnly.match(/^\/api\/analytics\/export\/([^/]+)$/);

  if (stepMatch && method === "GET") { handleStepAnalytics(db, stepMatch[1], res); return true; }
  if (pathOnly === "/api/analytics/reply-trends" && method === "GET") { handleReplyTrends(db, res, url); return true; }
  if (pathOnly === "/api/analytics/send-time" && method === "GET") { handleSendTimeAnalysis(db, res); return true; }
  if (pathOnly === "/api/analytics/sequences" && method === "GET") { handleSequenceComparison(db, res); return true; }
  if (exportMatch && method === "GET") { handleExportAnalytics(db, exportMatch[1], res); return true; }

  return false;
}
