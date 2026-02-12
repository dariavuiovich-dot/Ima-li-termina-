"use client";

import { FormEvent, useMemo, useState } from "react";

type SlotRow = {
  key: string;
  section: string;
  specialist: string;
  status: "HAS_SLOTS" | "NO_SLOTS";
  firstAvailable: string | null;
  codes: string[];
  slotKind?: "INVESTIGATION" | "SPECIALIST_VISIT";
};

type NotificationRow = {
  id: string;
  createdAt: string;
  title: string;
  message: string;
};

type SlotAnswer = {
  kind: "empty" | "none" | "single" | "narrow";
  text: string;
  specialist?: string;
  section?: string;
  status?: "HAS_SLOTS" | "NO_SLOTS";
  firstAvailable?: string | null;
  suggestions?: Array<{ label: string; query: string }>;
  bannerTone?: "success" | "danger" | "info";
};

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SlotRow[]>([]);
  const [relatedRows, setRelatedRows] = useState<SlotRow[]>([]);
  const [answer, setAnswer] = useState<SlotAnswer | null>(null);
  const [sourceDate, setSourceDate] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("demo-user");
  const [subQuery, setSubQuery] = useState("");
  const [channel, setChannel] = useState<"in_app" | "webhook" | "telegram">(
    "in_app"
  );
  const [webhookUrl, setWebhookUrl] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [subMessage, setSubMessage] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);

  const hasResults = useMemo(() => rows.length > 0, [rows]);

  async function runSearch(rawQuery: string) {
    setError(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (rawQuery.trim()) qs.set("q", rawQuery.trim());
      qs.set("limit", "50");

      const res = await fetch(`/api/slots?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load slots");

      setRows(data.items ?? []);
      setRelatedRows(data.relatedItems ?? []);
      setSourceDate(data.sourcePdfDate ?? null);
      setSourceUrl(data.sourcePdfUrl ?? null);
      setAnswer(data.answer ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function searchSlots(e?: FormEvent) {
    e?.preventDefault();
    await runSearch(query);
  }

  async function searchSuggestion(nextQuery: string) {
    setQuery(nextQuery);
    await runSearch(nextQuery);
  }

  async function createSubscription(e: FormEvent) {
    e.preventDefault();
    setSubMessage(null);

    const payload: Record<string, string> = {
      userId,
      query: subQuery,
      channel
    };
    if (channel === "webhook") payload.webhookUrl = webhookUrl;
    if (channel === "telegram") payload.telegramChatId = telegramChatId;

    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      setSubMessage(data?.error ?? "Subscription failed");
      return;
    }
    setSubMessage("Subscription saved");
    setSubQuery("");
  }

  async function loadNotifications() {
    const qs = new URLSearchParams({ userId, limit: "20" });
    const res = await fetch(`/api/notifications?${qs.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      setSubMessage(data?.error ?? "Failed to load notifications");
      return;
    }
    setNotifications(data.items ?? []);
  }

  return (
    <main>
      <div className="card">
        <h1>Ima li terminaaa!?</h1>
        <p className="meta">
          Ask in text form if a specialist has free slots and when the first slot
          is available.
        </p>
      </div>

      <form className="card" onSubmit={searchSlots}>
        <h2>Specijalista</h2>
        <div className="row">
          <input
            placeholder="reumatolog"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
        {sourceDate ? (
          <p className="meta">
            Source report date: {sourceDate}
            {sourceUrl ? (
              <>
                {" | "}
                <a href={sourceUrl} target="_blank" rel="noreferrer">
                  PDF
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        {error ? <p className="meta">{error}</p> : null}
      </form>

      <div className="card">
        <h2>Rezultate pretrage</h2>
        {answer ? (
          <p
            className={
              answer.bannerTone === "danger"
                ? "answer-banner answer-danger"
                : answer.bannerTone === "success"
                  ? "answer-banner answer-success"
                  : "answer-banner answer-info"
            }
          >
            {answer.text}
          </p>
        ) : null}

        {answer?.suggestions?.length ? (
          <div className="row">
            {answer.suggestions.map((s) => (
              <button
                key={`${s.label}_${s.query}`}
                type="button"
                className="secondary"
                onClick={() => void searchSuggestion(s.query)}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : null}

        {!hasResults ? (
          <p className="meta">
            {query.trim()
              ? "No exact match for your query."
              : "No results yet. Run search."}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>First Available</th>
                <th>Specialist</th>
                <th>Section</th>
                <th>Type</th>
                <th>Codes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={
                    row.status === "NO_SLOTS"
                      ? "row-no-slots"
                      : row.slotKind === "INVESTIGATION"
                        ? "row-investigation"
                        : "row-visit"
                  }
                >
                  <td className={row.status === "HAS_SLOTS" ? "status-ok" : "status-no"}>
                    {row.status}
                  </td>
                  <td>{row.firstAvailable ?? "-"}</td>
                  <td>{row.specialist}</td>
                  <td>{row.section}</td>
                  <td>
                    <span
                      className={
                        row.slotKind === "INVESTIGATION"
                          ? "kind-badge kind-investigation"
                          : "kind-badge kind-visit"
                      }
                    >
                      {row.slotKind === "INVESTIGATION"
                        ? "Investigation"
                        : "Specialist Visit"}
                    </span>
                  </td>
                  <td>{Array.isArray(row.codes) ? row.codes.join(", ") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {relatedRows.length > 0 ? (
          <>
            <h3 className="subhead">Related (not primary endocrinologist)</h3>
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>First Available</th>
                  <th>Specialist</th>
                  <th>Section</th>
                  <th>Type</th>
                  <th>Codes</th>
                </tr>
              </thead>
              <tbody>
                {relatedRows.map((row) => (
                  <tr
                    key={`rel_${row.key}`}
                    className={
                      row.status === "NO_SLOTS"
                        ? "row-no-slots"
                        : row.slotKind === "INVESTIGATION"
                          ? "row-investigation"
                          : "row-visit"
                    }
                  >
                    <td className={row.status === "HAS_SLOTS" ? "status-ok" : "status-no"}>
                      {row.status}
                    </td>
                    <td>{row.firstAvailable ?? "-"}</td>
                    <td>{row.specialist}</td>
                    <td>{row.section}</td>
                    <td>
                      <span
                        className={
                          row.slotKind === "INVESTIGATION"
                            ? "kind-badge kind-investigation"
                            : "kind-badge kind-visit"
                        }
                      >
                        {row.slotKind === "INVESTIGATION"
                          ? "Investigation"
                          : "Specialist Visit"}
                      </span>
                    </td>
                    <td>{Array.isArray(row.codes) ? row.codes.join(", ") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </div>

      <form className="card" onSubmit={createSubscription}>
        <h2>Notifications Subscription</h2>
        <div className="row">
          <input
            placeholder="User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <input
            placeholder="Specialist query (for matching)"
            value={subQuery}
            onChange={(e) => setSubQuery(e.target.value)}
          />
          <select
            value={channel}
            onChange={(e) =>
              setChannel(e.target.value as "in_app" | "webhook" | "telegram")
            }
          >
            <option value="in_app">in_app</option>
            <option value="webhook">webhook</option>
            <option value="telegram">telegram</option>
          </select>
        </div>
        {channel === "webhook" ? (
          <div className="row">
            <input
              placeholder="https://your-webhook.example.com"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
          </div>
        ) : null}
        {channel === "telegram" ? (
          <div className="row">
            <input
              placeholder="Telegram Chat ID"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
            />
          </div>
        ) : null}
        <div className="row">
          <button type="submit">Save Subscription</button>
          <button type="button" className="secondary" onClick={loadNotifications}>
            Load My Notifications
          </button>
        </div>
        {subMessage ? <p className="meta">{subMessage}</p> : null}
      </form>

      <div className="card">
        <h2>My Notifications</h2>
        {!notifications.length ? (
          <p className="meta">No notifications.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Title</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>{item.title}</td>
                  <td>{item.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

