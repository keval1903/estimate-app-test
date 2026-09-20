self.addEventListener('push', function(event) {
  let data = {}
  try {
    data = event.data.json()
  } catch (e) {
    console.error('Error parsing push data', e)
  }

  const title = data.title || 'New Notification'
  const options = {
    body: data.body || 'You have a new update.',
    icon: '/vite.svg',
    badge: '/vite.svg',
    data: { url: data.url || '/' },
    tag: data.tag || 'default'
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  )
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  
  const urlToOpen = new URL(event.notification.data.url, self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      let matchingClient = null;
      for (let i = 0; i < windowClients.length; i++) {
        const windowClient = windowClients[i];
        if (windowClient.url === urlToOpen) {
          matchingClient = windowClient;
          break;
        }
      }

      if (matchingClient) {
        return matchingClient.focus();
      } else {
        return self.clients.openWindow(urlToOpen);
      }
    })
  )
})
