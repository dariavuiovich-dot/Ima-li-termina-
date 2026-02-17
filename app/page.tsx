"use client";

import { FormEvent, useMemo, useState } from "react";

type SlotRow = {
  key: string;
  section: string;
  specialist: string;
  status: "HAS_SLOTS" | "NO_SLOTS";
  firstAvailable: string | null;
  slotKind?: "INVESTIGATION" | "SPECIALIST_VISIT";
  note?: string;
  noteUrl?: string;
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

type ResultGroup = {
  title: string;
  items: SlotRow[];
};

type ScheduleRow = {
  id: string;
  ambulanta: string;
  doctor: string;
  schedule: string;
  location: string | null;
  sourceUrl: string;
};

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SlotRow[]>([]);
  const [resultGroups, setResultGroups] = useState<ResultGroup[]>([]);
  const [relatedRows, setRelatedRows] = useState<SlotRow[]>([]);
  const [relatedTitle, setRelatedTitle] = useState<string | null>(null);
  const [answer, setAnswer] = useState<SlotAnswer | null>(null);
  const [sourceDate, setSourceDate] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleQuery, setScheduleQuery] = useState("");
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSourceUrl, setScheduleSourceUrl] = useState<string | null>(null);

  const [userId, setUserId] = useState("demo-user");
  const [subQuery, setSubQuery] = useState("");
  const [channel, setChannel] = useState<
    "in_app" | "webhook" | "telegram" | "web_push"
  >("in_app");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [subMessage, setSubMessage] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);

  const hasResults = useMemo(
    () => rows.length > 0 || resultGroups.some((g) => g.items.length > 0),
    [rows, resultGroups]
  );
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
      setResultGroups(data.resultGroups ?? []);
      setRelatedRows(data.relatedItems ?? []);
      setRelatedTitle(data.relatedTitle ?? null);
      setSourceDate(data.sourcePdfDate ?? null);
      setSourceUrl(data.sourcePdfUrl ?? null);
      setAnswer(data.answer ?? null);
    } catch (err) {
      setRows([]);
      setResultGroups([]);
      setRelatedRows([]);
      setRelatedTitle(null);
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

  async function searchSchedule(e?: FormEvent) {
    e?.preventDefault();
    const raw = scheduleQuery.trim();
    setScheduleError(null);
    setScheduleLoading(true);

    try {
      const qs = new URLSearchParams();
      if (raw) qs.set("q", raw);
      qs.set("limit", "100");

      const res = await fetch(`/api/schedule?${qs.toString()}`);
      const data = await readJsonOrThrow(res, "Neuspjelo ucitavanje rasporeda");
      setScheduleRows(data.items ?? []);
      setScheduleSourceUrl(data.sourceUrl ?? null);
    } catch (err) {
      setScheduleRows([]);
      setScheduleSourceUrl(null);
      setScheduleError(
        err instanceof Error ? err.message : "Neuspjelo ucitavanje rasporeda"
      );
    } finally {
      setScheduleLoading(false);
    }
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
      await readJsonOrThrow(res, "Neuspjelo cuvanje pretplate");
    } catch (err) {
      setSubMessage(err instanceof Error ? err.message : "Neuspjelo cuvanje pretplate");
      return;
    }

    setSubMessage("Pretplata je sacuvana");
    setSubQuery("");
  }

  async function loadNotifications() {
    const qs = new URLSearchParams({ userId, limit: "20" });
    const res = await fetch(`/api/notifications?${qs.toString()}`);
    try {
      const data = await readJsonOrThrow(res, "Neuspjelo ucitavanje notifikacija");
      setNotifications(data.items ?? []);
    } catch (err) {
      setSubMessage(
        err instanceof Error ? err.message : "Neuspjelo ucitavanje notifikacija"
      );
      return;
    }
  }

  return (
    <main>
      <div className="card">
        <h1>Ima li terminaaa!?</h1>
        <p className="meta">
          Ukucajte naziv dijagnosticke pretrage ili specijaliste i mi cemo
          provjeriti da li ima termina za tu vrstu dijagnostike ili konsultativnog
          pregleda, provjericemo i kad je prvi slobodni termin.
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

      <form className="card" onSubmit={searchSchedule}>
        <h2>Kad ordinira?</h2>
        <p className="meta">
          Ukucajte prezime ili ime ljekara, ili specijalnost (npr. neurolog
          Vujovic, endokrinolog Muzurovic, samo Vujovic).
        </p>
        <div className="row">
          <input
            placeholder="npr. neurolog Vujovic"
            value={scheduleQuery}
            onChange={(e) => setScheduleQuery(e.target.value)}
          />
          <button type="submit" disabled={scheduleLoading}>
            {scheduleLoading ? "Provjeravam..." : "Provjeri raspored"}
          </button>
        </div>
        {scheduleSourceUrl ? (
          <p className="meta">
            Izvor:{" "}
            <a href={scheduleSourceUrl} target="_blank" rel="noreferrer">
              Poliklinika KCCG
            </a>
          </p>
        ) : null}
        {scheduleError ? <p className="meta">{scheduleError}</p> : null}
        {scheduleQuery.trim() && !scheduleLoading && !scheduleRows.length && !scheduleError ? (
          <p className="meta">Nema rezultata za uneseni upit.</p>
        ) : null}
        {scheduleRows.length ? (
          <table>
            <thead>
              <tr>
                <th>Ljekar</th>
                <th>Ambulanta / jedinica</th>
                <th>Dani i vrijeme</th>
                <th>Lokacija</th>
              </tr>
            </thead>
            <tbody>
              {scheduleRows.map((item) => (
                <tr key={item.id}>
                  <td>{item.doctor}</td>
                  <td>{item.ambulanta}</td>
                  <td>{item.schedule}</td>
                  <td>{item.location ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </form>

      <div className="card">
        <h2>Rezultate pretrage</h2>
        {answer && answer.kind !== "narrow" ? (
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

        {!hasResults ? (
          <p className="meta">
            {query.trim()
              ? "No exact match for your query."
              : "No results yet. Run search."}
          </p>
        ) : resultGroups.length > 0 ? (
          <>
            {resultGroups.map((group) => (
              <div key={group.title}>
                <h3 className="subhead">{group.title}</h3>
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
                    {group.items.map((row) => (
                      <tr
                        key={`${group.title}_${row.key}`}
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
                        <td>
                          <div>{row.specialist}</div>
                          {row.note ? (
                            <div className="note">
                              <span>{row.note}</span>
                              {row.noteUrl ? (
                                <>
                                  {" "}
                                  <a href={row.noteUrl} target="_blank" rel="noreferrer">
                                    (detalji)
                                  </a>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                        <td>{row.section}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </>
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
                  <td>
                    <div>{row.specialist}</div>
                    {row.note ? (
                      <div className="note">
                        <span>{row.note}</span>
                        {row.noteUrl ? (
                          <>
                            {" "}
                            <a href={row.noteUrl} target="_blank" rel="noreferrer">
                              (detalji)
                            </a>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                  <td>{row.section}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {relatedRows.length > 0 ? (
          <>
            <h3 className="subhead">{relatedTitle ?? "Related"}</h3>
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
                    <td>
                      <div>{row.specialist}</div>
                      {row.note ? (
                        <div className="note">
                          <span>{row.note}</span>
                          {row.noteUrl ? (
                            <>
                              {" "}
                              <a href={row.noteUrl} target="_blank" rel="noreferrer">
                                (detalji)
                              </a>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td>{row.section}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </div>

      <form className="card" onSubmit={createSubscription}>
        <h2>Notifikacije</h2>
        <p className="meta">
          Potpisite se na notifikacije za specijalistu/pretragu za kojeg dugo
          cekate termin: mi cemo da Vam posaljemo notifikaciju kad se pojavi prvi
          slobodni (ili raniji) termin za pregled tog specijaliste ili
          dijagnosticku pretragu od interesa.
        </p>
        <div className="row">
          <input
            placeholder="User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <input
            placeholder="Specijalista ili pretraga"
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
            Browser ce traziti dozvolu i registrovati push pretplatu nakon cuvanja.
          </p>
        ) : null}
        <div className="row">
          <button type="submit">Sacuvaj pretplatu</button>
          <button type="button" className="secondary" onClick={loadNotifications}>
            Ucitaj moje notifikacije
          </button>
        </div>
        {subMessage ? <p className="meta">{subMessage}</p> : null}
      </form>

      <div className="card">
        <h2>Moje notifikacije</h2>
        {!notifications.length ? (
          <p className="meta">Nema notifikacija.</p>
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

