// Other music services the app can hand a track over to (opens their app or site).

export const PLATFORMS = [
  { id: 'vk', name: 'VK Музыка', where: 'в VK Музыке', url: (q) => `https://vk.com/audio?q=${q}` },
  { id: 'yandex', name: 'Яндекс Музыка', where: 'в Яндекс Музыке', url: (q) => `https://music.yandex.ru/search?text=${q}` },
  { id: 'ytm', name: 'YouTube Music', where: 'в YouTube Music', url: (q) => `https://music.youtube.com/search?q=${q}` },
  { id: 'soundcloud', name: 'SoundCloud', where: 'в SoundCloud', url: (q) => `https://soundcloud.com/search?q=${q}` },
];

export function platformById(id) {
  return PLATFORMS.find((p) => p.id === id) || null;
}

export function searchQuery(track) {
  return encodeURIComponent(`${track.artist || ''} ${track.title || ''}`.trim());
}

export function platformUrl(id, track) {
  const p = platformById(id);
  return p ? p.url(searchQuery(track)) : '';
}
