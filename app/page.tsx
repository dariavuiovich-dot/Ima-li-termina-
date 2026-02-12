"use client";

import { FormEvent, useMemo, useState } from "react";

type SlotRow = {
  key: string;
  section: string;
  specialist: string;
  status: "HAS_SLOTS" | "NO_SLOTS";
  firstAvailable: string | null;
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
  const [channel, setChannel] = useState<
    "in_app" | "webhook" | "telegram" | "web_push"
  >("in_app");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [subMessage, setSubMessage] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);

  const hasResults = useMemo(() => rows.length > 0, [rows]);
  const statusLabel = (status: "HAS_SLOTS" | "NO_SLOTS") =>
    status === "HAS_SLOTS" ? "IMA TERMINA" : "NEMA TERMINA";

  async function readJsonOrThrow(
    res: Response,
    fallbackMessage: string
  ): Promise<any> {
    const contentType = res.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");

    if (isJson) {
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? fallbackMessage);
      }
      return data;
    }

    const body = await res.text();
    const looksLikeHtml =
      body.trimStart().startsWith("<!DOCTYPE") || body.includes("<html");

    if (looksLikeHtml) {
      throw new Error(
        "Server returned HTML error page. Restart localhost server (stop node, remove .next, run npm run dev)."
      );
    }

    throw new Error(fallbackMessage);
  }

  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function ensureWebPushSubscription(): Promise<Record<string, unknown>> {
    if (typeof window === "undefined") {
      throw new Error("Web push is only available in browser");
    }
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      throw new Error("This browser does not support push notifications");
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Push notifications permission is required");
    }

    const keyRes = await fetch("/api/push/public-key");
    const keyData = await readJsonOrThrow(
      keyRes,
      "Failed to load push public key"
    );
    const publicKey = String(keyData?.publicKey ?? "").trim();
    if (!publicKey) {
      throw new Error("Push public key is not configured");
    }

    const registration = await navigator.serviceWorker.register("/push-sw.js");
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource
      });
    }

    return subscription.toJSON() as Record<string, unknown>;
  }

  async function runSearch(rawQuery: string) {
    setError(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (rawQuery.trim()) qs.set("q", rawQuery.trim());
      qs.set("limit", "50");

      const res = await fetch(`/api/slots?${qs.toString()}`);
      const data = await readJsonOrThrow(res, "Failed to load slots");

      setRows(data.items ?? []);
      setRelatedRows(data.relatedItems ?? []);
      setSourceDate(data.sourcePdfDate ?? null);
      setSourceUrl(data.sourcePdfUrl ?? null);
      setAnswer(data.answer ?? null);
    } catch (err) {
      setRows([]);
      setRelatedRows([]);
      setAnswer(null);
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

    const payload: Record<string, unknown> = {
      userId,
      query: subQuery,
      channel
    };
    if (channel === "webhook") payload.webhookUrl = webhookUrl;
    if (channel === "telegram") payload.telegramChatId = telegramChatId;
    if (channel === "web_push") {
      payload.pushSubscription = await ensureWebPushSubscription();
    }

    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    try {
      await readJsonOrThrow(res, "Subscription failed");
    } catch (err) {
      setSubMessage(err instanceof Error ? err.message : "Subscription failed");
      return;
    }

    setSubMessage("Subscription saved");
    setSubQuery("");
  }

  async function loadNotifications() {
    const qs = new URLSearchParams({ userId, limit: "20" });
    const res = await fetch(`/api/notifications?${qs.toString()}`);
    try {
      const data = await readJsonOrThrow(res, "Failed to load notifications");
      setNotifications(data.items ?? []);
    } catch (err) {
      setSubMessage(err instanceof Error ? err.message : "Failed to load notifications");
      return;
    }
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
                <th>Prvi dostupni termin</th>
                <th>Specijalista</th>
                <th>Organizaciona jedinica</th>
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
                    {statusLabel(row.status)}
                  </td>
                  <td>{row.firstAvailable ?? "-"}</td>
                  <td>{row.specialist}</td>
                  <td>{row.section}</td>
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
                  <th>Prvi dostupni termin</th>
                  <th>Specijalista</th>
                  <th>Organizaciona jedinica</th>
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
                      {statusLabel(row.status)}
                    </td>
                    <td>{row.firstAvailable ?? "-"}</td>
                    <td>{row.specialist}</td>
                    <td>{row.section}</td>
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
              setChannel(
                e.target.value as "in_app" | "webhook" | "telegram" | "web_push"
              )
            }
          >
            <option value="in_app">in_app</option>
            <option value="webhook">webhook</option>
            <option value="telegram">telegram</option>
            <option value="web_push">web_push</option>
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
        {channel === "web_push" ? (
          <p className="meta">
            Browser will ask permission and register push subscription on save.
          </p>
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

