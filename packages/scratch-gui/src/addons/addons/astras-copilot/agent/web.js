/**
 * Web tools for the Astra Copilot agent: search the web and read pages.
 *
 * Both tools are read-only. The editor page cannot read arbitrary web pages
 * directly because of CORS, so requests fall back to public CORS proxies
 * (configurable via `config.webProxy`).
 *
 * Searching tries multiple engines in order until one succeeds:
 *   1. the preferred engine from `config.searchEngine` (default: DuckDuckGo)
 *   2. the remaining general engines (DuckDuckGo API, Bing, DuckDuckGo HTML)
 *   3. the Scratch Wiki search API (CORS-friendly, no proxy needed)
 *   4. a custom endpoint from `config.searchEndpoint`, when configured
 * This keeps whole-web search working even when one engine or proxy is
 * unreachable from the user's network.
 */

const DEFAULT_SEARCH_ENDPOINT = 'https://api.duckduckgo.com/';
const SCRATCH_WIKI_SEARCH = 'https://en.scratch-wiki.info/w/api.php';
const SCRATCH_WIKI_ARTICLE = 'https://en.scratch-wiki.info/wiki/';
const BING_SEARCH = 'https://www.bing.com/search';
const DUCKDUCKGO_HTML_SEARCH = 'https://html.duckduckgo.com/html/';
const FETCH_TIMEOUT_MS = 15000;
const SEARCH_TIMEOUT_MS = 15000;
const MAX_PAGE_CHARS = 20000;
const MAX_SEARCH_RESULTS = 8;
const MAX_RESULT_SNIPPET = 600;

const PROXY_FALLBACKS = [
  (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
  (target) => `https://corsproxy.io/?url=${encodeURIComponent(target)}`
];

const GENERAL_ENGINES = ['duckduckgo', 'bing', 'duckduckgo-html'];

/**
 * Fetch a URL with a timeout.
 * @param {string} url URL to fetch.
 * @param {number} timeoutMs Timeout in milliseconds.
 * @returns {Promise<Response>} Fetch response.
 */
const httpFetch = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Build a proxied URL from a proxy template.
 * @param {string} proxy Proxy template or base URL.
 * @param {string} target Target URL.
 * @returns {string} Proxied URL.
 */
const buildProxyUrl = (proxy, target) => {
  if (!proxy) return target;
  const template = String(proxy);
  if (template.includes('{url}')) return template.replace('{url}', encodeURIComponent(target));
  return `${template}${encodeURIComponent(target)}`;
};

/**
 * Fetch a URL, trying the direct request first, then any configured proxies
 * (comma-separated), then public CORS proxies.
 * @param {string} url Target URL.
 * @param {object} [options] Options.
 * @param {string} [options.proxy] Configured CORS proxy or comma-separated list.
 * @param {number} [options.timeoutMs] Per-attempt timeout.
 * @returns {Promise<Response>} Fetch response.
 */
const fetchWithProxy = async (url, { proxy = '', timeoutMs = FETCH_TIMEOUT_MS } = {}) => {
  const builders = [buildProxyUrl.bind(null, '')];
  const configured = String(proxy || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  for (const item of configured) builders.push(buildProxyUrl.bind(null, item));
  for (const fallback of PROXY_FALLBACKS) builders.push(fallback);

  let lastError = null;
  for (const builder of builders) {
    try {
      return await httpFetch(builder(url), timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Request failed.');
};

/**
 * Convert HTML into readable text using the browser DOM parser.
 * @param {string} html HTML source.
 * @returns {{title: string, text: string}} Extracted title and text.
 */
const htmlToText = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const tag of ['script', 'style', 'noscript', 'template', 'svg', 'head', 'iframe', 'object', 'embed']) {
    doc.querySelectorAll(tag).forEach((node) => node.remove());
  }
  const title = (doc.title || '').replace(/\s+/g, ' ').trim();
  let text = doc.body && doc.body.innerText ? doc.body.innerText : doc.body ? doc.body.textContent : '';
  text = String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
};

/**
 * Fetch a web page and return its readable text content.
 * @param {object} args Tool arguments.
 * @param {string} args.url URL to fetch.
 * @param {number} [args.maxChars] Maximum characters to return.
 * @param {object} config Agent configuration.
 * @returns {Promise<object>} Page content.
 */
const fetchUrl = async (args, config) => {
  const raw = String((args && args.url) || '').trim();
  if (!raw) throw new Error('url is required.');

  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new Error('Invalid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are supported.');
  }

  const response = await fetchWithProxy(url.toString(), { proxy: config && config.webProxy });
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const rawText = await response.text();
  const maxChars = Math.max(500, Math.min(80000, Number(args.maxChars) || MAX_PAGE_CHARS));

  if (contentType.includes('html')) {
    const { title, text } = htmlToText(rawText);
    if (!text.trim()) throw new Error('The page contains no readable text.');
    const truncated = text.length > maxChars;
    return {
      url: url.toString(),
      title,
      text: truncated ? `${text.slice(0, maxChars)}...` : text,
      chars: text.length,
      truncated
    };
  }

  const truncated = rawText.length > maxChars;
  return {
    url: url.toString(),
    title: '',
    text: truncated ? `${rawText.slice(0, maxChars)}...` : rawText,
    chars: rawText.length,
    truncated,
    sourceType: contentType || 'text'
  };
};

/**
 * Collect search results from DuckDuckGo Instant Answer JSON.
 * @param {object} data API response.
 * @param {number} limit Maximum results.
 * @returns {Array<object>} Search results.
 */
const collectDuckDuckGoResults = (data, limit) => {
  const results = [];
  const push = (title, resultUrl, snippet) => {
    if (!resultUrl) return;
    if (results.some((item) => item.url === resultUrl)) return;
    let label = String(title || '').trim();
    if (!label) {
      try {
        label = new URL(resultUrl).hostname;
      } catch (error) {
        label = resultUrl;
      }
    }
    results.push({
      title: label,
      url: resultUrl,
      snippet: String(snippet || '').slice(0, MAX_RESULT_SNIPPET)
    });
  };

  if (data.AbstractText && data.AbstractURL) {
    push(data.Heading || '', data.AbstractURL, data.AbstractText);
  }
  const flatten = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item.Topics)) flatten(item.Topics);
      else if (item.Text && item.FirstURL) push(item.Title || '', item.FirstURL, item.Text);
    }
  };
  flatten(data.RelatedTopics);
  if (Array.isArray(data.Results)) {
    for (const item of data.Results) push(item.Title || '', item.FirstURL, item.Text);
  }
  return results.slice(0, limit);
};

/**
 * Search using the DuckDuckGo Instant Answer API.
 * @param {string} query Search query.
 * @param {number} limit Maximum results.
 * @param {object} config Agent configuration.
 * @returns {Promise<object>} Search result.
 */
const searchViaDuckDuckGo = async (query, limit, config) => {
  const url = new URL(DEFAULT_SEARCH_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('no_html', '1');
  url.searchParams.set('skip_disambig', '1');

  const response = await fetchWithProxy(url.toString(), {
    proxy: config && config.webProxy,
    timeoutMs: SEARCH_TIMEOUT_MS
  });
  const data = await response.json();
  const results = collectDuckDuckGoResults(data, limit);
  if (results.length === 0) throw new Error('DuckDuckGo returned no results.');
  return { query, results, source: 'duckduckgo' };
};

/**
 * Extract results from a Bing search result page.
 * @param {string} html Bing HTML.
 * @param {number} limit Maximum results.
 * @returns {Array<object>} Search results.
 */
const parseBingResults = (html, limit) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = Array.from(doc.querySelectorAll('li.b_algo'));
  const results = [];
  for (const item of items) {
    if (results.length >= limit) break;
    const link = item.querySelector('h2 a') || item.querySelector('a');
    if (!link) continue;
    const title = (link.textContent || '').trim();
    const href = (link.getAttribute('href') || '').trim();
    if (!href || !/^https?:\/\//.test(href) || !title) continue;
    const snippetElement = item.querySelector('.b_caption p') || item.querySelector('p');
    const snippet = (snippetElement && snippetElement.textContent ? snippetElement.textContent : '').trim();
    results.push({
      title,
      url: href,
      snippet: snippet.slice(0, MAX_RESULT_SNIPPET)
    });
  }
  return results;
};

/**
 * Search using Bing's HTML results page (whole web).
 * @param {string} query Search query.
 * @param {number} limit Maximum results.
 * @param {object} config Agent configuration.
 * @returns {Promise<object>} Search result.
 */
const searchBing = async (query, limit, config) => {
  const url = new URL(BING_SEARCH);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(limit));
  url.searchParams.set('setlang', 'en');
  const response = await fetchWithProxy(url.toString(), {
    proxy: config && config.webProxy,
    timeoutMs: SEARCH_TIMEOUT_MS
  });
  const html = await response.text();
  const results = parseBingResults(html, limit);
  if (results.length === 0) throw new Error('Bing returned no results.');
  return { query, results, source: 'bing' };
};

/**
 * Extract results from a DuckDuckGo HTML results page.
 * @param {string} html DuckDuckGo HTML.
 * @param {number} limit Maximum results.
 * @returns {Array<object>} Search results.
 */
const parseDuckDuckGoHtmlResults = (html, limit) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = Array.from(doc.querySelectorAll('.result'));
  const results = [];
  for (const item of items) {
    if (results.length >= limit) break;
    const link = item.querySelector('.result__a');
    if (!link) continue;
    const title = (link.textContent || '').trim();
    const href = (link.getAttribute('href') || '').trim();
    if (!href || !title) continue;
    const snippetElement = item.querySelector('.result__snippet');
    const snippet = (snippetElement && snippetElement.textContent ? snippetElement.textContent : '').trim();
    results.push({
      title,
      url: href,
      snippet: snippet.slice(0, MAX_RESULT_SNIPPET)
    });
  }
  return results;
};

/**
 * Search using the DuckDuckGo HTML results page (whole web).
 * @param {string} query Search query.
 * @param {number} limit Maximum results.
 * @param {object} config Agent configuration.
 * @returns {Promise<object>} Search result.
 */
const searchDuckDuckGoHtml = async (query, limit, config) => {
  const url = new URL(DUCKDUCKGO_HTML_SEARCH);
  url.searchParams.set('q', query);
  const response = await fetchWithProxy(url.toString(), {
    proxy: config && config.webProxy,
    timeoutMs: SEARCH_TIMEOUT_MS
  });
  const html = await response.text();
  const results = parseDuckDuckGoHtmlResults(html, limit);
  if (results.length === 0) throw new Error('DuckDuckGo HTML returned no results.');
  return { query, results, source: 'duckduckgo-html' };
};

/**
 * Search the Scratch Wiki using its MediaWiki API (CORS-friendly).
 * @param {string} query Search query.
 * @param {number} limit Maximum results.
 * @returns {Promise<object>} Search result.
 */
const searchScratchWiki = async (query, limit) => {
  const url = new URL(SCRATCH_WIKI_SEARCH);
  url.searchParams.set('action', 'query');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srsearch', query);
  url.searchParams.set('srlimit', String(limit));
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  const response = await httpFetch(url.toString(), SEARCH_TIMEOUT_MS);
  const data = await response.json();
  const hits = data && data.query && Array.isArray(data.query.search) ? data.query.search : [];
  const results = hits.map((hit) => ({
    title: String(hit.title || '').replace(/<[^>]*>/g, ''),
    url: `${SCRATCH_WIKI_ARTICLE}${encodeURIComponent(String(hit.title || '').replace(/ /g, '_'))}`,
    snippet: String(hit.snippet || '')
      .replace(/<[^>]*>/g, '')
      .slice(0, MAX_RESULT_SNIPPET)
  }));
  if (results.length === 0) throw new Error('Scratch Wiki returned no results.');
  return { query, results, source: 'scratch-wiki' };
};

/**
 * Normalize results from a custom search endpoint into a common shape.
 * Supports several common response shapes (results / data / webPages / organic).
 * @param {object} data Custom endpoint response.
 * @param {number} limit Maximum results.
 * @returns {Array<object>} Search results.
 */
const normalizeCustomResults = (data, limit) => {
  const list =
    (data && Array.isArray(data.results) && data.results) ||
    (data && Array.isArray(data.data) && data.data) ||
    (data && data.webPages && Array.isArray(data.webPages.value) && data.webPages.value) ||
    (data && Array.isArray(data.organic) && data.organic) ||
    null;
  if (!list) throw new Error('Custom endpoint returned an unrecognized response shape.');
  return list
    .slice(0, limit)
    .map((item) => ({
      title: String(item.title || item.name || ''),
      url: String(item.url || item.link || ''),
      snippet: String(item.snippet || item.content || item.description || '').slice(0, MAX_RESULT_SNIPPET)
    }))
    .filter((item) => item.url && item.title);
};

/**
 * Search using a user-configured custom endpoint.
 * @param {string} query Search query.
 * @param {number} limit Maximum results.
 * @param {object} config Agent configuration.
 * @returns {Promise<object>} Search result.
 */
const searchCustom = async (query, limit, config) => {
  const endpoint = config && config.searchEndpoint;
  if (!endpoint) throw new Error('Custom search endpoint is not configured.');
  let url;
  try {
    url = new URL(endpoint);
  } catch (error) {
    throw new Error('Custom search endpoint is invalid.');
  }
  url.searchParams.set('q', query);
  const response = await fetchWithProxy(url.toString(), {
    proxy: config && config.webProxy,
    timeoutMs: SEARCH_TIMEOUT_MS
  });
  const data = await response.json();
  const results = normalizeCustomResults(data, limit);
  if (results.length === 0) throw new Error('Custom endpoint returned no results.');
  return { query, results, source: 'custom' };
};

/**
 * Run one search engine.
 * @param {string} engine Engine id.
 * @param {string} query Search query.
 * @param {number} limit Maximum results.
 * @param {object} config Agent configuration.
 * @returns {Promise<object>} Search result.
 */
const runEngine = (engine, query, limit, config) => {
  switch (engine) {
    case 'duckduckgo':
      return searchViaDuckDuckGo(query, limit, config);
    case 'bing':
      return searchBing(query, limit, config);
    case 'duckduckgo-html':
      return searchDuckDuckGoHtml(query, limit, config);
    case 'scratch-wiki':
      return searchScratchWiki(query, limit);
    case 'custom':
      return searchCustom(query, limit, config);
    default:
      throw new Error(`Unknown search engine: ${engine}`);
  }
};

/**
 * Search the web for current or external information.
 * Engines are tried in order: preferred engine, other general engines, the
 * Scratch Wiki, then the custom endpoint. The first success is returned.
 * @param {object} args Tool arguments.
 * @param {string} args.query Search query.
 * @param {number} [args.limit] Maximum results.
 * @param {object} config Agent configuration.
 * @returns {Promise<object>} Search result.
 */
const searchWeb = async (args, config) => {
  const query = String((args && args.query) || '').trim();
  if (!query) throw new Error('query is required.');
  const limit = Math.max(1, Math.min(20, Number(args.limit) || MAX_SEARCH_RESULTS));

  const preferred = String((config && config.searchEngine) || 'duckduckgo').toLowerCase();
  const ordered = [];
  const pushEngine = (engine) => {
    if (engine === 'custom' && !(config && config.searchEndpoint)) return;
    if (!ordered.includes(engine)) ordered.push(engine);
  };
  pushEngine(preferred);
  for (const engine of GENERAL_ENGINES) pushEngine(engine);
  pushEngine('scratch-wiki');
  pushEngine('custom');

  const errors = [];
  for (const engine of ordered) {
    try {
      return await runEngine(engine, query, limit, config);
    } catch (error) {
      errors.push(`${engine}: ${error && error.message ? error.message : String(error)}`);
    }
  }
  throw new Error(`Web search failed on all engines (${errors.join('; ') || 'no engines available'}).`);
};

/**
 * Create web tool handlers bound to an agent configuration.
 * @param {object} config Agent configuration.
 * @returns {object} Tool handlers.
 */
export const createWebTools = (config) => ({
  search_web: (args) => searchWeb(args || {}, config || {}),
  fetch_url: (args) => fetchUrl(args || {}, config || {})
});
