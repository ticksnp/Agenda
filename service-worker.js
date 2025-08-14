// service-worker.js (Versão Final Corrigida)

const CACHE_NAME = 'agenda-pwa-v6'; // Aumentamos a versão para garantir a atualização

// ***** CORREÇÃO APLICADA AQUI *****
// Removemos todos os links de CDN. O Service Worker vai cachear apenas os arquivos locais do seu projeto.
const urlsToCache = [
    '/',
    '/index.html',
    '/login.html',
    '/style.css',
    '/app.js',
    '/whatsapp-client.js',
    '/firebase-config.js',
    '/login.js',
    '/manifest.json',
    '/icons/icon-192x192.png'
];

self.addEventListener('install', event => {
    self.skipWaiting(); // Força o novo service worker a ativar imediatamente
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Cacheando arquivos essenciais para a versão:', CACHE_NAME);
                return cache.addAll(urlsToCache);
            })
            .catch(error => {
                console.error('Falha ao cachear arquivos essenciais:', error);
            })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Service Worker: Deletando cache antigo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Torna o novo service worker o controlador de todas as abas abertas
    );
});

self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // Ignora completamente as chamadas para o Firebase e para o servidor local, indo sempre para a rede.
    if (requestUrl.hostname.includes('googleapis.com') || requestUrl.hostname === 'localhost') {
        return; // Deixa o navegador lidar com a requisição
    }

    // Para todas as outras solicitações, usa a estratégia "cache primeiro".
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Se encontrar no cache, retorna a resposta do cache.
                if (response) {
                    return response;
                }
                // Senão, busca na rede.
                return fetch(event.request);
            })
    );
});