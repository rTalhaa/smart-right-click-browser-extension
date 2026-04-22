"use strict";

/*
  background.js (MV3 service worker)
  ----------------------------------
  V2 flow:
  1) User highlights text and chooses "Analyze Selection".
  2) We capture info.selectionText from the context menu event.
  3) We store the payload in chrome.storage.session for lifecycle-safe handoff/debugging.
  4) We inject contentScript.js + overlay.css into the active tab.
  5) The content overlay asks this service worker for Wikipedia/Wikidata/news data.

  Why fetch from the service worker:
  Content scripts live inside the target page. Keeping provider calls here keeps the
  API integration in the extension context and avoids page-origin CORS surprises.
*/

try {
  // Backward compatibility for older local config.js files that used window.CONFIG.
  if (!globalThis.window) {
    globalThis.window = globalThis;
  }

  importScripts("config.js");
} catch (error) {
  console.warn("config.js was not loaded. News scanning will require configured API keys.", error);
}

const MENU_ID = "analyze-selection";
const MENU_TITLE = "Analyze Selection";
const FALLBACK_VALUE = "Not available";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    createContextMenuItems();
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }

  const text = (info.selectionText || "").trim();
  const requestId = createRequestId();
  const payload = {
    id: requestId,
    text,
    action: MENU_ID,
    entityType: detectEntityType(text),
    createdAt: Date.now()
  };

  chrome.storage.session.set({ [requestId]: payload }, () => {
    if (chrome.runtime.lastError) {
      console.error("Unable to save context menu request:", chrome.runtime.lastError);
    }

    showOverlayInTab(tab, payload);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "SMART_RIGHT_CLICK_GET_ENTITY") {
    handleEntityRequest(message.text)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => {
        console.error("Entity request failed:", error);
        sendResponse({ ok: false, error: "Unable to fetch summary right now." });
      });
    return true;
  }

  if (message.type === "SMART_RIGHT_CLICK_SCAN_NEWS") {
    fetchNegativeNews(message.text || "")
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => {
        console.error("Negative news request failed:", error);
        sendResponse({ ok: false, error: getNewsErrorMessage(error) });
      });
    return true;
  }

  return false;
});

function createContextMenuItems() {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: MENU_TITLE,
    contexts: ["selection"]
  });
}

async function showOverlayInTab(tab, payload) {
  if (!tab || !tab.id || !isInjectableTab(tab.url)) {
    chrome.tabs.create({ url: buildResultsUrl(payload.id) });
    return;
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["overlay.css"]
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["contentScript.js"]
    });

    await chrome.tabs.sendMessage(tab.id, {
      type: "SMART_RIGHT_CLICK_SHOW_OVERLAY",
      payload
    });
  } catch (error) {
    console.error("Unable to inject overlay. Falling back to extension results tab.", error);
    chrome.tabs.create({ url: buildResultsUrl(payload.id) });
  }
}

function isInjectableTab(url) {
  return /^https?:\/\//i.test(url || "");
}

function createRequestId() {
  const timestamp = Date.now();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `req_${timestamp}_${suffix}`;
}

function detectEntityType(text) {
  const cleanText = (text || "").replace(/\s+/g, " ").trim();
  const lowerText = cleanText.toLowerCase();

  if (!cleanText) {
    return "Other";
  }

  const placeWords = /\b(city|country|state|province|river|mountain|mount|ocean|sea|lake|bay|valley|island|republic|kingdom|capital)\b/i;
  const knownPlaces = new Set([
    "paris",
    "london",
    "new york",
    "los angeles",
    "tokyo",
    "berlin",
    "rome",
    "delhi",
    "islamabad",
    "pakistan",
    "india",
    "united states",
    "usa",
    "uk",
    "united kingdom",
    "france",
    "germany",
    "italy",
    "china",
    "japan"
  ]);

  if (placeWords.test(cleanText) || knownPlaces.has(lowerText)) {
    return "Place";
  }

  const orgHints = /\b(inc|corp|corporation|company|co|ltd|llc|plc|group|bank|motors|labs|technologies|technology|tech|university)\b/i;

  if (orgHints.test(cleanText)) {
    return "Other";
  }

  const capitalizedWords = cleanText.match(/\b[A-Z][a-z]+(?:['-][A-Z]?[a-z]+)?\b/g) || [];

  if (capitalizedWords.length >= 2) {
    return "Person";
  }

  return "Other";
}

function buildResultsUrl(requestId) {
  return chrome.runtime.getURL(`results.html?id=${encodeURIComponent(requestId)}`);
}

async function handleEntityRequest(text) {
  const cleanText = (text || "").trim();

  if (!cleanText) {
    return {
      summary: {
        title: "No selection",
        summary: "No selected text was captured. Highlight text and try again."
      },
      card: buildBaseEntityCard(cleanText)
    };
  }

  const summary = await fetchWikipediaSummary(cleanText);
  const card = await fetchEntityCardData(cleanText, summary);

  return {
    summary: buildSummaryViewModel(cleanText, summary),
    card
  };
}

async function fetchWikipediaSummary(text) {
  const title = await resolveWikipediaTitle(text);

  if (!title) {
    return null;
  }

  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "extracts|pageprops|pageimages");
  url.searchParams.set("exintro", "1");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("piprop", "thumbnail");
  url.searchParams.set("pithumbsize", "700");
  url.searchParams.set("titles", title);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`Wikipedia extract request failed with status ${response.status}`);
  }

  const data = await response.json();
  const pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
  const page = pages.find((item) => !item.missing);

  if (!page) {
    return null;
  }

  return {
    title: page.title || title,
    summary: page.extract ? trimSummary(page.extract) : "",
    wikibaseItemId: page.pageprops && page.pageprops.wikibase_item ? page.pageprops.wikibase_item : null,
    imageUrl: page.thumbnail && page.thumbnail.source ? page.thumbnail.source : ""
  };
}

async function resolveWikipediaTitle(text) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", text);
  url.searchParams.set("srlimit", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`Wikipedia search request failed with status ${response.status}`);
  }

  const data = await response.json();
  const matches = data.query && Array.isArray(data.query.search) ? data.query.search : [];

  return matches.length > 0 ? matches[0].title : null;
}

function trimSummary(extract) {
  const cleaned = extract.replace(/\s+/g, " ").trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [];
  return sentences.length ? sentences.join(" ").trim() : cleaned;
}

function buildSummaryViewModel(text, summaryResult) {
  if (summaryResult && summaryResult.summary) {
    return {
      title: summaryResult.title,
      summary: summaryResult.summary
    };
  }

  return {
    title: summaryResult && summaryResult.title ? summaryResult.title : text,
    summary: "No Wikipedia summary found for this selection."
  };
}

async function fetchEntityCardData(text, summaryResult) {
  const base = buildBaseEntityCard(text, summaryResult && summaryResult.imageUrl);

  if (!summaryResult || !summaryResult.wikibaseItemId) {
    return base;
  }

  try {
    const wikidata = await fetchWikidataEntity(summaryResult.wikibaseItemId);

    if (!wikidata) {
      return base;
    }

    const fields = [
      { label: "Entity query", value: text, tone: "query" },
      { label: "Born", value: extractBorn(wikidata) || FALLBACK_VALUE },
      { label: "Nationality", value: (await extractLabelField(wikidata, "P27")) || FALLBACK_VALUE },
      { label: "Occupation", value: (await extractLabelField(wikidata, "P106")) || FALLBACK_VALUE },
      { label: "Children", value: extractChildren(wikidata) || FALLBACK_VALUE, tone: "numeric" }
    ];

    const optionalFields = [
      { label: "Also known as", value: extractAliases(wikidata) },
      { label: "Residence", value: await extractLabelField(wikidata, "P551") },
      { label: "Education", value: await extractLabelField(wikidata, "P69") },
      { label: "Awards", value: await extractLabelField(wikidata, "P166") },
      { label: "Official website", value: extractUrlValue(wikidata, "P856") }
    ];

    optionalFields.forEach((field) => {
      if (field.value) {
        fields.push(field);
      }
    });

    return {
      imageUrl: summaryResult.imageUrl || "",
      fields
    };
  } catch (error) {
    console.error("Entity card fetch failed:", error);
    return base;
  }
}

function buildBaseEntityCard(text, imageUrl = "") {
  return {
    imageUrl,
    fields: [
      { label: "Entity query", value: text || FALLBACK_VALUE, tone: "query" },
      { label: "Born", value: FALLBACK_VALUE },
      { label: "Nationality", value: FALLBACK_VALUE },
      { label: "Occupation", value: FALLBACK_VALUE },
      { label: "Children", value: FALLBACK_VALUE }
    ]
  };
}

async function fetchWikidataEntity(entityId) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(entityId)}.json`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Wikidata entity request failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.entities && data.entities[entityId] ? data.entities[entityId] : null;
}

async function extractLabelField(entity, propertyId) {
  const ids = getClaims(entity, propertyId)
    .map(extractWikibaseIdFromClaim)
    .filter(Boolean);

  if (!ids.length) {
    return "";
  }

  const labelsMap = await fetchWikidataLabels(ids);
  const values = ids.map((id) => labelsMap[id] || id).filter(Boolean);

  return values.length ? values.slice(0, 3).join(", ") : "";
}

async function fetchWikidataLabels(ids) {
  const uniqueIds = Array.from(new Set(ids));

  if (!uniqueIds.length) {
    return {};
  }

  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("ids", uniqueIds.join("|"));
  url.searchParams.set("props", "labels");
  url.searchParams.set("languages", "en");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`Wikidata labels request failed with status ${response.status}`);
  }

  const data = await response.json();
  const entities = data.entities || {};
  const labels = {};

  uniqueIds.forEach((id) => {
    const item = entities[id];
    labels[id] = item && item.labels && item.labels.en ? item.labels.en.value : id;
  });

  return labels;
}

function extractBorn(entity) {
  const claim = getClaims(entity, "P569")[0];

  if (!claim || !claim.mainsnak || !claim.mainsnak.datavalue) {
    return "";
  }

  const value = claim.mainsnak.datavalue.value;
  const time = value && typeof value.time === "string" ? value.time : "";
  return formatWikiDate(time);
}

function extractChildren(entity) {
  const countClaim = getClaims(entity, "P1971")[0];

  if (countClaim && countClaim.mainsnak && countClaim.mainsnak.datavalue) {
    const amount = countClaim.mainsnak.datavalue.value && countClaim.mainsnak.datavalue.value.amount;

    if (amount) {
      return amount.replace("+", "");
    }
  }

  const childClaims = getClaims(entity, "P40");
  return childClaims.length ? String(childClaims.length) : "";
}

function extractAliases(entity) {
  const aliases = entity && entity.aliases && entity.aliases.en ? entity.aliases.en : [];

  return aliases
    .slice(0, 3)
    .map((item) => item.value)
    .filter(Boolean)
    .join(", ");
}

function extractUrlValue(entity, propertyId) {
  const claim = getClaims(entity, propertyId)[0];

  if (!claim || !claim.mainsnak || !claim.mainsnak.datavalue) {
    return "";
  }

  const value = claim.mainsnak.datavalue.value;
  return typeof value === "string" ? value : "";
}

function getClaims(entity, propertyId) {
  return entity && entity.claims && Array.isArray(entity.claims[propertyId]) ? entity.claims[propertyId] : [];
}

function extractWikibaseIdFromClaim(claim) {
  if (!claim || !claim.mainsnak || !claim.mainsnak.datavalue) {
    return "";
  }

  const value = claim.mainsnak.datavalue.value;
  return value && value.id ? value.id : "";
}

function formatWikiDate(time) {
  if (!time || typeof time !== "string") {
    return "";
  }

  const normalized = time.replace(/^\+/, "").replace("T00:00:00Z", "");
  const [year, month, day] = normalized.split("-");

  if (!year) {
    return "";
  }

  if (month === "00" || day === "00") {
    return year;
  }

  const date = new Date(`${year}-${month}-${day}`);

  if (Number.isNaN(date.getTime())) {
    return year;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

async function fetchNegativeNews(text) {
  const providers = getConfiguredNewsProviders();

  if (!providers.length) {
    const error = new Error("No GNews or NewsAPI key is configured in config.js.");
    error.code = "NO_NEWS_API_KEY";
    throw error;
  }

  const providerResults = await Promise.all(
    providers.map(async (provider) => {
      try {
        const articles = await provider.fetch(text);
        return { name: provider.name, articles, error: null };
      } catch (error) {
        console.warn(`${provider.name} failed during aggregate fetch.`, error);
        return { name: provider.name, articles: [], error };
      }
    })
  );

  const providerErrors = providerResults
    .filter((item) => item.error)
    .map((item) => ({ name: item.name, message: item.error && item.error.message ? item.error.message : "Request failed" }));

  const providersUsed = providerResults
    .filter((item) => item.articles.length > 0)
    .map((item) => item.name);

  if (!providersUsed.length && providerErrors.length === providers.length) {
    const aggregateError = new Error(providerErrors.map((item) => `${item.name}: ${item.message}`).join(" | "));
    aggregateError.code = "ALL_NEWS_PROVIDERS_FAILED";
    throw aggregateError;
  }

  return {
    articles: mergeArticlesWithProviderAttribution(providerResults).slice(0, 8),
    providersUsed,
    providerErrors
  };
}

async function fetchFromGNews(text) {
  const url = new URL("https://gnews.io/api/v4/search");
  url.searchParams.set("q", buildNegativeNewsQuery(text));
  url.searchParams.set("lang", "en");
  url.searchParams.set("max", "5");
  url.searchParams.set("apikey", getConfigValue("GNEWS_API_KEY"));

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`GNews request failed with status ${response.status}`);
  }

  const data = await response.json();
  const articles = Array.isArray(data.articles) ? data.articles : [];

  return articles
    .map((article) => ({
      title: article.title,
      url: article.url,
      source: article.source && article.source.name,
      publishedAt: article.publishedAt
    }))
    .filter(isValidArticle)
    .slice(0, 5);
}

async function fetchFromNewsApi(text) {
  const url = new URL("https://newsapi.org/v2/everything");
  url.searchParams.set("q", buildNegativeNewsQuery(text));
  url.searchParams.set("language", "en");
  url.searchParams.set("pageSize", "5");
  url.searchParams.set("sortBy", "relevancy");
  url.searchParams.set("apiKey", getConfigValue("NEWS_API_KEY"));

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`NewsAPI request failed with status ${response.status}`);
  }

  const data = await response.json();

  if (data.status === "error") {
    throw new Error(data.message || "NewsAPI returned an error.");
  }

  const articles = Array.isArray(data.articles) ? data.articles : [];

  return articles
    .map((article) => ({
      title: article.title,
      url: article.url,
      source: article.source && article.source.name,
      publishedAt: article.publishedAt
    }))
    .filter(isValidArticle)
    .slice(0, 5);
}

function getConfiguredNewsProviders() {
  const providers = [];

  if (isConfiguredApiKey(getConfigValue("GNEWS_API_KEY"))) {
    providers.push({ name: "GNews", fetch: fetchFromGNews });
  }

  if (isConfiguredApiKey(getConfigValue("NEWS_API_KEY"))) {
    providers.push({ name: "NewsAPI", fetch: fetchFromNewsApi });
  }

  return providers;
}

function getConfigValue(key) {
  return globalThis.CONFIG && typeof globalThis.CONFIG[key] === "string" ? globalThis.CONFIG[key].trim() : "";
}

function isConfiguredApiKey(value) {
  return Boolean(value && !value.startsWith("YOUR_") && value !== "PASTE_KEY_HERE");
}

function buildNegativeNewsQuery(text) {
  const cleanText = String(text || "").replace(/["\r\n]/g, " ").replace(/\s+/g, " ").trim();
  return `"${cleanText}" AND (controversy OR scandal OR lawsuit)`;
}

function isValidArticle(article) {
  return Boolean(article.title && article.url);
}

function mergeArticlesWithProviderAttribution(providerResults) {
  const merged = [];
  const indexByKey = new Map();

  providerResults.forEach((result) => {
    result.articles.forEach((article) => {
      const key = normalizeArticleKey(article);
      const existingIndex = indexByKey.get(key);

      if (existingIndex === undefined) {
        indexByKey.set(key, merged.length);
        merged.push({
          ...article,
          providers: [result.name],
          provider: result.name
        });
        return;
      }

      const existing = merged[existingIndex];
      if (!existing.providers.includes(result.name)) {
        existing.providers.push(result.name);
      }
    });
  });

  return merged;
}

function normalizeArticleKey(article) {
  const urlKey = (article.url || "").trim().toLowerCase();
  if (urlKey) {
    return `url:${urlKey}`;
  }

  return `title:${(article.title || "").trim().toLowerCase()}`;
}

function getNewsErrorMessage(error) {
  if (error && error.code === "NO_NEWS_API_KEY") {
    return "Unable to fetch news right now. Add a GNews or NewsAPI key in config.js.";
  }

  return "Unable to fetch news right now.";
}
