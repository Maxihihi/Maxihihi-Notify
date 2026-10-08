export async function fetchResponse(url, options = {}) {
  const headers = {
    'user-agent': 'Maxihihi-Notify/2.1 (+self-hosted)',
    accept: '*/*',
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(15000)
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} für ${url}`);
  return response;
}

export async function fetchText(url, options = {}) {
  return (await fetchResponse(url, options)).text();
}

export async function fetchJson(url, options = {}) {
  return (await fetchResponse(url, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers || {}) }
  })).json();
}

export async function fetchAuto(url, options = {}) {
  const response = await fetchResponse(url, options);
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (contentType.includes('application/json') || /^[\s\r\n]*[\[{]/.test(text)) {
    try {
      return { kind: 'json', value: JSON.parse(text), contentType };
    } catch {
      // Fall through to text/XML parsing.
    }
  }
  return { kind: 'text', value: text, contentType };
}

export function xmlTag(xml, tag) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)</${escapedTag}>`, 'i');
  const m = xml.match(re);
  return m ? decodeXml(stripCdata(m[1].trim())) : null;
}

export function xmlAttr(xml, tag, attr) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escapedTag}\\b[^>]*\\b${escapedAttr}=["']([^"']+)["'][^>]*>`, 'i');
  const m = xml.match(re);
  return m ? decodeXml(m[1]) : null;
}

export function allXmlEntries(xml) {
  const blocks = [];
  const re = /<(?:entry|item)\b[^>]*>([\s\S]*?)<\/(?:entry|item)>/gi;
  let m;
  while ((m = re.exec(xml))) blocks.push(m[0]);
  return blocks;
}

export function decodeXml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export function matchesFilters(payload, filters = {}) {
  const haystack = `${payload.title || ''} ${payload.description || ''}`.toLowerCase();
  const include = Array.isArray(filters.include) ? filters.include.filter(Boolean) : [];
  const exclude = Array.isArray(filters.exclude) ? filters.exclude.filter(Boolean) : [];
  if (include.length && !include.some(term => haystack.includes(String(term).toLowerCase()))) return false;
  if (exclude.some(term => haystack.includes(String(term).toLowerCase()))) return false;
  return true;
}

export function normalizeHandle(value = '') {
  return String(value).trim().replace(/^@+/, '');
}

export function normalizeHttpUrl(value = '') {
  const text = String(value).trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function stripCdata(s) {
  return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
}
