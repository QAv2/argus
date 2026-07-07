// CORS proxy for APIs that don't allow browser requests
// Usage: /.netlify/functions/proxy?url=https://celestrak.org/...

const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 5_000_000;

// Allowlist: { host: exact hostname, paths: path-prefixes that must match (empty = any),
//              fallback: serve last good response when upstream returns non-2xx }
const ALLOWLIST = [
  { host: 'celestrak.org', paths: [], fallback: true },
  { host: 'api.adsb.lol', paths: [] },
  { host: 'raw.githubusercontent.com', paths: ['/airframesio/data/'] },
];

// In-memory fallback cache. Survives within a warm Netlify Function container,
// drops on cold start. Sufficient for handling CelesTrak's 2-hour rate-limit
// 403s during a single "warm" period; cold-start hits during a 403 window
// will still see blank. Upgrade to Netlify Blobs if that becomes a problem.
const fallbackCache = new Map(); // key: host+path+search → { status, contentType, body, ts }

function matchEntry(parsed) {
  const host = parsed.hostname.toLowerCase();
  for (const entry of ALLOWLIST) {
    const hostMatch = host === entry.host || host.endsWith('.' + entry.host);
    if (!hostMatch) continue;
    if (entry.paths.length === 0) return entry;
    if (entry.paths.some(p => parsed.pathname.startsWith(p))) return entry;
  }
  return null;
}

function cacheKey(parsed) {
  return parsed.hostname.toLowerCase() + parsed.pathname + parsed.search;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const targetUrl = event.queryStringParameters?.url;
  if (!targetUrl) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing ?url= parameter' }),
    };
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid URL' }),
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Only https: URLs are proxied' }),
    };
  }

  const entry = matchEntry(parsed);
  if (!entry) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Domain not in allowlist' }),
    };
  }

  const key = cacheKey(parsed);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  function serveFromFallback(reason) {
    if (!entry.fallback) return null;
    const cached = fallbackCache.get(key);
    if (!cached) return null;
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': cached.contentType,
        'Cache-Control': 'public, max-age=60',
        'X-Proxy-Cache': 'stale',
        'X-Proxy-Fallback-Reason': reason,
        'X-Proxy-Fallback-Age': String(Math.floor((Date.now() - cached.ts) / 1000)),
      },
      body: cached.body,
    };
  }

  try {
    const resp = await fetch(targetUrl, {
      headers: { 'User-Agent': 'ARGUS-Intel-Globe/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const contentLength = resp.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Upstream response too large' }),
      };
    }

    const body = await resp.text();
    if (body.length > MAX_BODY_BYTES) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Upstream response too large' }),
      };
    }

    const contentType = resp.headers.get('content-type') || 'application/json';

    // Successful response: cache for fallback, return live.
    // Skip caching HTML — upstreams (e.g. CelesTrak) sometimes return HTML
    // error/maintenance pages with 200; we don't want to serve those back as TLE.
    if (resp.status >= 200 && resp.status < 300) {
      const cacheable = entry.fallback && body.length > 0 && !contentType.includes('text/html');
      if (cacheable) {
        fallbackCache.set(key, { status: resp.status, contentType, body, ts: Date.now() });
      }
      return {
        statusCode: resp.status,
        headers: {
          ...headers,
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=120',
        },
        body,
      };
    }

    // Non-2xx: try fallback for cacheable upstreams (e.g. CelesTrak 403 rate-limit)
    const fallback = serveFromFallback(`upstream-${resp.status}`);
    if (fallback) return fallback;

    return {
      statusCode: resp.status,
      headers: { ...headers, 'Content-Type': contentType },
      body,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err.name === 'AbortError' ? 'Upstream timeout' : err.message;
    const fallback = serveFromFallback(err.name === 'AbortError' ? 'timeout' : 'fetch-error');
    if (fallback) return fallback;
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: msg }),
    };
  }
};
