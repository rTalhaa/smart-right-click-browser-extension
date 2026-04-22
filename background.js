"use strict";

/*
  background.js (MV3 service worker)
  ----------------------------------
  This file is the extension entrypoint for browser events.

  End-to-end flow:
  1) User highlights text on any page and right-clicks.
  2) Browser shows one context menu item: "Analyze Selection".
  3) On click, we read info.selectionText directly from the context menu event.
  4) We build a payload and store it in chrome.storage.session.
  5) We open results.html?id=<requestId> in a new tab.

  Why session storage:
  MV3 workers can be suspended/restarted at any time, so global variables
  are not reliable for request handoff between background and results page.
*/

const MENU_ID = "analyze-selection";
const MENU_TITLE = "Analyze Selection";

// Re-create menu entries every install/update so stale menu state is cleared.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    createContextMenuItems();
  });
});

// Handle right-click action when user chooses our single context menu item.
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }

  // selectionText is provided by the browser when contexts: ["selection"] is used.
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

    chrome.tabs.create({ url: buildResultsUrl(requestId) });
  });
});

function createContextMenuItems() {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: MENU_TITLE,
    // Restrict menu visibility to selected text only.
    contexts: ["selection"]
  });
}

// Lightweight unique id for linking storage payload <-> results tab query param.
function createRequestId() {
  const timestamp = Date.now();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `req_${timestamp}_${suffix}`;
}

/*
  Demo-level entity detection heuristic.
  Priority:
  1) Place (keywords + common place names)
  2) Organization-like hints -> Other (avoid person false positives)
  3) 2+ capitalized words -> Person
  4) Fallback -> Other
*/
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
  // Use runtime URL so this works in both Chrome and Edge extension contexts.
  return chrome.runtime.getURL(`results.html?id=${encodeURIComponent(requestId)}`);
}
