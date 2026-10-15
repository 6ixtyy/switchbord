// A market is a group of endpoints that sell the same thing, so one can stand in for another.
// Rules run over "path + service + description + tags"; first match wins. Anything unmatched stays
// in the inventory with market = null and is still returned for a matching task.

export interface Market { id: string; title: string; test: RegExp }

export const MARKETS: Market[] = [
  { id: "llm", title: "LLM chat / completions", test: /chat\/completions|\/v1\/messages\b|\b(llm|large language model|chat completion|openai[- ]compatible)\b/ },
  { id: "embeddings", title: "Text embeddings", test: /\bembeddings?\b/ },
  { id: "image-gen", title: "Image / video generation", test: /\b(text[- ]to[- ](image|video)|image generation|generate (an )?(image|video)s?|dall-?e|stable diffusion|flux|midjourney|video generation)\b/ },
  { id: "speech", title: "Speech (TTS / transcription)", test: /\b(text[- ]to[- ]speech|tts|speech[- ]to[- ]text|transcri(be|ption)|whisper|voice synthesis)\b/ },
  { id: "ocr", title: "OCR / document parsing", test: /\b(ocr|pdf (to|extract|pars)\w*|document pars\w*|extract text from (an )?(image|pdf))\b/ },
  { id: "translation", title: "Translation", test: /\btranslat(e|ion)\b/ },
  { id: "news-search", title: "News search", test: /\b(news (search|api|articles|headlines)|search (the )?news|latest news|headlines)\b|\/news(\/search)?\b/ },
  { id: "web-search", title: "Web search", test: /\b(web[- ]?search|search the web|internet search|serp|search engine|google search|bing search|brave search)\b|\/(exa|tavily|brave|linkup|you|serper|perplexity)\/search\b|\/(web-?)?search\/?$/ },
  { id: "web-scrape", title: "Web page fetch / scrape", test: /\b(scrap(e|er|ing)|crawl(er|ing)?|screenshot|fetch (a |any )?(url|web ?page|page)|extract (content|text|data) from (a |any )?(url|web ?page|website)|url to markdown|web ?page content|page contents?)\b|\/(scrape|crawl|contents|extract|screenshot)\b/ },
  { id: "prediction-markets", title: "Prediction markets", test: /\b(polymarket|kalshi|prediction markets?)\b/ },
  { id: "crypto-price", title: "Crypto prices", test: /\b(crypto|token|coin|btc|bitcoin|eth|ether|sol)\b[^.]{0,40}\bprices?\b|\bprices?\b[^.]{0,40}\b(crypto|tokens?|coins?|btc|eth|sol)\b|\bohlcv?\b/ },
  { id: "onchain-data", title: "On-chain / wallet / token data", test: /\b(on-?chain|wallet (balance|analysis|activity|portfolio|profil\w*)|token (holders?|risk|security|audit|analysis|info)|smart contract|transaction history|dex (pairs?|trades?|data)|liquidity pools?|rug ?pull|honeypot)\b/ },
  { id: "rpc", title: "Blockchain RPC / gas", test: /\b(json-?rpc|rpc (endpoint|node|call)|gas (price|estimate|oracle))\b/ },
  { id: "stock-data", title: "Stocks / FX / macro data", test: /\b(stocks?|equit(y|ies)|ticker symbol|sec filings?|earnings|forex|fx rates?|exchange rates?|commodit(y|ies)|macro ?economic|treasury yields?)\b/ },
  { id: "weather", title: "Weather", test: /\b(weather|forecast|air quality|temperature)\b/ },
  { id: "geo", title: "Geocoding / places / IP location", test: /\b(geocod\w*|reverse geocod\w*|ip (geo\w*|lookup|location|intel\w*)|places? search|points? of interest|timezone|routing directions)\b/ },
  { id: "enrichment", title: "Company / people enrichment", test: /\b(enrich\w*|company (data|info|lookup|profile|search)|people (search|lookup|data)|person (lookup|search)|email (finder|lookup|verif\w*)|linkedin|contact (info|data)|lead (gen\w*|search))\b/ },
  { id: "social-data", title: "Social media data", test: /\b(twitter|tweets?|x\.com|reddit|tiktok|instagram|youtube|farcaster|bluesky|social media)\b/ },
  { id: "domain-dns", title: "Domain / DNS / WHOIS", test: /\b(dns|whois|domain (lookup|availability|info|search)|ssl cert\w*)\b/ },
];

export const MARKET_IDS = new Set(MARKETS.map((m) => m.id));

export function classify(text: string): string | null {
  const t = text.toLowerCase();
  for (const m of MARKETS) if (m.test.test(t)) return m.id;
  return null;
}

export function endpointText(e: { url: string; service: string; description: string; tags: string[] }): string {
  let path = e.url;
  try { const u = new URL(e.url); path = u.hostname + u.pathname; } catch {}
  return `${path} ${e.service} ${e.description} ${e.tags.join(" ")}`;
}
