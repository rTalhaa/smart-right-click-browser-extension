"use strict";

/*
  Copy this file to config.js for local testing.
  Keep config.js out of git because browser extension API keys are client-visible.
*/

const CONFIG = {
  GNEWS_API_KEY: "YOUR_GNEWS_KEY",
  NEWS_API_KEY: "YOUR_NEWSAPI_KEY"
};

globalThis.CONFIG = CONFIG;
