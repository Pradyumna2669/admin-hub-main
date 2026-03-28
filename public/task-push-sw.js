self.addEventListener('push', (event) => {
  const payload = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return {};
    }
  })();

  const title = payload.title || 'New notification';
  const body =
    payload.body ||
    (payload.kind === 'chat'
      ? 'You have a new message.'
      : 'A new task is ready to claim.');
  const options = {
    body,
    icon: payload.icon || '/favicon.ico',
    badge: payload.badge || '/favicon.ico',
    tag: payload.tag || (payload.kind === 'chat' ? 'chat-message' : 'worker-task-alert'),
    data: {
      url: payload.url || (payload.kind === 'chat' ? '/chat/general' : '/worker/tasks'),
      taskIds: payload.taskIds || [],
      messageId: payload.messageId || null,
      room: payload.room || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/worker/tasks';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }

      return undefined;
    })
  );
});
