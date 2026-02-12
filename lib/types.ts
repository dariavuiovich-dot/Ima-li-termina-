export type SlotStatus = "HAS_SLOTS" | "NO_SLOTS";

export interface SlotRecord {
  section: string;
  code: string;
  specialist: string;
  status: SlotStatus;
  firstAvailable: string | null;
  lastBooked: string | null;
  sourcePdfDate: string;
  sourcePdfUrl: string;
}

export interface SpecialistSlot {
  key: string;
  section: string;
  specialist: string;
  status: SlotStatus;
  firstAvailable: string | null;
  codes: string[];
  variants: number;
}

export interface SlotsSnapshot {
  generatedAt: string;
  sourcePdfDate: string;
  sourcePdfUrl: string;
  recordsCount: number;
  bySpecialist: SpecialistSlot[];
}

export type ChangeReason =
  | "OPENED_SLOTS"
  | "EARLIER_SLOT"
  | "NEW_SPECIALIST_WITH_SLOTS";

export interface SlotChange {
  key: string;
  section: string;
  specialist: string;
  reason: ChangeReason;
  previousStatus: SlotStatus | null;
  previousFirstAvailable: string | null;
  currentStatus: SlotStatus;
  currentFirstAvailable: string | null;
}

export interface WebPushSubscriptionData {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
}

export type DeliveryChannel = "in_app" | "webhook" | "telegram" | "web_push";

export interface Subscription {
  id: string;
  userId: string;
  query: string;
  channel: DeliveryChannel;
  webhookUrl?: string;
  telegramChatId?: string;
  pushSubscription?: WebPushSubscriptionData;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserNotification {
  id: string;
  userId: string;
  createdAt: string;
  title: string;
  message: string;
  payload: SlotChange;
  channel: DeliveryChannel;
}

export interface SyncResult {
  ok: boolean;
  skipped: boolean;
  trigger: string;
  sourcePdfDate: string | null;
  sourcePdfUrl: string | null;
  recordsCount: number;
  specialistsCount: number;
  changesCount: number;
  notificationsCount: number;
  reason?: string;
}
