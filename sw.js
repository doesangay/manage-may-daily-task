// TaskFlow Service Worker — Background Notifications
const CACHE_NAME = 'taskflow-v2';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// ── Periodic Background Sync ──────────────────────────────────────────────────
// Fires even when the browser tab is closed (Chrome on Android/Desktop).
// The browser decides the actual interval (minimum ~12 hours on most platforms).
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'check-overdue-tasks') {
        event.waitUntil(checkAndNotify());
    }
});

// ── Regular Sync (fires when back online, also works in background) ───────────
self.addEventListener('sync', (event) => {
    if (event.tag === 'check-overdue-tasks') {
        event.waitUntil(checkAndNotify());
    }
});

// ── Message from the page (manual trigger / forced check) ────────────────────
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CHECK_OVERDUE') {
        checkAndNotifyWithData(event.data.overdueTasks);
    }
    // Page is saving tasks — store a snapshot so SW can access it later
    if (event.data && event.data.type === 'SAVE_TASKS_SNAPSHOT') {
        saveSnapshot(event.data.tasks);
    }
});

// ── Push (if you ever add a push server) ─────────────────────────────────────
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    event.waitUntil(
        self.registration.showNotification(data.title || '⏳ TaskFlow Reminder', {
            body: data.body || 'You have pending tasks.',
            icon: 'https://cdn-icons-png.flaticon.com/512/906/906334.png',
            badge: 'https://cdn-icons-png.flaticon.com/512/906/906334.png',
            vibrate: [200, 100, 200],
            tag: 'taskflow-push',
            renotify: true,
            data: { url: self.location.origin }
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url.includes('task-manager') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data?.url || '/');
            }
        })
    );
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function saveSnapshot(tasks) {
    // Use Cache Storage as a key-value store (IndexedDB-lite workaround)
    const cache = await caches.open(CACHE_NAME);
    const response = new Response(JSON.stringify(tasks), {
        headers: { 'Content-Type': 'application/json' }
    });
    await cache.put('/__tasks_snapshot__', response);
}

async function loadSnapshot() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const response = await cache.match('/__tasks_snapshot__');
        if (!response) return [];
        return await response.json();
    } catch {
        return [];
    }
}

function todayStr() { return new Date().toISOString().slice(0,10); }

async function checkAndNotify() {
    const tasks = await loadSnapshot();
    const overdue = tasks.filter(t => t.dueDate && t.dueDate < todayStr() && t.status !== 'done');
    if (overdue.length === 0) return;
    await fireNotification(overdue);
}

async function checkAndNotifyWithData(overdueTasks) {
    if (!overdueTasks || overdueTasks.length === 0) return;
    await fireNotification(overdueTasks);
}

async function fireNotification(overdueTasks) {
    // Group by due date for a clean summary
    const byDate = {};
    overdueTasks.forEach(t => {
        (byDate[t.dueDate] = byDate[t.dueDate] || []).push(t.title);
    });

    const lines = Object.entries(byDate)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, titles]) => `${date}: ${titles.join(', ')}`);

    const total = overdueTasks.length;
    const body = lines.join('\n');

    await self.registration.showNotification(`${total} overdue task${total > 1 ? 's' : ''} — TaskFlow`, {
        body: body,
        icon: 'https://cdn-icons-png.flaticon.com/512/906/906334.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/906/906334.png',
        vibrate: [200, 100, 200, 100, 200],
        tag: 'taskflow-pending',
        renotify: true,
        requireInteraction: true,    // stays on screen until dismissed
        data: { url: self.registration.scope }
    });
}
