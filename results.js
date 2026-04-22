"use strict";

/*
  results.js
  ----------
  One-page controller for the premium results interface.

  Flow:
  1) Read request id from URL.
  2) Load payload from chrome.storage.session.
  3) Render metadata + description + data card.
  4) Fetch negative news only when user clicks "Scan Negative News".
*/

const ACTION_LABELS = {
  "analyze-selection": "Analyze Selection"
};

const UI_MESSAGES = {
  noRequestId: "Missing request ID. Try the right-click flow again.",
  noPayload: "No request data found. Please re-run Analyze Selection.",
  noSelectedText: "No selected text was captured. Highlight text and try again.",
  noNews: "No negative-news style matches were found for this selection.",
  newsError: "Unable to fetch news right now.",
  noSummary: "No Wikipedia summary found for this selection.",
  summaryError: "Unable to fetch summary right now."
};

const FALLBACK_VALUE = "Not available";
const elements = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  initMotion();
  initCardImageHandlers();

  const params = new URLSearchParams(window.location.search);
  const requestId = params.get("id");
  const previewMode = params.get("preview") === "1" || !(window.chrome && chrome.storage && chrome.storage.session);

  if (previewMode) {
    const previewPayload = {
      id: "preview",
      text: params.get("q") || "Cristiano Ronaldo",
      entityType: params.get("type") || "Person",
      action: "analyze-selection"
    };
    renderMetadata(previewPayload);
    wireScanButton(previewPayload.text);
    await runResultsFlow(previewPayload.text);
    return;
  }

  if (!requestId) {
    showError(UI_MESSAGES.noRequestId);
    disableScanButton();
    return;
  }

  let payload;

  try {
    payload = await getSessionPayload(requestId);
  } catch (error) {
    console.error("Unable to read request payload:", error);
    showError(UI_MESSAGES.noPayload);
    disableScanButton();
    return;
  }

  if (!payload) {
    showError(UI_MESSAGES.noPayload);
    disableScanButton();
    return;
  }

  renderMetadata(payload);

  const text = (payload.text || "").trim();

  if (!text) {
    showError(UI_MESSAGES.noSelectedText);
    disableScanButton();
    return;
  }

  wireScanButton(text);
  await runResultsFlow(text);
}

function initCardImageHandlers() {
  if (!elements.cardImage || !elements.cardImageFallback) {
    return;
  }

  elements.cardImage.addEventListener("error", () => {
    elements.cardImage.hidden = true;
    elements.cardImageFallback.hidden = false;
  });
}

async function runResultsFlow(text) {
  showLoading("Gathering summary and entity details...");

  let summaryResult = null;
  let summaryError = false;

  try {
    summaryResult = await fetchWikipediaSummary(text);
  } catch (error) {
    summaryError = true;
    console.error("Wikipedia summary request failed:", error);
  }

  const entityCard = await fetchEntityCardData(text, summaryResult);
  const summaryView = buildSummaryViewModel(text, summaryResult, summaryError);

  renderSummary(summaryView, text);
  renderEntityCard(entityCard, text);
  setNewsIdleState();
  setState("success");
}

function wireScanButton(text) {
  if (!elements.scanNewsButton) {
    return;
  }

  elements.scanNewsButton.addEventListener("click", async () => {
    openNewsDrawer();
    await loadNewsIntoPanel(text);
  });

  if (elements.newsDrawerClose) {
    elements.newsDrawerClose.addEventListener("click", closeNewsDrawer);
  }

  if (elements.newsDrawerBackdrop) {
    elements.newsDrawerBackdrop.addEventListener("click", closeNewsDrawer);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeNewsDrawer();
    }
  });
}

function disableScanButton() {
  if (elements.scanNewsButton) {
    elements.scanNewsButton.disabled = true;
  }
}

function renderMetadata(payload) {
  const text = payload.text || "-";
  elements.selectedText.textContent = payload.text || "-";
  elements.entityType.textContent = payload.entityType || "Other";
  elements.chosenAction.textContent = ACTION_LABELS[payload.action] || payload.action || "-";
  elements.heroQuery.textContent = text;
  applyQueryTheme(text, payload.entityType || "Other");
}

function renderSummary(summaryView, selectedText) {
  elements.descriptionTitle.textContent = summaryView.title || selectedText;
  elements.descriptionText.textContent = summaryView.summary;
}

function renderEntityCard(entityCard, text) {
  renderCardImage(entityCard.imageUrl);
  renderDataTable(entityCard.fields, text);
}

function setNewsIdleState() {
  elements.newsStatus.textContent = "Click Scan Negative News to fetch related articles.";
  if (elements.drawerNewsStatus) {
    elements.drawerNewsStatus.textContent = "Click Scan Negative News to start scan.";
  }
  if (elements.drawerNewsContent) {
    elements.drawerNewsContent.replaceChildren();
  }
  elements.resultCount.hidden = true;
  elements.scanNewsButton.disabled = false;
}

async function loadNewsIntoPanel(text) {
  elements.scanNewsButton.disabled = true;
  elements.newsStatus.textContent = "Scanning recent negative-news style signals...";
  if (elements.drawerNewsStatus) {
    elements.drawerNewsStatus.textContent = "Scanning recent negative-news style signals...";
  }
  if (elements.drawerNewsContent) {
    elements.drawerNewsContent.replaceChildren();
  }
  elements.resultCount.hidden = true;

  try {
    const newsResult = await fetchNegativeNews(text);
    const articles = newsResult.articles;
    const providersUsed = newsResult.providersUsed;
    const providerErrors = newsResult.providerErrors;

    if (!articles.length) {
      elements.newsStatus.textContent = UI_MESSAGES.noNews;
      if (elements.drawerNewsStatus) {
        elements.drawerNewsStatus.textContent = UI_MESSAGES.noNews;
      }
      return;
    }

    const providerLabel = buildProviderStatusLabel(providersUsed, providerErrors);
    elements.newsStatus.textContent = providerLabel;
    if (elements.drawerNewsStatus) {
      elements.drawerNewsStatus.textContent = providerLabel;
    }
    elements.resultCount.hidden = false;
    elements.resultCount.textContent = `${articles.length} result${articles.length === 1 ? "" : "s"}`;
    elements.resultCount.classList.toggle("result-count--hot", articles.length >= 3);
    elements.resultCount.classList.toggle("result-count--cool", articles.length < 3);
    renderNewsResults(articles);
  } catch (error) {
    console.error("Negative news request failed:", error);
    elements.newsStatus.textContent = getNewsErrorMessage(error);
    if (elements.drawerNewsStatus) {
      elements.drawerNewsStatus.textContent = getNewsErrorMessage(error);
    }
  } finally {
    elements.scanNewsButton.disabled = false;
  }
}

/*
  News fetch:
  - Query every configured provider (GNews + NewsAPI when keys exist).
  - Merge and dedupe returned articles.
  - Keep provider attribution for each item.
*/
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

  const mergedArticles = mergeArticlesWithProviderAttribution(providerResults);

  return {
    articles: mergedArticles.slice(0, 8),
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

/*
  Summary + card data fetch:
  - Wikipedia for intro extract + linked Wikidata item.
  - Wikidata for structured fields in data card.
*/
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

async function fetchEntityCardData(text, summaryResult) {
  const base = {
    imageUrl: summaryResult && summaryResult.imageUrl ? summaryResult.imageUrl : "",
    fields: [
      { label: "Entity query", value: text, tone: "query" },
      { label: "Born", value: FALLBACK_VALUE },
      { label: "Nationality", value: FALLBACK_VALUE },
      { label: "Occupation", value: FALLBACK_VALUE },
      { label: "Children", value: FALLBACK_VALUE }
    ]
  };

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
  const values = ids
    .map((id) => labelsMap[id] || id)
    .filter(Boolean);

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

  for (const id of uniqueIds) {
    const item = entities[id];
    const label = item && item.labels && item.labels.en ? item.labels.en.value : "";
    labels[id] = label || id;
  }

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

  if (!aliases.length) {
    return "";
  }

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

  const iso = `${year}-${month}-${day}`;
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return year;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

function buildSummaryViewModel(text, summaryResult, summaryError) {
  if (summaryResult && summaryResult.summary) {
    return {
      title: summaryResult.title,
      summary: summaryResult.summary
    };
  }

  if (summaryError) {
    return {
      title: summaryResult && summaryResult.title ? summaryResult.title : text,
      summary: UI_MESSAGES.summaryError
    };
  }

  return {
    title: summaryResult && summaryResult.title ? summaryResult.title : text,
    summary: UI_MESSAGES.noSummary
  };
}

function renderCardImage(imageUrl) {
  if (!elements.cardImage || !elements.cardImageFallback) {
    return;
  }

  if (!imageUrl) {
    elements.cardImage.hidden = true;
    elements.cardImageFallback.hidden = false;
    return;
  }

  elements.cardImage.src = imageUrl;
  elements.cardImage.hidden = false;
  elements.cardImageFallback.hidden = true;
}

function renderDataTable(fields, text) {
  if (!elements.dataTableBody) {
    return;
  }

  const data = Array.isArray(fields) && fields.length
    ? fields
    : [{ label: "Entity query", value: text || FALLBACK_VALUE, tone: "query" }];

  const fragment = document.createDocumentFragment();

  data.forEach((field) => {
    const row = document.createElement("tr");

    const labelCell = document.createElement("td");
    labelCell.className = "data-table__label";
    labelCell.textContent = field.label || "Field";

    const valueCell = document.createElement("td");
    valueCell.className = "data-table__value";
    valueCell.textContent = field.value || FALLBACK_VALUE;
    applyValueTone(valueCell, field.label || "", field.value || "", field.tone || "");

    row.append(labelCell, valueCell);
    fragment.append(row);
  });

  elements.dataTableBody.replaceChildren(fragment);
}

function applyValueTone(node, label, value, tone) {
  const normalized = String(value || "").trim();
  const labelLower = label.toLowerCase();

  if (tone === "query") {
    node.classList.add("tone-query");
    return;
  }

  if (!normalized || normalized === FALLBACK_VALUE) {
    node.classList.add("tone-muted");
    return;
  }

  if (tone === "numeric" || /children|count|total|age/i.test(labelLower)) {
    const numeric = parseInt(normalized.replace(/[^\d-]/g, ""), 10);

    if (!Number.isNaN(numeric)) {
      if (numeric === 0) {
        node.classList.add("tone-cool");
      } else if (numeric <= 2) {
        node.classList.add("tone-mid");
      } else {
        node.classList.add("tone-hot");
      }
      return;
    }
  }

  if (/website|http/i.test(labelLower) || /^https?:\/\//i.test(normalized)) {
    node.classList.add("tone-link");
    return;
  }

  node.classList.add("tone-default");
}

function applyQueryTheme(text, entityType) {
  const query = String(text || "");
  const hue = pickHueFromText(query);
  document.documentElement.style.setProperty("--query-hue", String(hue));

  const type = String(entityType || "").toLowerCase();
  if (!elements.entityType) {
    return;
  }

  elements.entityType.classList.remove("pill-person", "pill-place", "pill-other");

  if (type === "person") {
    elements.entityType.classList.add("pill-person");
  } else if (type === "place") {
    elements.entityType.classList.add("pill-place");
  } else {
    elements.entityType.classList.add("pill-other");
  }
}

function pickHueFromText(text) {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }

  const hue = Math.abs(hash) % 360;
  return hue;
}

function renderNewsResults(articles) {
  const list = document.createElement("div");
  list.className = "article-list";

  articles.forEach((article) => {
    const item = document.createElement("article");
    item.className = "article-item";

    const title = document.createElement("a");
    title.className = "article-title";
    title.href = article.url;
    title.target = "_blank";
    title.rel = "noreferrer";
    title.textContent = article.title;

    const meta = document.createElement("p");
    meta.className = "article-meta";
    const providerLabel = Array.isArray(article.providers) && article.providers.length
      ? `${article.providers.join(" + ")} API`
      : `${article.provider || "Unknown"} API`;
    meta.textContent = [providerLabel, article.source || "Unknown source", formatDate(article.publishedAt)]
      .filter(Boolean)
      .join(" - ");

    item.append(title, meta);
    list.append(item);
  });

  if (elements.drawerNewsContent) {
    elements.drawerNewsContent.replaceChildren(list);
  }
}

function mergeArticlesWithProviderAttribution(providerResults) {
  const merged = [];
  const indexByKey = new Map();

  providerResults.forEach((result) => {
    result.articles.forEach((article) => {
      const key = normalizeArticleKey(article);
      const existingIndex = indexByKey.get(key);

      if (existingIndex === undefined) {
        const enriched = {
          ...article,
          providers: [result.name],
          provider: result.name
        };
        indexByKey.set(key, merged.length);
        merged.push(enriched);
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

  const titleKey = (article.title || "").trim().toLowerCase();
  return `title:${titleKey}`;
}

function buildProviderStatusLabel(providersUsed, providerErrors) {
  const usedLabel = providersUsed.length
    ? `Fetched via ${providersUsed.join(" + ")} API${providersUsed.length > 1 ? "s" : ""}.`
    : "";

  if (!providerErrors.length) {
    return usedLabel;
  }

  const failedProviders = providerErrors.map((item) => item.name).join(", ");

  if (usedLabel) {
    return `${usedLabel} ${failedProviders} currently unavailable.`;
  }

  return `${failedProviders} currently unavailable.`;
}

function openNewsDrawer() {
  if (!elements.newsDrawer || !elements.newsDrawerBackdrop) {
    return;
  }

  elements.newsDrawerBackdrop.hidden = false;
  elements.newsDrawer.classList.add("is-open");
  elements.newsDrawer.setAttribute("aria-hidden", "false");
}

function closeNewsDrawer() {
  if (!elements.newsDrawer || !elements.newsDrawerBackdrop) {
    return;
  }

  elements.newsDrawer.classList.remove("is-open");
  elements.newsDrawer.setAttribute("aria-hidden", "true");

  setTimeout(() => {
    if (!elements.newsDrawer.classList.contains("is-open")) {
      elements.newsDrawerBackdrop.hidden = true;
    }
  }, 240);
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
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
  return window.CONFIG && typeof window.CONFIG[key] === "string" ? window.CONFIG[key].trim() : "";
}

function isConfiguredApiKey(value) {
  return Boolean(value && !value.startsWith("YOUR_") && value !== "PASTE_KEY_HERE");
}

function buildNegativeNewsQuery(text) {
  const cleanText = text.replace(/["\r\n]/g, " ").replace(/\s+/g, " ").trim();
  return `"${cleanText}" AND (controversy OR scandal OR lawsuit)`;
}

function isValidArticle(article) {
  return Boolean(article.title && article.url);
}

function getNewsErrorMessage(error) {
  if (error && error.code === "NO_NEWS_API_KEY") {
    return `${UI_MESSAGES.newsError} Add a GNews or NewsAPI key in config.js.`;
  }

  return UI_MESSAGES.newsError;
}

function showLoading(message) {
  elements.loadingMessage.textContent = message;
  setState("loading");
}

function showEmpty(message) {
  elements.emptyMessage.textContent = message;
  setState("empty");
}

function showError(message) {
  elements.errorMessage.textContent = message;
  setState("error");
}

function setState(state) {
  elements.loadingState.hidden = state !== "loading";
  elements.emptyState.hidden = state !== "empty";
  elements.errorState.hidden = state !== "error";
}

function getSessionPayload(requestId) {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(requestId, (items) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }

      resolve(items[requestId]);
    });
  });
}

/*
  Motion layer:
  - Staggered reveal on load/scroll
  - Subtle cursor-reactive tilt for premium depth
  - Honors reduced-motion preference
*/
function initMotion() {
  initRevealObserver();
  initTiltCards();
}

function initRevealObserver() {
  const revealNodes = Array.from(document.querySelectorAll(".reveal"));

  if (!revealNodes.length) {
    return;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reducedMotion || !("IntersectionObserver" in window)) {
    revealNodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
  );

  revealNodes.forEach((node) => observer.observe(node));

  // Fallback for environments where observer callbacks are delayed.
  setTimeout(() => {
    revealNodes.forEach((node) => {
      if (!node.classList.contains("is-visible")) {
        node.classList.add("is-visible");
      }
    });
  }, 1200);
}

function initTiltCards() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touchOnly = window.matchMedia("(hover: none)").matches;

  if (reducedMotion || touchOnly) {
    return;
  }

  const cards = Array.from(document.querySelectorAll(".tilt-card"));

  cards.forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;

      const rotateY = (x - 0.5) * 5;
      const rotateX = (0.5 - y) * 4;

      card.style.setProperty("--rx", `${rotateX.toFixed(2)}deg`);
      card.style.setProperty("--ry", `${rotateY.toFixed(2)}deg`);
    });

    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    });
  });
}

function cacheElements() {
  elements.selectedText = document.getElementById("selected-text");
  elements.entityType = document.getElementById("entity-type");
  elements.chosenAction = document.getElementById("chosen-action");
  elements.heroQuery = document.getElementById("hero-query");

  elements.loadingState = document.getElementById("loading-state");
  elements.loadingMessage = document.getElementById("loading-message");
  elements.emptyState = document.getElementById("empty-state");
  elements.emptyMessage = document.getElementById("empty-message");
  elements.errorState = document.getElementById("error-state");
  elements.errorMessage = document.getElementById("error-message");

  elements.cardImage = document.getElementById("card-image");
  elements.cardImageFallback = document.getElementById("card-image-fallback");
  elements.dataTableBody = document.getElementById("data-table-body");

  elements.descriptionTitle = document.getElementById("description-title");
  elements.descriptionText = document.getElementById("description-text");

  elements.scanNewsButton = document.getElementById("scan-news-button");
  elements.newsStatus = document.getElementById("news-status");
  elements.resultCount = document.getElementById("result-count");
  elements.newsDrawer = document.getElementById("news-drawer");
  elements.newsDrawerBackdrop = document.getElementById("news-drawer-backdrop");
  elements.newsDrawerClose = document.getElementById("news-drawer-close");
  elements.drawerNewsStatus = document.getElementById("drawer-news-status");
  elements.drawerNewsContent = document.getElementById("drawer-news-content");
}
