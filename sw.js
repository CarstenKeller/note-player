
const CACHE = 'notenspieler-' + "0.1.35-f4ded94";
const FILES = ["./","./assets/pdf.worker.min-rsCePomN.mjs","./assets/index-BnCLV4iv.css","./assets/index-BDw7HBR6.js","./assets/pdf-DPWvYrMc.js","./assets/pdf.worker.min-7WEkucD6.js","./assets/ocr-YuuRVjk4.js","./assets/index-C2BXNto2.js","./assets/worker-MWEiSuH5.js","./guitar/A2.mp3","./guitar/A3.mp3","./guitar/A4.mp3","./guitar/As2.mp3","./guitar/As3.mp3","./guitar/As4.mp3","./guitar/B2.mp3","./guitar/B3.mp3","./guitar/B4.mp3","./guitar/C3.mp3","./guitar/C4.mp3","./guitar/C5.mp3","./guitar/Cs3.mp3","./guitar/Cs4.mp3","./guitar/Cs5.mp3","./guitar/D2.mp3","./guitar/D3.mp3","./guitar/D4.mp3","./guitar/D5.mp3","./guitar/Ds2.mp3","./guitar/Ds3.mp3","./guitar/Ds4.mp3","./guitar/E2.mp3","./guitar/E3.mp3","./guitar/E4.mp3","./guitar/F2.mp3","./guitar/F3.mp3","./guitar/F4.mp3","./guitar/Fs2.mp3","./guitar/Fs3.mp3","./guitar/Fs4.mp3","./guitar/G2.mp3","./guitar/G3.mp3","./guitar/G4.mp3","./guitar/Gs2.mp3","./guitar/Gs3.mp3","./guitar/Gs4.mp3","./guitar/QUELLE.txt","./icons/apple-touch-icon.png","./icons/icon-192.png","./icons/icon-512.png","./manifest.webmanifest","./piano/A0.mp3","./piano/A1.mp3","./piano/A2.mp3","./piano/A3.mp3","./piano/A4.mp3","./piano/A5.mp3","./piano/A6.mp3","./piano/A7.mp3","./piano/C1.mp3","./piano/C2.mp3","./piano/C3.mp3","./piano/C4.mp3","./piano/C5.mp3","./piano/C6.mp3","./piano/C7.mp3","./piano/C8.mp3","./piano/Ds1.mp3","./piano/Ds2.mp3","./piano/Ds3.mp3","./piano/Ds4.mp3","./piano/Ds5.mp3","./piano/Ds6.mp3","./piano/Ds7.mp3","./piano/Fs1.mp3","./piano/Fs2.mp3","./piano/Fs3.mp3","./piano/Fs4.mp3","./piano/Fs5.mp3","./piano/Fs6.mp3","./piano/Fs7.mp3","./piano/QUELLE.txt"];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});
self.addEventListener('activate', (e) => {
  // the text recognition's cache is kept across versions (it changes rarely)
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'notenspieler-ocr').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // the page itself: the newest from the network, the stored one offline
    e.respondWith(fetch(req).catch(() => caches.match('./', { ignoreSearch: true })));
    return;
  }
  if (new URL(req.url).pathname.includes('/ocr/')) {
    // the text recognition: kept after its first use (then also offline)
    e.respondWith(caches.open('notenspieler-ocr').then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }))));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
