/**
 * WoodHatch Instagram feed — Cloudflare Worker
 *
 * GET /feed  → { posts: [{ id, image, caption, link, date, type }] }
 *
 * - Reads the latest posts from the Instagram API (Instagram Login flavour).
 * - Caches the result in KV for CACHE_SECONDS so Instagram is called at most once an hour.
 * - A daily cron renews the 60 day access token, so nobody has to touch it again.
 * - The token never leaves this Worker; the website only sees the JSON above.
 *
 * Bindings (see wrangler.toml):
 *   IG      KV namespace (stores the current token and the cached feed)
 *   IG_TOKEN       secret, the first long lived token from the Meta dashboard
 *   ALLOWED_ORIGIN comma separated list of sites allowed to read the feed
 */

const API = 'https://graph.instagram.com';
const FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
const LIMIT = 12;
const CACHE_SECONDS = 3600;
const REFRESH_AFTER_DAYS = 7;

async function getToken(env) {
  const saved = await env.IG.get('token', 'json');
  return saved?.value || env.IG_TOKEN;
}

async function refreshToken(env) {
  const saved = await env.IG.get('token', 'json');
  const age = saved ? (Date.now() - saved.at) / 864e5 : Infinity;
  if (age < REFRESH_AFTER_DAYS) return 'fresh';
  const current = saved?.value || env.IG_TOKEN;
  const r = await fetch(`${API}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(current)}`);
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data.error || data));
  await env.IG.put('token', JSON.stringify({ value: data.access_token, at: Date.now() }));
  return 'refreshed';
}

function tidy(item) {
  const image = item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url;
  if (!image) return null;
  return {
    id: item.id,
    type: item.media_type,
    image,
    caption: (item.caption || '').trim(),
    link: item.permalink,
    date: item.timestamp
  };
}

async function loadFeed(env) {
  const cached = await env.IG.get('feed', 'json');
  if (cached && Date.now() - cached.at < CACHE_SECONDS * 1000) return cached;

  try {
    const token = await getToken(env);
    const r = await fetch(`${API}/me/media?fields=${FIELDS}&limit=${LIMIT}&access_token=${encodeURIComponent(token)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data.error || data));
    const feed = { at: Date.now(), posts: (data.data || []).map(tidy).filter(Boolean) };
    await env.IG.put('feed', JSON.stringify(feed));
    return feed;
  } catch (err) {
    // Instagram is down or the token broke: serve the last good copy rather than nothing.
    if (cached) return { ...cached, stale: true };
    throw err;
  }
}

function cors(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
  const ok = allowed.includes('*') || allowed.includes(origin);
  return ok ? { 'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : origin, Vary: 'Origin' } : {};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = { 'Content-Type': 'application/json', ...cors(request, env) };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (url.pathname !== '/feed') return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
    try {
      const feed = await loadFeed(env);
      return new Response(JSON.stringify({ posts: feed.posts, updated: feed.at, stale: !!feed.stale }), {
        headers: { ...headers, 'Cache-Control': 'public, max-age=300' }
      });
    } catch (err) {
      console.error(err);
      return new Response(JSON.stringify({ error: 'Feed unavailable' }), { status: 502, headers });
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshToken(env).then(r => console.log('token', r)).catch(e => console.error(e)));
  }
};
