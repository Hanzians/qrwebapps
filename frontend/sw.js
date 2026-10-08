const CACHE_NAME = 'pup-sas-v1.0.0';
const STATIC_ASSETS = [
  '/',
  '/icon.svg',
  '/icon.png',
  '/manifest.json',
  '/css/style.css',
  '/js/api.js',
  '/js/scanner.js',
  '/js/attendance_rules.js',
  '/login.html',
  '/index.html',
  '/student-dashboard.html',
  '/admin.html',
  '/scan.html',
  '/calendar.html',
  '/settings.html',
  '/reports.html',
  '/help.html',
  '/class-details.html',
  '/student-profile.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Use catch so it doesn't fail the whole install if one file is missing
      return Promise.all(
        STATIC_ASSETS.map(url => {
          return cache.add(url).catch(err => console.log('Failed to cache:', url, err));
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Do not intercept API requests or non-GET requests
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }

  const requestUrl = new URL(event.request.url);

  // For static assets (JS, CSS, icons, manifest), use Cache First strategy
  if (requestUrl.pathname.match(/\.(js|css|svg|png|json)$/)) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then(response => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }

  // For HTML files (navigation), use Network First strategy to ensure up-to-date data
  event.respondWith(
    fetch(event.request).then(response => {
      const respClone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, respClone));
      return response;
    }).catch(() => {
      return caches.match(event.request).then(cachedResponse => {
         if (cachedResponse) return cachedResponse;
         // Return the base shell if specific page isn't cached
         return caches.match('/');
      });
    })
  );
});
