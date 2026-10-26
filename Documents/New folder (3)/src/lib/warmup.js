import * as registry from '../sources/index.js';

// Warm the cache in the background so first real requests are fast.
// Top-level mapnews feeds + the WordPress sources cover the website's
// default views; per-section caches fill on demand.
export function startWarmup() {
  setTimeout(async () => {
    for (const lang of ['en', 'fr', 'ar']) {
      registry.listNews({ source: 'map-portal', lang, limit: 10 }).catch(() => {});
      registry.warmMapnewsFeed(lang, null).catch(() => {});
    }
    registry.listNews({ source: 'map-sport', limit: 10 }).catch(() => {});
    registry.listNews({ source: 'hibasport', lang: 'ar', limit: 10 }).catch(() => {});

    // secondary: primary section feeds (used by category tabs) — deferred so
    // early user-facing requests (articles, top feeds) skip the pacing queue
    setTimeout(async () => {
      for (const lang of ['en', 'fr']) {
        try {
          const groups = await registry.getSections(lang);
          const sections = groups[0]?.sections || [];
          const primary = sections.filter((s) =>
            ['politique', 'economie', 'monde', 'general', 'sport', 'culture', 'social'].includes(s.slug)
          );
          for (const s of primary.slice(0, 6)) {
            await registry.warmMapnewsFeed(lang, s.slug).catch(() => {});
          }
        } catch {
          /* keep warming other languages */
        }
      }
    }, 45000);
  }, 1200);
}
