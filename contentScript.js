"use strict";

/*
  contentScript.js
  ----------------
  Injected on demand after the user clicks "Analyze Selection".

  This script only owns the same-page overlay UI. It does not call external APIs
  directly; instead it asks background.js for summary/card/news data through
  chrome.runtime messaging.
*/

(() => {
  if (window.__smartRightClickOverlayReady) {
    return;
  }

  window.__smartRightClickOverlayReady = true;

  const ROOT_ID = "smart-right-click-overlay-root";
  const elements = {};
  let currentPayload = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "SMART_RIGHT_CLICK_SHOW_OVERLAY") {
      return;
    }

    currentPayload = message.payload;
    renderOverlay(currentPayload);
  });

  function renderOverlay(payload) {
    removeExistingOverlay();

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = buildOverlayMarkup(payload);
    document.documentElement.append(root);

    cacheElements(root);
    wireEvents(root);
    applyQueryTheme(payload.text, payload.entityType);

    requestAnimationFrame(() => {
      root.classList.add("srcbe-is-visible");
    });

    loadEntityDetails(payload.text);
  }

  function buildOverlayMarkup(payload) {
    const text = escapeHtml(payload.text || "-");
    const entityType = escapeHtml(payload.entityType || "Other");

    return `
      <div class="srcbe-backdrop" data-close-overlay></div>
      <section class="srcbe-shell" role="dialog" aria-modal="true" aria-label="Smart Right-Click analysis overlay">
        <div class="srcbe-ambient" aria-hidden="true">
          <span class="srcbe-orb srcbe-orb-a"></span>
          <span class="srcbe-orb srcbe-orb-b"></span>
          <span class="srcbe-grid"></span>
        </div>

        <header class="srcbe-header">
          <div>
            <p class="srcbe-kicker">Selection intelligence</p>
            <h1 id="srcbe-query">${text}</h1>
          </div>
          <button class="srcbe-icon-button" type="button" aria-label="Close overlay" data-close-overlay>&times;</button>
        </header>

        <div class="srcbe-meta">
          <div>
            <span>Selected</span>
            <strong>${text}</strong>
          </div>
          <div>
            <span>Entity</span>
            <strong id="srcbe-entity-type">${entityType}</strong>
          </div>
          <div>
            <span>Mode</span>
            <strong>Overlay V2</strong>
          </div>
        </div>

        <div class="srcbe-status" id="srcbe-status" aria-live="polite">
          <span></span>
          <p>Gathering summary and entity details...</p>
        </div>

        <div class="srcbe-layout">
          <aside class="srcbe-left">
            <article class="srcbe-card srcbe-card-data">
              <div class="srcbe-card-head">
                <h2>Data Card</h2>
                <span class="srcbe-chip">Wikipedia + Wikidata</span>
              </div>
              <div class="srcbe-image-frame">
                <img id="srcbe-card-image" alt="Selected entity image" hidden>
                <div id="srcbe-image-fallback">No Image</div>
              </div>
              <div class="srcbe-table-wrap">
                <table class="srcbe-table">
                  <thead>
                    <tr>
                      <th scope="col">Field</th>
                      <th scope="col">Value</th>
                    </tr>
                  </thead>
                  <tbody id="srcbe-data-body">
                    <tr>
                      <td>Entity query</td>
                      <td>${text}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article class="srcbe-card srcbe-news-card">
              <div class="srcbe-card-head">
                <h2>Negative News</h2>
                <span id="srcbe-result-count" class="srcbe-result-count" hidden></span>
              </div>
              <p id="srcbe-news-status">Scan runs only when triggered.</p>
              <button id="srcbe-scan-button" class="srcbe-scan-button" type="button">
                <span>Scan Negative News</span>
                <i aria-hidden="true"></i>
              </button>
            </article>
          </aside>

          <main class="srcbe-main srcbe-card">
            <p class="srcbe-kicker">Description</p>
            <h2 id="srcbe-description-title">Loading description...</h2>
            <div id="srcbe-description-text" class="srcbe-description">Please wait while we resolve the best matching source.</div>
          </main>
        </div>

        <aside id="srcbe-news-drawer" class="srcbe-news-drawer" aria-hidden="true" aria-label="Negative news results">
          <div class="srcbe-drawer-head">
            <div>
              <p class="srcbe-kicker">Scan Results</p>
              <h2>Negative News Scanner</h2>
            </div>
            <button class="srcbe-icon-button" id="srcbe-close-drawer" type="button" aria-label="Close news drawer">&times;</button>
          </div>
          <p id="srcbe-drawer-status" class="srcbe-drawer-status">Ready to scan.</p>
          <div id="srcbe-news-list" class="srcbe-news-list"></div>
        </aside>
      </section>
    `;
  }

  function cacheElements(root) {
    elements.root = root;
    elements.status = root.querySelector("#srcbe-status");
    elements.entityType = root.querySelector("#srcbe-entity-type");
    elements.cardImage = root.querySelector("#srcbe-card-image");
    elements.imageFallback = root.querySelector("#srcbe-image-fallback");
    elements.dataBody = root.querySelector("#srcbe-data-body");
    elements.descriptionTitle = root.querySelector("#srcbe-description-title");
    elements.descriptionText = root.querySelector("#srcbe-description-text");
    elements.scanButton = root.querySelector("#srcbe-scan-button");
    elements.newsStatus = root.querySelector("#srcbe-news-status");
    elements.resultCount = root.querySelector("#srcbe-result-count");
    elements.newsDrawer = root.querySelector("#srcbe-news-drawer");
    elements.closeDrawer = root.querySelector("#srcbe-close-drawer");
    elements.drawerStatus = root.querySelector("#srcbe-drawer-status");
    elements.newsList = root.querySelector("#srcbe-news-list");
  }

  function wireEvents(root) {
    root.querySelectorAll("[data-close-overlay]").forEach((button) => {
      button.addEventListener("click", closeOverlay);
    });

    elements.closeDrawer.addEventListener("click", closeNewsDrawer);
    elements.scanButton.addEventListener("click", scanNews);

    elements.cardImage.addEventListener("error", () => {
      elements.cardImage.hidden = true;
      elements.imageFallback.hidden = false;
    });

    document.addEventListener("keydown", handleKeydown);
  }

  async function loadEntityDetails(text) {
    setStatus("loading", "Gathering summary and entity details...");

    try {
      const response = await sendMessage({
        type: "SMART_RIGHT_CLICK_GET_ENTITY",
        text
      });

      if (!response.ok) {
        throw new Error(response.error || "Unable to fetch summary right now.");
      }

      renderSummary(response.data.summary);
      renderEntityCard(response.data.card, text);
      setStatus("success", "Analysis ready on this page.");
    } catch (error) {
      console.error("Overlay entity load failed:", error);
      setStatus("error", error.message || "Unable to fetch summary right now.");
    }
  }

  function renderSummary(summary) {
    elements.descriptionTitle.textContent = summary && summary.title ? summary.title : currentPayload.text;
    elements.descriptionText.textContent = summary && summary.summary ? summary.summary : "No Wikipedia summary found for this selection.";
  }

  function renderEntityCard(card, text) {
    renderCardImage(card && card.imageUrl);
    renderDataRows(card && card.fields, text);
  }

  function renderCardImage(imageUrl) {
    if (!imageUrl) {
      elements.cardImage.hidden = true;
      elements.imageFallback.hidden = false;
      return;
    }

    elements.cardImage.src = imageUrl;
    elements.cardImage.hidden = false;
    elements.imageFallback.hidden = true;
  }

  function renderDataRows(fields, text) {
    const rows = Array.isArray(fields) && fields.length
      ? fields
      : [{ label: "Entity query", value: text || "Not available", tone: "query" }];

    elements.dataBody.replaceChildren(
      ...rows.map((field) => {
        const row = document.createElement("tr");
        const labelCell = document.createElement("td");
        const valueCell = document.createElement("td");

        labelCell.textContent = field.label || "Field";
        valueCell.textContent = field.value || "Not available";
        valueCell.className = getValueToneClass(field);

        row.append(labelCell, valueCell);
        return row;
      })
    );
  }

  async function scanNews() {
    openNewsDrawer();
    elements.scanButton.disabled = true;
    elements.newsStatus.textContent = "Scanning recent negative-news style signals...";
    elements.drawerStatus.textContent = "Scanning recent negative-news style signals...";
    elements.newsList.replaceChildren();
    elements.resultCount.hidden = true;

    try {
      const response = await sendMessage({
        type: "SMART_RIGHT_CLICK_SCAN_NEWS",
        text: currentPayload.text
      });

      if (!response.ok) {
        throw new Error(response.error || "Unable to fetch news right now.");
      }

      const articles = response.data.articles || [];
      const providerLabel = buildProviderStatusLabel(response.data.providersUsed || [], response.data.providerErrors || []);

      if (!articles.length) {
        elements.newsStatus.textContent = "No negative-news style matches were found for this selection.";
        elements.drawerStatus.textContent = "No negative-news style matches were found for this selection.";
        return;
      }

      elements.newsStatus.textContent = providerLabel;
      elements.drawerStatus.textContent = providerLabel;
      elements.resultCount.hidden = false;
      elements.resultCount.textContent = `${articles.length} result${articles.length === 1 ? "" : "s"}`;
      renderArticles(articles);
    } catch (error) {
      console.error("Overlay news scan failed:", error);
      elements.newsStatus.textContent = error.message || "Unable to fetch news right now.";
      elements.drawerStatus.textContent = error.message || "Unable to fetch news right now.";
    } finally {
      elements.scanButton.disabled = false;
    }
  }

  function renderArticles(articles) {
    const fragment = document.createDocumentFragment();

    articles.forEach((article, index) => {
      const item = document.createElement("article");
      item.className = "srcbe-article";

      const number = document.createElement("span");
      number.className = "srcbe-article-number";
      number.textContent = String(index + 1).padStart(2, "0");

      const title = document.createElement("a");
      title.href = article.url;
      title.target = "_blank";
      title.rel = "noreferrer";
      title.textContent = article.title;

      const meta = document.createElement("p");
      const providerLabel = Array.isArray(article.providers) && article.providers.length
        ? `${article.providers.join(" + ")} API`
        : `${article.provider || "Unknown"} API`;
      meta.textContent = [providerLabel, article.source || "Unknown source", formatDate(article.publishedAt)].filter(Boolean).join(" - ");

      const body = document.createElement("div");
      body.append(title, meta);

      item.append(number, body);
      fragment.append(item);
    });

    elements.newsList.replaceChildren(fragment);
  }

  function openNewsDrawer() {
    elements.newsDrawer.classList.add("srcbe-is-open");
    elements.newsDrawer.setAttribute("aria-hidden", "false");
  }

  function closeNewsDrawer() {
    elements.newsDrawer.classList.remove("srcbe-is-open");
    elements.newsDrawer.setAttribute("aria-hidden", "true");
  }

  function closeOverlay() {
    closeNewsDrawer();

    if (!elements.root) {
      return;
    }

    elements.root.classList.remove("srcbe-is-visible");
    document.removeEventListener("keydown", handleKeydown);

    setTimeout(() => {
      removeExistingOverlay();
    }, 240);
  }

  function removeExistingOverlay() {
    const existing = document.getElementById(ROOT_ID);

    if (existing) {
      existing.remove();
    }
  }

  function handleKeydown(event) {
    if (event.key !== "Escape") {
      return;
    }

    if (elements.newsDrawer && elements.newsDrawer.classList.contains("srcbe-is-open")) {
      closeNewsDrawer();
      return;
    }

    closeOverlay();
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(response || { ok: false, error: "No response from extension." });
      });
    });
  }

  function setStatus(type, message) {
    elements.status.classList.remove("srcbe-status-loading", "srcbe-status-success", "srcbe-status-error");
    elements.status.classList.add(`srcbe-status-${type}`);
    elements.status.querySelector("p").textContent = message;
  }

  function applyQueryTheme(text, entityType) {
    const hue = pickHueFromText(text || "");
    elements.root.style.setProperty("--srcbe-query-hue", String(hue));

    elements.entityType.classList.remove("srcbe-pill-person", "srcbe-pill-place", "srcbe-pill-other");

    if (String(entityType).toLowerCase() === "person") {
      elements.entityType.classList.add("srcbe-pill-person");
    } else if (String(entityType).toLowerCase() === "place") {
      elements.entityType.classList.add("srcbe-pill-place");
    } else {
      elements.entityType.classList.add("srcbe-pill-other");
    }
  }

  function pickHueFromText(text) {
    let hash = 0;

    for (let index = 0; index < text.length; index += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(index);
      hash |= 0;
    }

    return Math.abs(hash) % 360;
  }

  function getValueToneClass(field) {
    const value = String(field.value || "").trim();
    const label = String(field.label || "").toLowerCase();

    if (field.tone === "query") {
      return "srcbe-tone-query";
    }

    if (!value || value === "Not available") {
      return "srcbe-tone-muted";
    }

    if (field.tone === "numeric" || /children|count|total|age/.test(label)) {
      const numeric = parseInt(value.replace(/[^\d-]/g, ""), 10);

      if (!Number.isNaN(numeric) && numeric > 2) {
        return "srcbe-tone-hot";
      }

      if (!Number.isNaN(numeric)) {
        return "srcbe-tone-mid";
      }
    }

    if (/website/.test(label) || /^https?:\/\//i.test(value)) {
      return "srcbe-tone-link";
    }

    return "srcbe-tone-default";
  }

  function buildProviderStatusLabel(providersUsed, providerErrors) {
    const usedLabel = providersUsed.length
      ? `Fetched via ${providersUsed.join(" + ")} API${providersUsed.length > 1 ? "s" : ""}.`
      : "";

    if (!providerErrors.length) {
      return usedLabel;
    }

    const failedProviders = providerErrors.map((item) => item.name).join(", ");

    return usedLabel ? `${usedLabel} ${failedProviders} currently unavailable.` : `${failedProviders} currently unavailable.`;
  }

  function formatDate(value) {
    const date = new Date(value);

    if (!value || Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
