import { getAuthBase, getAuthHeaders } from '@/component/login/authFlow';

export type NotificationCategory = 'system' | 'community';

export type NotificationType =
    | 'system.submission.approved'
    | 'system.submission.needs_review'
    | 'system.remove_request.resolved'
    | 'community.comment.reply'
    | 'community.comment.vote';

export interface NotificationUnreadCounts {
    system: number;
    community: number;
    total: number;
}

export interface NotificationTarget {
    submissionId: string | null;
    parentSubmissionId: string | null;
    markerId: string | null;
    poiHash: string | null;
    poiType: string | null;
}

export interface NotificationItem {
    id: string;
    type: NotificationType;
    payload: Record<string, unknown>;
    target: NotificationTarget;
    readAt: string | null;
    createdAt: string;
    isMultiMsg: boolean;
    messages: NotificationItem[];
}

export interface NotificationListResult {
    items: NotificationItem[];
    nextCursor: string | null;
    unread: NotificationUnreadCounts;
}

export interface NotificationLiveUpdate {
    notification: NotificationItem;
    unread: NotificationUnreadCounts;
}

export class NotifyClientError extends Error {
    readonly code: string;
    readonly status?: number;

    constructor(message: string, code = 'NOTIFY_ERROR', status?: number) {
        super(message);
        this.name = 'NotifyClientError';
        this.code = code;
        this.status = status;
    }
}

const NOTIFY_API_BASE = `${getAuthBase()}/notify/v1`;
const EMPTY_UNREAD: NotificationUnreadCounts = { system: 0, community: 0, total: 0 };

const isRecord = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const asString = (value: unknown): string | null => (
    typeof value === 'string' && value.trim() ? value : null
);

const asCount = (value: unknown): number => {
    const count = Number(value);
    return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
};

const normalizeType = (value: unknown): NotificationType | null => {
    const type = asString(value);
    if (
        type === 'system.submission.approved'
        || type === 'system.submission.needs_review'
        || type === 'system.remove_request.resolved'
        || type === 'community.comment.reply'
        || type === 'community.comment.vote'
    ) {
        return type;
    }
    return null;
};

export const notificationCategoryForType = (type: NotificationType): NotificationCategory => (
    type.startsWith('community.') ? 'community' : 'system'
);

export const normalizeNotificationUnread = (value: unknown): NotificationUnreadCounts => {
    if (!isRecord(value)) return { ...EMPTY_UNREAD };
    const system = asCount(value.system);
    const community = asCount(value.community);
    return {
        system,
        community,
        total: Number.isFinite(Number(value.total)) ? asCount(value.total) : system + community,
    };
};

export const normalizeNotificationItem = (
    value: unknown,
): NotificationItem | null => {
    if (!isRecord(value)) return null;

    const rawPayload: Record<string, unknown> = isRecord(value.payload) ? value.payload : {};
    const payload: Record<string, unknown> = {};
    if (rawPayload.kind === 'image' || rawPayload.kind === 'comment') {
        payload.kind = rawPayload.kind;
    }
    if (rawPayload.messageCount !== undefined) {
        payload.messageCount = rawPayload.messageCount;
    }
    const targetValue = isRecord(value.target) ? value.target : {};
    const id = asString(value.id);
    const type = normalizeType(value.type);
    const createdAt = asString(value.createdAt);
    if (!id || !type || !createdAt) return null;
    const target = {
        submissionId: asString(targetValue.submissionId),
        parentSubmissionId: asString(targetValue.parentSubmissionId),
        markerId: asString(targetValue.markerId),
        poiHash: asString(targetValue.poiHash),
        poiType: asString(targetValue.poiType),
    };
    const messages = Array.isArray(value.messages)
        ? value.messages.flatMap((item) => {
            const normalized = normalizeNotificationItem(item);
            return normalized ? [normalized] : [];
        })
        : [];

    return {
        id,
        type,
        payload,
        target,
        readAt: asString(value.readAt),
        createdAt,
        isMultiMsg: value.isMultiMsg === true,
        messages,
    };
};

const readNotifyError = async (response: Response): Promise<NotifyClientError> => {
    try {
        const payload = await response.json() as {
            code?: string;
            message?: string;
            error?: { code?: string; message?: string };
        };
        return new NotifyClientError(
            payload.message ?? payload.error?.message ?? `HTTP ${response.status}`,
            payload.code ?? payload.error?.code ?? `HTTP_${response.status}`,
            response.status,
        );
    } catch {
        return new NotifyClientError(`HTTP ${response.status}`, `HTTP_${response.status}`, response.status);
    }
};

const requestJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    Object.entries(getAuthHeaders()).forEach(([key, value]) => headers.set(key, value));
    if (init?.body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${NOTIFY_API_BASE}${path}`, {
        ...init,
        credentials: 'include',
        headers,
    });
    if (!response.ok) throw await readNotifyError(response);
    return response.json() as Promise<T>;
};

export const listNotifications = async (
    category: NotificationCategory,
    options: { cursor?: string | null; limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationListResult> => {
    const query = new URLSearchParams();
    query.set('limit', String(Math.min(50, Math.max(1, options.limit ?? 20))));
    if (options.cursor) query.set('cursor', options.cursor);
    if (options.unreadOnly) query.set('unreadOnly', '1');

    const response = await requestJson<{
        items?: unknown[];
        nextCursor?: unknown;
        unread?: unknown;
    }>(`/${category}/messages?${query.toString()}`);

    return {
        items: (response.items ?? []).flatMap((item) => {
            const normalized = normalizeNotificationItem(item);
            return normalized ? [normalized] : [];
        }),
        nextCursor: asString(response.nextCursor),
        unread: normalizeNotificationUnread(response.unread),
    };
};

export const getNotificationUnreadCounts = async (): Promise<NotificationUnreadCounts> => {
    const response = await requestJson<{ unread?: unknown }>('/unread-count');
    return normalizeNotificationUnread(response.unread);
};

export const markNotificationRead = async (
    category: NotificationCategory,
    id: string,
): Promise<NotificationUnreadCounts> => {
    const response = await requestJson<{ unread?: unknown }>(
        `/${category}/messages/${encodeURIComponent(id)}/read`,
        { method: 'PATCH' },
    );
    return normalizeNotificationUnread(response.unread);
};

export const markAllNotificationsRead = async (
    category: NotificationCategory,
): Promise<NotificationUnreadCounts> => {
    const response = await requestJson<{ unread?: unknown }>(`/${category}/read-all`, { method: 'POST' });
    return normalizeNotificationUnread(response.unread);
};

interface NotificationLiveOptions {
    onUpdate: (update: NotificationLiveUpdate) => void;
    onOpen?: () => void;
}

const notificationLiveUrl = (): string => {
    const url = new URL(`${getAuthBase()}/notify/v1/live`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('clientId', crypto.randomUUID());
    return url.toString();
};

export const subscribeNotificationLive = ({ onUpdate, onOpen }: NotificationLiveOptions): (() => void) => {
    if (typeof WebSocket === 'undefined') return () => undefined;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let stopped = false;

    const scheduleReconnect = () => {
        if (stopped || reconnectTimer !== undefined) return;
        const delay = Math.min(30_000, 1_000 * (2 ** reconnectAttempt));
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(() => {
            reconnectTimer = undefined;
            connect();
        }, delay);
    };

    const connect = () => {
        if (stopped) return;
        socket = new WebSocket(notificationLiveUrl());
        socket.addEventListener('open', () => {
            reconnectAttempt = 0;
            onOpen?.();
        });
        socket.addEventListener('message', (event) => {
            if (typeof event.data !== 'string') return;
            try {
                const raw = JSON.parse(event.data) as unknown;
                if (!isRecord(raw) || raw.event !== 'notification.upserted') return;
                const notification = normalizeNotificationItem(raw.notification);
                if (!notification) return;
                onUpdate({
                    notification,
                    unread: normalizeNotificationUnread(raw.unread),
                });
            } catch {
                // Ignore malformed live messages and keep the connection alive.
            }
        });
        socket.addEventListener('close', scheduleReconnect);
        socket.addEventListener('error', () => socket?.close());
    };

    connect();
    return () => {
        stopped = true;
        if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
        socket?.close(1000, 'notification subscription closed');
        socket = null;
    };
};
