var spotifyLyrics = (function() {
  "use strict";
  function defineContentScript(definition2) {
    return definition2;
  }
  const browser$1 = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
  const browser = browser$1;
  const definition = defineContentScript({
    matches: ["*://open.spotify.com/*"],
    runAt: "document_idle",
    main
  });
  const CONTROLS_ID = "sly-lyrics-controls";
  let mode = "original";
  let preferredMode = "original";
  let currentActiveLang = "en";
  let dualLyricsEnabled = true;
  let songKey = "";
  let cache = {
    original: [],
    processed: /* @__PURE__ */ new Map()
  };
  let domObserver = null;
  let lyricsObserver = null;
  let processGen = 0;
  let setupDebounceTimer = null;
  let pollId = null;
  let isApplying = false;
  let toastTimer = null;
  function showToast(message, durationMs = 0) {
    let toast = document.getElementById("sly-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "sly-toast";
      toast.className = "sly-toast";
      document.body.appendChild(toast);
    }
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("visible");
    if (durationMs > 0) {
      toastTimer = setTimeout(() => hideToast(), durationMs);
    }
  }
  function hideToast(onlyPersistent = false) {
    const toast = document.getElementById("sly-toast");
    if (!toast) return;
    if (onlyPersistent && toastTimer !== null) return;
    toast.classList.remove("visible");
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }
  const getLyricsLines = () => Array.from(document.querySelectorAll('[data-testid="lyrics-line"] > div'));
  const getLyricsContainer = () => document.querySelector('[data-testid="lyrics-line"]')?.parentElement ?? null;
  const getNowPlayingKey = () => document.querySelector('[data-testid="now-playing-widget"]')?.getAttribute("aria-label") ?? "";
  const hasLyrics = () => document.querySelector('[data-testid="lyrics-button"]:not([disabled])') !== null;
  function snapshotOriginals() {
    const lines = getLyricsLines();
    lines.forEach((el) => {
      if (el.hasAttribute("data-sly-original")) return;
      const dualSub = el.querySelector(".sly-dual-line");
      if (dualSub) {
        el.setAttribute("data-sly-original", dualSub.textContent ?? "");
        return;
      }
      const mainSpan = el.querySelector(".sly-main-line");
      if (mainSpan) {
        el.setAttribute("data-sly-original", mainSpan.textContent ?? "");
        return;
      }
      el.setAttribute("data-sly-original", el.textContent ?? "");
    });
    cache.original = lines.map((el) => el.getAttribute("data-sly-original") ?? "");
  }
  function injectControls(container) {
    if (document.getElementById(CONTROLS_ID)) return;
    const wrap = document.createElement("div");
    wrap.id = CONTROLS_ID;
    wrap.className = "sly-lyrics-controls";
    const displayMode = mode === "original" && preferredMode !== "original" ? preferredMode : mode;
    ["original", "romanized", "translated"].forEach((m) => {
      const btn = document.createElement("button");
      btn.className = `sly-lyrics-btn${displayMode === m ? " active" : ""}`;
      btn.textContent = m.charAt(0).toUpperCase() + m.slice(1);
      btn.dataset.mode = m;
      btn.addEventListener("click", () => switchMode(m));
      wrap.appendChild(btn);
    });
    container.insertBefore(wrap, container.firstChild);
  }
  function syncButtonStates() {
    document.getElementById(CONTROLS_ID)?.querySelectorAll(".sly-lyrics-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
  }
  function setLoadingState(loading) {
    document.getElementById(CONTROLS_ID)?.querySelectorAll(".sly-lyrics-btn").forEach((b) => b.disabled = loading);
    getLyricsContainer()?.classList.toggle("sly-loading", loading);
  }
  function applyLinesToDOM(lines, originals) {
    if (!Array.isArray(lines)) return;
    isApplying = true;
    getLyricsLines().forEach((el, i) => {
      if (lines[i] === void 0) return;
      if (originals?.[i] !== void 0) {
        el.setAttribute("data-sly-original", originals[i]);
      }
      const showDual = dualLyricsEnabled && originals !== void 0 && originals[i] !== void 0 && originals[i] !== lines[i];
      if (showDual) {
        el.textContent = "";
        const mainSpan = document.createElement("span");
        mainSpan.className = "sly-main-line";
        mainSpan.textContent = lines[i];
        el.appendChild(mainSpan);
        const subSpan = document.createElement("span");
        subSpan.className = "sly-dual-line";
        subSpan.textContent = originals[i];
        el.appendChild(subSpan);
      } else {
        el.textContent = lines[i];
      }
    });
    setTimeout(() => {
      isApplying = false;
    }, 0);
  }
  function startLyricsObserver() {
    lyricsObserver?.disconnect();
    const container = getLyricsContainer();
    if (!container) return;
    lyricsObserver = new MutationObserver(() => {
      if (isApplying || mode === "original") return;
      const processed = cache.processed.get(currentActiveLang);
      if (!processed) return;
      const lines = mode === "romanized" ? processed.romanized : processed.translated;
      const domLines = getLyricsLines();
      const needsReapply = domLines.some((el, i) => {
        if (lines[i] === void 0) return false;
        const mainSpan = el.querySelector(".sly-main-line");
        if (mainSpan) return mainSpan.textContent !== lines[i];
        return el.textContent !== lines[i];
      });
      if (needsReapply) {
        applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : void 0);
      }
    });
    lyricsObserver.observe(container, {
      subtree: true,
      childList: true,
      characterData: true
    });
  }
  async function getTargetLang() {
    const data = await browser.storage.sync.get("targetLang");
    return data.targetLang ?? "en";
  }
  async function fetchProcessed(lines, lang) {
    if (cache.processed.has(lang)) return cache.processed.get(lang);
    const gen = ++processGen;
    const result2 = await browser.runtime.sendMessage({
      type: "PROCESS",
      lines,
      targetLang: lang
    });
    if (gen !== processGen) return null;
    if (!result2 || !Array.isArray(result2.translated)) return null;
    cache.processed.set(lang, result2);
    return result2;
  }
  async function switchMode(next, forceLang) {
    if (next === mode && forceLang === void 0) return;
    if (cache.original.length === 0) snapshotOriginals();
    setLoadingState(true);
    try {
      if (next === "original") {
        mode = next;
        preferredMode = next;
        browser.storage.sync.set({
          preferredMode: next
        });
        applyLinesToDOM(cache.original);
      } else {
        const lang = forceLang ?? await getTargetLang();
        const processed = await fetchProcessed(cache.original, lang);
        if (processed === null) return;
        currentActiveLang = lang;
        mode = next;
        preferredMode = next;
        browser.storage.sync.set({
          preferredMode: next
        });
        const lines = next === "romanized" ? processed.romanized : processed.translated;
        applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : void 0);
      }
      syncButtonStates();
    } catch (err) {
      console.error("[SlyLyrics] Mode switch failed:", err);
      showToast("Translation failed. Please try again.", 3e3);
      mode = mode === next ? "original" : mode;
      syncButtonStates();
    } finally {
      hideToast(true);
      setLoadingState(false);
    }
  }
  async function reapplyMode() {
    if (mode === "original") return;
    const processed = cache.processed.get(currentActiveLang);
    if (!processed) return;
    const lines = mode === "romanized" ? processed.romanized : processed.translated;
    applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : void 0);
  }
  function autoSwitchIfNeeded() {
    if (mode === "original" && preferredMode !== "original") {
      switchMode(preferredMode);
    }
  }
  async function trySetup() {
    if (!hasLyrics()) return;
    const container = getLyricsContainer();
    if (!container) return;
    if (cache.original.length === 0) snapshotOriginals();
    injectControls(container);
    startLyricsObserver();
    await reapplyMode();
    autoSwitchIfNeeded();
  }
  function debouncedSetup() {
    if (setupDebounceTimer) cancelAnimationFrame(setupDebounceTimer);
    setupDebounceTimer = requestAnimationFrame(() => trySetup());
  }
  function pollForLyricsContainer(attempts = 0) {
    if (attempts > 120) return;
    if (hasLyrics() && getLyricsContainer()) {
      trySetup();
    } else {
      pollId = requestAnimationFrame(() => pollForLyricsContainer(attempts + 1));
    }
  }
  function onSongChange(newKey) {
    if (newKey === songKey) return;
    songKey = newKey;
    mode = "original";
    processGen++;
    lyricsObserver?.disconnect();
    lyricsObserver = null;
    cache = {
      original: [],
      processed: /* @__PURE__ */ new Map()
    };
    document.getElementById(CONTROLS_ID)?.remove();
    if (pollId) cancelAnimationFrame(pollId);
    pollForLyricsContainer();
  }
  function startStorageListener() {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if ("targetLang" in changes && mode === "translated") {
        const newLang = changes.targetLang.newValue ?? "en";
        switchMode("translated", newLang);
      }
      if ("dualLyrics" in changes) {
        dualLyricsEnabled = changes.dualLyrics.newValue ?? true;
        if (mode !== "original" && cache.original.length > 0) {
          const processed = cache.processed.get(currentActiveLang);
          if (processed) {
            const lines = mode === "romanized" ? processed.romanized : processed.translated;
            applyLinesToDOM(lines, dualLyricsEnabled ? cache.original : void 0);
          }
        }
      }
      if ("preferredMode" in changes) {
        const newPref = changes.preferredMode.newValue ?? "original";
        preferredMode = newPref;
        if (newPref === "original" && mode !== "original") {
          switchMode("original");
        }
      }
    });
  }
  function startObserver() {
    if (domObserver) return;
    domObserver = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        if (mut.type === "attributes" && mut.attributeName === "aria-label" && mut.target.closest('[data-testid="now-playing-widget"]')) {
          onSongChange(getNowPlayingKey());
          continue;
        }
        if (mut.type !== "childList") continue;
        for (const node of mut.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('[data-testid="lyrics-line"]') || node.querySelector('[data-testid="lyrics-line"]')) {
            debouncedSetup();
            break;
          }
        }
        for (const node of mut.removedNodes) {
          if (node instanceof Element && node.id === CONTROLS_ID) {
            debouncedSetup();
            break;
          }
        }
      }
    });
    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label"]
    });
  }
  async function main() {
    try {
      const prefs = await browser.storage.sync.get(["dualLyrics", "targetLang", "preferredMode"]);
      dualLyricsEnabled = prefs.dualLyrics !== void 0 ? prefs.dualLyrics : true;
      currentActiveLang = prefs.targetLang ?? "en";
      preferredMode = prefs.preferredMode ?? "original";
    } catch {
      console.warn("[SlyLyrics] storage.sync unavailable, using defaults");
      dualLyricsEnabled = true;
      currentActiveLang = "en";
      preferredMode = "original";
    }
    startObserver();
    startStorageListener();
    trySetup();
  }
  function print$1(method, ...args) {
    if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
    else method("[wxt]", ...args);
  }
  const logger$1 = {
    debug: (...args) => print$1(console.debug, ...args),
    log: (...args) => print$1(console.log, ...args),
    warn: (...args) => print$1(console.warn, ...args),
    error: (...args) => print$1(console.error, ...args)
  };
  var WxtLocationChangeEvent = class WxtLocationChangeEvent2 extends Event {
    static EVENT_NAME = getUniqueEventName("wxt:locationchange");
    constructor(newUrl, oldUrl) {
      super(WxtLocationChangeEvent2.EVENT_NAME, {});
      this.newUrl = newUrl;
      this.oldUrl = oldUrl;
    }
  };
  function getUniqueEventName(eventName) {
    return `${browser?.runtime?.id}:${"spotify-lyrics"}:${eventName}`;
  }
  function createLocationWatcher(ctx) {
    let interval;
    let oldUrl;
    return { run() {
      if (interval != null) return;
      oldUrl = new URL(location.href);
      interval = ctx.setInterval(() => {
        let newUrl = new URL(location.href);
        if (newUrl.href !== oldUrl.href) {
          window.dispatchEvent(new WxtLocationChangeEvent(newUrl, oldUrl));
          oldUrl = newUrl;
        }
      }, 1e3);
    } };
  }
  var ContentScriptContext = class ContentScriptContext2 {
    static SCRIPT_STARTED_MESSAGE_TYPE = getUniqueEventName("wxt:content-script-started");
    id;
    abortController;
    locationWatcher = createLocationWatcher(this);
    constructor(contentScriptName, options) {
      this.contentScriptName = contentScriptName;
      this.options = options;
      this.id = Math.random().toString(36).slice(2);
      this.abortController = new AbortController();
      this.stopOldScripts();
      this.listenForNewerScripts();
    }
    get signal() {
      return this.abortController.signal;
    }
    abort(reason) {
      return this.abortController.abort(reason);
    }
    get isInvalid() {
      if (browser.runtime?.id == null) this.notifyInvalidated();
      return this.signal.aborted;
    }
    get isValid() {
      return !this.isInvalid;
    }
    /**
    * Add a listener that is called when the content script's context is invalidated.
    *
    * @returns A function to remove the listener.
    *
    * @example
    * browser.runtime.onMessage.addListener(cb);
    * const removeInvalidatedListener = ctx.onInvalidated(() => {
    *   browser.runtime.onMessage.removeListener(cb);
    * })
    * // ...
    * removeInvalidatedListener();
    */
    onInvalidated(cb) {
      this.signal.addEventListener("abort", cb);
      return () => this.signal.removeEventListener("abort", cb);
    }
    /**
    * Return a promise that never resolves. Useful if you have an async function that shouldn't run
    * after the context is expired.
    *
    * @example
    * const getValueFromStorage = async () => {
    *   if (ctx.isInvalid) return ctx.block();
    *
    *   // ...
    * }
    */
    block() {
      return new Promise(() => {
      });
    }
    /**
    * Wrapper around `window.setInterval` that automatically clears the interval when invalidated.
    *
    * Intervals can be cleared by calling the normal `clearInterval` function.
    */
    setInterval(handler, timeout) {
      const id = setInterval(() => {
        if (this.isValid) handler();
      }, timeout);
      this.onInvalidated(() => clearInterval(id));
      return id;
    }
    /**
    * Wrapper around `window.setTimeout` that automatically clears the interval when invalidated.
    *
    * Timeouts can be cleared by calling the normal `setTimeout` function.
    */
    setTimeout(handler, timeout) {
      const id = setTimeout(() => {
        if (this.isValid) handler();
      }, timeout);
      this.onInvalidated(() => clearTimeout(id));
      return id;
    }
    /**
    * Wrapper around `window.requestAnimationFrame` that automatically cancels the request when
    * invalidated.
    *
    * Callbacks can be canceled by calling the normal `cancelAnimationFrame` function.
    */
    requestAnimationFrame(callback) {
      const id = requestAnimationFrame((...args) => {
        if (this.isValid) callback(...args);
      });
      this.onInvalidated(() => cancelAnimationFrame(id));
      return id;
    }
    /**
    * Wrapper around `window.requestIdleCallback` that automatically cancels the request when
    * invalidated.
    *
    * Callbacks can be canceled by calling the normal `cancelIdleCallback` function.
    */
    requestIdleCallback(callback, options) {
      const id = requestIdleCallback((...args) => {
        if (!this.signal.aborted) callback(...args);
      }, options);
      this.onInvalidated(() => cancelIdleCallback(id));
      return id;
    }
    addEventListener(target, type, handler, options) {
      if (type === "wxt:locationchange") {
        if (this.isValid) this.locationWatcher.run();
      }
      target.addEventListener?.(type.startsWith("wxt:") ? getUniqueEventName(type) : type, handler, {
        ...options,
        signal: this.signal
      });
    }
    /**
    * @internal
    * Abort the abort controller and execute all `onInvalidated` listeners.
    */
    notifyInvalidated() {
      this.abort("Content script context invalidated");
      logger$1.debug(`Content script "${this.contentScriptName}" context invalidated`);
    }
    stopOldScripts() {
      document.dispatchEvent(new CustomEvent(ContentScriptContext2.SCRIPT_STARTED_MESSAGE_TYPE, { detail: {
        contentScriptName: this.contentScriptName,
        messageId: this.id
      } }));
      window.postMessage({
        type: ContentScriptContext2.SCRIPT_STARTED_MESSAGE_TYPE,
        contentScriptName: this.contentScriptName,
        messageId: this.id
      }, "*");
    }
    verifyScriptStartedEvent(event) {
      const isSameContentScript = event.detail?.contentScriptName === this.contentScriptName;
      const isFromSelf = event.detail?.messageId === this.id;
      return isSameContentScript && !isFromSelf;
    }
    listenForNewerScripts() {
      const cb = (event) => {
        if (!(event instanceof CustomEvent) || !this.verifyScriptStartedEvent(event)) return;
        this.notifyInvalidated();
      };
      document.addEventListener(ContentScriptContext2.SCRIPT_STARTED_MESSAGE_TYPE, cb);
      this.onInvalidated(() => document.removeEventListener(ContentScriptContext2.SCRIPT_STARTED_MESSAGE_TYPE, cb));
    }
  };
  function initPlugins() {
  }
  function print(method, ...args) {
    if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
    else method("[wxt]", ...args);
  }
  const logger = {
    debug: (...args) => print(console.debug, ...args),
    log: (...args) => print(console.log, ...args),
    warn: (...args) => print(console.warn, ...args),
    error: (...args) => print(console.error, ...args)
  };
  const result = (async () => {
    try {
      initPlugins();
      const { main: main2, ...options } = definition;
      return await main2(new ContentScriptContext("spotify-lyrics", options));
    } catch (err) {
      logger.error(`The content script "${"spotify-lyrics"}" crashed on startup!`, err);
      throw err;
    }
  })();
  return result;
})();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3BvdGlmeS1seXJpY3MuanMiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC91dGlscy9kZWZpbmUtY29udGVudC1zY3JpcHQubWpzIiwiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0B3eHQtZGV2L2Jyb3dzZXIvc3JjL2luZGV4Lm1qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC9icm93c2VyLm1qcyIsIi4uLy4uLy4uL2VudHJ5cG9pbnRzL3Nwb3RpZnktbHlyaWNzLmNvbnRlbnQvaW5kZXgudHMiLCIuLi8uLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvdXRpbHMvaW50ZXJuYWwvbG9nZ2VyLm1qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC91dGlscy9pbnRlcm5hbC9jdXN0b20tZXZlbnRzLm1qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC91dGlscy9pbnRlcm5hbC9sb2NhdGlvbi13YXRjaGVyLm1qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC91dGlscy9jb250ZW50LXNjcmlwdC1jb250ZXh0Lm1qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyNyZWdpb24gc3JjL3V0aWxzL2RlZmluZS1jb250ZW50LXNjcmlwdC50c1xuZnVuY3Rpb24gZGVmaW5lQ29udGVudFNjcmlwdChkZWZpbml0aW9uKSB7XG5cdHJldHVybiBkZWZpbml0aW9uO1xufVxuXG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGRlZmluZUNvbnRlbnRTY3JpcHQgfTsiLCIvLyAjcmVnaW9uIHNuaXBwZXRcbmV4cG9ydCBjb25zdCBicm93c2VyID0gZ2xvYmFsVGhpcy5icm93c2VyPy5ydW50aW1lPy5pZFxuICA/IGdsb2JhbFRoaXMuYnJvd3NlclxuICA6IGdsb2JhbFRoaXMuY2hyb21lO1xuLy8gI2VuZHJlZ2lvbiBzbmlwcGV0XG4iLCJpbXBvcnQgeyBicm93c2VyIGFzIGJyb3dzZXIkMSB9IGZyb20gXCJAd3h0LWRldi9icm93c2VyXCI7XG5cbi8vI3JlZ2lvbiBzcmMvYnJvd3Nlci50c1xuLyoqXG4qIENvbnRhaW5zIHRoZSBgYnJvd3NlcmAgZXhwb3J0IHdoaWNoIHlvdSBzaG91bGQgdXNlIHRvIGFjY2VzcyB0aGUgZXh0ZW5zaW9uIEFQSXMgaW4geW91ciBwcm9qZWN0OlxuKiBgYGB0c1xuKiBpbXBvcnQgeyBicm93c2VyIH0gZnJvbSAnd3h0L2Jyb3dzZXInO1xuKlxuKiBicm93c2VyLnJ1bnRpbWUub25JbnN0YWxsZWQuYWRkTGlzdGVuZXIoKCkgPT4ge1xuKiAgIC8vIC4uLlxuKiB9KVxuKiBgYGBcbiogQG1vZHVsZSB3eHQvYnJvd3NlclxuKi9cbmNvbnN0IGJyb3dzZXIgPSBicm93c2VyJDE7XG5cbi8vI2VuZHJlZ2lvblxuZXhwb3J0IHsgYnJvd3NlciB9OyIsImltcG9ydCAnLi9zdHlsZS5jc3MnO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29udGVudFNjcmlwdCh7XHJcbiAgbWF0Y2hlczogWycqOi8vb3Blbi5zcG90aWZ5LmNvbS8qJ10sXHJcbiAgcnVuQXQ6ICdkb2N1bWVudF9pZGxlJyxcclxuICBtYWluLFxyXG59KTtcclxuXHJcbi8vIOKUgOKUgOKUgCBUeXBlcyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcclxuXHJcbnR5cGUgTHlyaWNzTW9kZSA9ICdvcmlnaW5hbCcgfCAncm9tYW5pemVkJyB8ICd0cmFuc2xhdGVkJztcclxuXHJcbmludGVyZmFjZSBQcm9jZXNzZWRDYWNoZSB7XHJcbiAgdHJhbnNsYXRlZDogc3RyaW5nW107XHJcbiAgcm9tYW5pemVkOiBzdHJpbmdbXTtcclxufVxyXG5cclxuaW50ZXJmYWNlIFNvbmdDYWNoZSB7XHJcbiAgb3JpZ2luYWw6IHN0cmluZ1tdO1xyXG4gIC8vIEtleTogdGFyZ2V0TGFuZyBjb2RlLiBCb3RoIHJvbWFuaXplZCBhbmQgdHJhbnNsYXRlZCBzdG9yZWQgdG9nZXRoZXJcclxuICAvLyBzaW5jZSB0aGV5IGNvbWUgZnJvbSB0aGUgc2FtZSBBUEkgY2FsbC5cclxuICBwcm9jZXNzZWQ6IE1hcDxzdHJpbmcsIFByb2Nlc3NlZENhY2hlPjtcclxufVxyXG5cclxuLy8g4pSA4pSA4pSAIFN0YXRlIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxyXG5cclxuY29uc3QgQ09OVFJPTFNfSUQgPSAnc2x5LWx5cmljcy1jb250cm9scyc7XHJcbmxldCBtb2RlOiBMeXJpY3NNb2RlID0gJ29yaWdpbmFsJztcclxubGV0IHByZWZlcnJlZE1vZGU6IEx5cmljc01vZGUgPSAnb3JpZ2luYWwnO1xyXG5sZXQgY3VycmVudEFjdGl2ZUxhbmcgPSAnZW4nO1xyXG5sZXQgZHVhbEx5cmljc0VuYWJsZWQgPSB0cnVlO1xyXG5sZXQgc29uZ0tleSA9ICcnO1xyXG5sZXQgY2FjaGU6IFNvbmdDYWNoZSA9IHsgb3JpZ2luYWw6IFtdLCBwcm9jZXNzZWQ6IG5ldyBNYXAoKSB9O1xyXG5sZXQgZG9tT2JzZXJ2ZXI6IE11dGF0aW9uT2JzZXJ2ZXIgfCBudWxsID0gbnVsbDtcclxubGV0IGx5cmljc09ic2VydmVyOiBNdXRhdGlvbk9ic2VydmVyIHwgbnVsbCA9IG51bGw7XHJcbmxldCBwcm9jZXNzR2VuID0gMDsgLy8gY2FuY2VsIHN0YWxlIGluLWZsaWdodCByZXF1ZXN0c1xyXG5sZXQgc2V0dXBEZWJvdW5jZVRpbWVyOiBudW1iZXIgfCBudWxsID0gbnVsbDtcclxubGV0IHBvbGxJZDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XHJcbmxldCBpc0FwcGx5aW5nID0gZmFsc2U7XHJcblxyXG4vLyDilIDilIDilIAgRE9NIFF1ZXJpZXMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXHJcblxyXG5sZXQgdG9hc3RUaW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsID0gbnVsbDtcclxuXHJcbmZ1bmN0aW9uIHNob3dUb2FzdChtZXNzYWdlOiBzdHJpbmcsIGR1cmF0aW9uTXMgPSAwKTogdm9pZCB7XHJcbiAgbGV0IHRvYXN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NseS10b2FzdCcpO1xyXG4gIGlmICghdG9hc3QpIHtcclxuICAgIHRvYXN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICB0b2FzdC5pZCA9ICdzbHktdG9hc3QnO1xyXG4gICAgdG9hc3QuY2xhc3NOYW1lID0gJ3NseS10b2FzdCc7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHRvYXN0KTtcclxuICB9XHJcblxyXG4gIGlmICh0b2FzdFRpbWVyKSBjbGVhclRpbWVvdXQodG9hc3RUaW1lcik7XHJcbiAgdG9hc3QudGV4dENvbnRlbnQgPSBtZXNzYWdlO1xyXG4gIHRvYXN0LmNsYXNzTGlzdC5hZGQoJ3Zpc2libGUnKTtcclxuXHJcbiAgLy8gZHVyYXRpb25NcyA9IDAgbWVhbnMgcGVyc2lzdGVudCB1bnRpbCBoaWRlVG9hc3QoKSBpcyBjYWxsZWRcclxuICBpZiAoZHVyYXRpb25NcyA+IDApIHtcclxuICAgIHRvYXN0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IGhpZGVUb2FzdCgpLCBkdXJhdGlvbk1zKTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGhpZGVUb2FzdChvbmx5UGVyc2lzdGVudCA9IGZhbHNlKTogdm9pZCB7XHJcbiAgY29uc3QgdG9hc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2x5LXRvYXN0Jyk7XHJcbiAgaWYgKCF0b2FzdCkgcmV0dXJuO1xyXG4gIC8vIElmIG9ubHlQZXJzaXN0ZW50IGlzIHRydWUsIGRvbid0IGRpc21pc3MgYSB0aW1lZCB0b2FzdCBtaWQtY291bnRkb3duXHJcbiAgaWYgKG9ubHlQZXJzaXN0ZW50ICYmIHRvYXN0VGltZXIgIT09IG51bGwpIHJldHVybjtcclxuICB0b2FzdC5jbGFzc0xpc3QucmVtb3ZlKCd2aXNpYmxlJyk7XHJcbiAgaWYgKHRvYXN0VGltZXIpIHtcclxuICAgIGNsZWFyVGltZW91dCh0b2FzdFRpbWVyKTtcclxuICAgIHRvYXN0VGltZXIgPSBudWxsO1xyXG4gIH1cclxufVxyXG5cclxuY29uc3QgZ2V0THlyaWNzTGluZXMgPSAoKTogRWxlbWVudFtdID0+XHJcbiAgQXJyYXkuZnJvbShkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdbZGF0YS10ZXN0aWQ9XCJseXJpY3MtbGluZVwiXSA+IGRpdicpKTtcclxuXHJcbmNvbnN0IGdldEx5cmljc0NvbnRhaW5lciA9ICgpOiBFbGVtZW50IHwgbnVsbCA9PlxyXG4gIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ1tkYXRhLXRlc3RpZD1cImx5cmljcy1saW5lXCJdJyk/LnBhcmVudEVsZW1lbnQgPz8gbnVsbDtcclxuXHJcbmNvbnN0IGdldE5vd1BsYXlpbmdLZXkgPSAoKTogc3RyaW5nID0+XHJcbiAgZG9jdW1lbnQucXVlcnlTZWxlY3RvcignW2RhdGEtdGVzdGlkPVwibm93LXBsYXlpbmctd2lkZ2V0XCJdJylcclxuICAgID8uZ2V0QXR0cmlidXRlKCdhcmlhLWxhYmVsJykgPz8gJyc7XHJcblxyXG5jb25zdCBoYXNMeXJpY3MgPSAoKTogYm9vbGVhbiA9PlxyXG4gIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ1tkYXRhLXRlc3RpZD1cImx5cmljcy1idXR0b25cIl06bm90KFtkaXNhYmxlZF0pJykgIT09IG51bGw7XHJcblxyXG4vLyDilIDilIDilIAgU25hcHNob3Qg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXHJcblxyXG5mdW5jdGlvbiBzbmFwc2hvdE9yaWdpbmFscygpOiB2b2lkIHtcclxuICBjb25zdCBsaW5lcyA9IGdldEx5cmljc0xpbmVzKCk7XHJcblxyXG4gIGxpbmVzLmZvckVhY2goKGVsKSA9PiB7XHJcbiAgICBpZiAoZWwuaGFzQXR0cmlidXRlKCdkYXRhLXNseS1vcmlnaW5hbCcpKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgZHVhbFN1YiA9IGVsLnF1ZXJ5U2VsZWN0b3I8SFRNTEVsZW1lbnQ+KCcuc2x5LWR1YWwtbGluZScpO1xyXG4gICAgaWYgKGR1YWxTdWIpIHtcclxuICAgICAgZWwuc2V0QXR0cmlidXRlKCdkYXRhLXNseS1vcmlnaW5hbCcsIGR1YWxTdWIudGV4dENvbnRlbnQgPz8gJycpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBtYWluU3BhbiA9IGVsLnF1ZXJ5U2VsZWN0b3I8SFRNTEVsZW1lbnQ+KCcuc2x5LW1haW4tbGluZScpO1xyXG4gICAgaWYgKG1haW5TcGFuKSB7XHJcbiAgICAgIGVsLnNldEF0dHJpYnV0ZSgnZGF0YS1zbHktb3JpZ2luYWwnLCBtYWluU3Bhbi50ZXh0Q29udGVudCA/PyAnJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGVsLnNldEF0dHJpYnV0ZSgnZGF0YS1zbHktb3JpZ2luYWwnLCBlbC50ZXh0Q29udGVudCA/PyAnJyk7XHJcbiAgfSk7XHJcblxyXG4gIGNhY2hlLm9yaWdpbmFsID0gbGluZXMubWFwKFxyXG4gICAgKGVsKSA9PiBlbC5nZXRBdHRyaWJ1dGUoJ2RhdGEtc2x5LW9yaWdpbmFsJykgPz8gJydcclxuICApO1xyXG59XHJcblxyXG4vLyDilIDilIDilIAgQ29udHJvbHMgVUkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXHJcblxyXG5mdW5jdGlvbiBpbmplY3RDb250cm9scyhjb250YWluZXI6IEVsZW1lbnQpOiB2b2lkIHtcclxuICBpZiAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoQ09OVFJPTFNfSUQpKSByZXR1cm47XHJcblxyXG4gIGNvbnN0IHdyYXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICB3cmFwLmlkID0gQ09OVFJPTFNfSUQ7XHJcbiAgd3JhcC5jbGFzc05hbWUgPSAnc2x5LWx5cmljcy1jb250cm9scyc7XHJcblxyXG4gIGNvbnN0IGRpc3BsYXlNb2RlID1cclxuICAgIG1vZGUgPT09ICdvcmlnaW5hbCcgJiYgcHJlZmVycmVkTW9kZSAhPT0gJ29yaWdpbmFsJyA/IHByZWZlcnJlZE1vZGUgOiBtb2RlO1xyXG5cclxuICAoWydvcmlnaW5hbCcsICdyb21hbml6ZWQnLCAndHJhbnNsYXRlZCddIGFzIEx5cmljc01vZGVbXSkuZm9yRWFjaCgobSkgPT4ge1xyXG4gICAgY29uc3QgYnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XHJcbiAgICBidG4uY2xhc3NOYW1lID0gYHNseS1seXJpY3MtYnRuJHtkaXNwbGF5TW9kZSA9PT0gbSA/ICcgYWN0aXZlJyA6ICcnfWA7XHJcbiAgICBidG4udGV4dENvbnRlbnQgPSBtLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgbS5zbGljZSgxKTtcclxuICAgIGJ0bi5kYXRhc2V0Lm1vZGUgPSBtO1xyXG4gICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gc3dpdGNoTW9kZShtKSk7XHJcbiAgICB3cmFwLmFwcGVuZENoaWxkKGJ0bik7XHJcbiAgfSk7XHJcblxyXG4gIGNvbnRhaW5lci5pbnNlcnRCZWZvcmUod3JhcCwgY29udGFpbmVyLmZpcnN0Q2hpbGQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzeW5jQnV0dG9uU3RhdGVzKCk6IHZvaWQge1xyXG4gIGRvY3VtZW50XHJcbiAgICAuZ2V0RWxlbWVudEJ5SWQoQ09OVFJPTFNfSUQpXHJcbiAgICA/LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCcuc2x5LWx5cmljcy1idG4nKVxyXG4gICAgLmZvckVhY2goKGJ0bikgPT4gYnRuLmNsYXNzTGlzdC50b2dnbGUoJ2FjdGl2ZScsIGJ0bi5kYXRhc2V0Lm1vZGUgPT09IG1vZGUpKTtcclxufVxyXG5cclxuZnVuY3Rpb24gc2V0TG9hZGluZ1N0YXRlKGxvYWRpbmc6IGJvb2xlYW4pOiB2b2lkIHtcclxuICBkb2N1bWVudFxyXG4gICAgLmdldEVsZW1lbnRCeUlkKENPTlRST0xTX0lEKVxyXG4gICAgPy5xdWVyeVNlbGVjdG9yQWxsPEhUTUxCdXR0b25FbGVtZW50PignLnNseS1seXJpY3MtYnRuJylcclxuICAgIC5mb3JFYWNoKChiKSA9PiAoYi5kaXNhYmxlZCA9IGxvYWRpbmcpKTtcclxuICBnZXRMeXJpY3NDb250YWluZXIoKT8uY2xhc3NMaXN0LnRvZ2dsZSgnc2x5LWxvYWRpbmcnLCBsb2FkaW5nKTtcclxufVxyXG5cclxuLy8g4pSA4pSA4pSAIEx5cmljcyBSZXBsYWNlbWVudCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcclxuXHJcbmZ1bmN0aW9uIGFwcGx5TGluZXNUb0RPTShcclxuICBsaW5lczogc3RyaW5nW10gfCBudWxsIHwgdW5kZWZpbmVkLFxyXG4gIG9yaWdpbmFscz86IHN0cmluZ1tdXHJcbik6IHZvaWQge1xyXG4gIGlmICghQXJyYXkuaXNBcnJheShsaW5lcykpIHJldHVybjtcclxuXHJcbiAgaXNBcHBseWluZyA9IHRydWU7XHJcblxyXG4gIGdldEx5cmljc0xpbmVzKCkuZm9yRWFjaCgoZWwsIGkpID0+IHtcclxuICAgIGlmIChsaW5lc1tpXSA9PT0gdW5kZWZpbmVkKSByZXR1cm47XHJcblxyXG4gICAgaWYgKG9yaWdpbmFscz8uW2ldICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgZWwuc2V0QXR0cmlidXRlKCdkYXRhLXNseS1vcmlnaW5hbCcsIG9yaWdpbmFsc1tpXSk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc2hvd0R1YWwgPVxyXG4gICAgICBkdWFsTHlyaWNzRW5hYmxlZCAmJlxyXG4gICAgICBvcmlnaW5hbHMgIT09IHVuZGVmaW5lZCAmJlxyXG4gICAgICBvcmlnaW5hbHNbaV0gIT09IHVuZGVmaW5lZCAmJlxyXG4gICAgICBvcmlnaW5hbHNbaV0gIT09IGxpbmVzW2ldO1xyXG5cclxuICAgIGlmIChzaG93RHVhbCkge1xyXG4gICAgICBlbC50ZXh0Q29udGVudCA9ICcnO1xyXG4gICAgICBjb25zdCBtYWluU3BhbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKTtcclxuICAgICAgbWFpblNwYW4uY2xhc3NOYW1lID0gJ3NseS1tYWluLWxpbmUnO1xyXG4gICAgICBtYWluU3Bhbi50ZXh0Q29udGVudCA9IGxpbmVzW2ldO1xyXG4gICAgICBlbC5hcHBlbmRDaGlsZChtYWluU3Bhbik7XHJcblxyXG4gICAgICBjb25zdCBzdWJTcGFuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3BhbicpO1xyXG4gICAgICBzdWJTcGFuLmNsYXNzTmFtZSA9ICdzbHktZHVhbC1saW5lJztcclxuICAgICAgc3ViU3Bhbi50ZXh0Q29udGVudCA9IG9yaWdpbmFscyFbaV07XHJcbiAgICAgIGVsLmFwcGVuZENoaWxkKHN1YlNwYW4pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgZWwudGV4dENvbnRlbnQgPSBsaW5lc1tpXTtcclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgc2V0VGltZW91dCgoKSA9PiB7IGlzQXBwbHlpbmcgPSBmYWxzZTsgfSwgMCk7XHJcbn1cclxuXHJcbi8vIOKUgOKUgOKUgCBBbnRpLUZsaWNrZXIgTHlyaWNzIE9ic2VydmVyIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxyXG5cclxuZnVuY3Rpb24gc3RhcnRMeXJpY3NPYnNlcnZlcigpOiB2b2lkIHtcclxuICBseXJpY3NPYnNlcnZlcj8uZGlzY29ubmVjdCgpO1xyXG4gIGNvbnN0IGNvbnRhaW5lciA9IGdldEx5cmljc0NvbnRhaW5lcigpO1xyXG4gIGlmICghY29udGFpbmVyKSByZXR1cm47XHJcblxyXG4gIGx5cmljc09ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIoKCkgPT4ge1xyXG4gICAgaWYgKGlzQXBwbHlpbmcgfHwgbW9kZSA9PT0gJ29yaWdpbmFsJykgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IHByb2Nlc3NlZCA9IGNhY2hlLnByb2Nlc3NlZC5nZXQoY3VycmVudEFjdGl2ZUxhbmcpO1xyXG4gICAgaWYgKCFwcm9jZXNzZWQpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBsaW5lcyA9IG1vZGUgPT09ICdyb21hbml6ZWQnID8gcHJvY2Vzc2VkLnJvbWFuaXplZCA6IHByb2Nlc3NlZC50cmFuc2xhdGVkO1xyXG4gICAgY29uc3QgZG9tTGluZXMgPSBnZXRMeXJpY3NMaW5lcygpO1xyXG5cclxuICAgIGNvbnN0IG5lZWRzUmVhcHBseSA9IGRvbUxpbmVzLnNvbWUoKGVsLCBpKSA9PiB7XHJcbiAgICAgIGlmIChsaW5lc1tpXSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XHJcbiAgICAgIGNvbnN0IG1haW5TcGFuID0gZWwucXVlcnlTZWxlY3RvcjxIVE1MRWxlbWVudD4oJy5zbHktbWFpbi1saW5lJyk7XHJcbiAgICAgIGlmIChtYWluU3BhbikgcmV0dXJuIG1haW5TcGFuLnRleHRDb250ZW50ICE9PSBsaW5lc1tpXTtcclxuICAgICAgcmV0dXJuIGVsLnRleHRDb250ZW50ICE9PSBsaW5lc1tpXTtcclxuICAgIH0pO1xyXG5cclxuICAgIGlmIChuZWVkc1JlYXBwbHkpIHtcclxuICAgICAgYXBwbHlMaW5lc1RvRE9NKGxpbmVzLCBkdWFsTHlyaWNzRW5hYmxlZCA/IGNhY2hlLm9yaWdpbmFsIDogdW5kZWZpbmVkKTtcclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgbHlyaWNzT2JzZXJ2ZXIub2JzZXJ2ZShjb250YWluZXIsIHtcclxuICAgIHN1YnRyZWU6IHRydWUsXHJcbiAgICBjaGlsZExpc3Q6IHRydWUsXHJcbiAgICBjaGFyYWN0ZXJEYXRhOiB0cnVlLFxyXG4gIH0pO1xyXG59XHJcblxyXG4vLyDilIDilIDilIAgRmV0Y2gg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRUYXJnZXRMYW5nKCk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgY29uc3QgZGF0YSA9IGF3YWl0IGJyb3dzZXIuc3RvcmFnZS5zeW5jLmdldCgndGFyZ2V0TGFuZycpO1xyXG4gIHJldHVybiAoZGF0YS50YXJnZXRMYW5nIGFzIHN0cmluZykgPz8gJ2VuJztcclxufVxyXG5cclxuLyoqXHJcbiAqIEZldGNoZXMgYm90aCB0cmFuc2xhdGVkIGFuZCByb21hbml6ZWQgbGluZXMgaW4gYSBzaW5nbGUgYmFja2dyb3VuZCBjYWxsLlxyXG4gKiBDYWNoZXMgYnkgdGFyZ2V0TGFuZyDigJQgc3dpdGNoaW5nIGJldHdlZW4gUm9tYW5pemVkIGFuZCBUcmFuc2xhdGVkIGFmdGVyXHJcbiAqIHRoZSBmaXJzdCBmZXRjaCBmb3IgYSBnaXZlbiBsYW5ndWFnZSBpcyBhbHdheXMgYSBjYWNoZSBoaXQuXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBmZXRjaFByb2Nlc3NlZChcclxuICBsaW5lczogc3RyaW5nW10sXHJcbiAgbGFuZzogc3RyaW5nXHJcbik6IFByb21pc2U8UHJvY2Vzc2VkQ2FjaGUgfCBudWxsPiB7XHJcbiAgaWYgKGNhY2hlLnByb2Nlc3NlZC5oYXMobGFuZykpIHJldHVybiBjYWNoZS5wcm9jZXNzZWQuZ2V0KGxhbmcpITtcclxuXHJcbiAgY29uc3QgZ2VuID0gKytwcm9jZXNzR2VuO1xyXG5cclxuICBjb25zdCByZXN1bHQgPSBhd2FpdCBicm93c2VyLnJ1bnRpbWUuc2VuZE1lc3NhZ2Uoe1xyXG4gICAgdHlwZTogJ1BST0NFU1MnLFxyXG4gICAgbGluZXMsXHJcbiAgICB0YXJnZXRMYW5nOiBsYW5nLFxyXG4gIH0pIGFzIFByb2Nlc3NlZENhY2hlIHwgbnVsbDtcclxuXHJcbiAgaWYgKGdlbiAhPT0gcHJvY2Vzc0dlbikgcmV0dXJuIG51bGw7IC8vIHN0YWxlIOKAlCBzb25nIG9yIGxhbmcgY2hhbmdlZCBtaWQtZmxpZ2h0XHJcbiAgaWYgKCFyZXN1bHQgfHwgIUFycmF5LmlzQXJyYXkocmVzdWx0LnRyYW5zbGF0ZWQpKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgY2FjaGUucHJvY2Vzc2VkLnNldChsYW5nLCByZXN1bHQpO1xyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8vIOKUgOKUgOKUgCBNb2RlIFN3aXRjaGluZyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHN3aXRjaE1vZGUobmV4dDogTHlyaWNzTW9kZSwgZm9yY2VMYW5nPzogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgaWYgKG5leHQgPT09IG1vZGUgJiYgZm9yY2VMYW5nID09PSB1bmRlZmluZWQpIHJldHVybjtcclxuICBpZiAoY2FjaGUub3JpZ2luYWwubGVuZ3RoID09PSAwKSBzbmFwc2hvdE9yaWdpbmFscygpO1xyXG5cclxuICBzZXRMb2FkaW5nU3RhdGUodHJ1ZSk7XHJcblxyXG4gIHRyeSB7XHJcbiAgICBpZiAobmV4dCA9PT0gJ29yaWdpbmFsJykge1xyXG4gICAgICBtb2RlID0gbmV4dDtcclxuICAgICAgcHJlZmVycmVkTW9kZSA9IG5leHQ7XHJcbiAgICAgIGJyb3dzZXIuc3RvcmFnZS5zeW5jLnNldCh7IHByZWZlcnJlZE1vZGU6IG5leHQgfSk7XHJcbiAgICAgIGFwcGx5TGluZXNUb0RPTShjYWNoZS5vcmlnaW5hbCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBjb25zdCBsYW5nID0gZm9yY2VMYW5nID8/IChhd2FpdCBnZXRUYXJnZXRMYW5nKCkpO1xyXG4gICAgICBjb25zdCBwcm9jZXNzZWQgPSBhd2FpdCBmZXRjaFByb2Nlc3NlZChjYWNoZS5vcmlnaW5hbCwgbGFuZyk7XHJcblxyXG4gICAgICBpZiAocHJvY2Vzc2VkID09PSBudWxsKSByZXR1cm47XHJcblxyXG4gICAgICBjdXJyZW50QWN0aXZlTGFuZyA9IGxhbmc7XHJcbiAgICAgIG1vZGUgPSBuZXh0O1xyXG4gICAgICBwcmVmZXJyZWRNb2RlID0gbmV4dDtcclxuICAgICAgYnJvd3Nlci5zdG9yYWdlLnN5bmMuc2V0KHsgcHJlZmVycmVkTW9kZTogbmV4dCB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGxpbmVzID0gbmV4dCA9PT0gJ3JvbWFuaXplZCcgPyBwcm9jZXNzZWQucm9tYW5pemVkIDogcHJvY2Vzc2VkLnRyYW5zbGF0ZWQ7XHJcbiAgICAgIGFwcGx5TGluZXNUb0RPTShsaW5lcywgZHVhbEx5cmljc0VuYWJsZWQgPyBjYWNoZS5vcmlnaW5hbCA6IHVuZGVmaW5lZCk7XHJcbiAgICB9XHJcblxyXG4gICAgc3luY0J1dHRvblN0YXRlcygpO1xyXG4gIH0gY2F0Y2ggKGVycikge1xyXG4gICAgY29uc29sZS5lcnJvcignW1NseUx5cmljc10gTW9kZSBzd2l0Y2ggZmFpbGVkOicsIGVycik7XHJcbiAgICAvLyBTaG93IGEgdXNlci12aXNpYmxlIHRvYXN0IGZvciAzIHNlY29uZHMsIHRoZW4gYXV0by1kaXNtaXNzXHJcbiAgICBzaG93VG9hc3QoJ1RyYW5zbGF0aW9uIGZhaWxlZC4gUGxlYXNlIHRyeSBhZ2Fpbi4nLCAzMDAwKTtcclxuICAgIC8vIFNuYXAgYmFjayB0byB3aGljaGV2ZXIgbW9kZSB3YXMgd29ya2luZyBiZWZvcmVcclxuICAgIG1vZGUgPSBtb2RlID09PSBuZXh0ID8gJ29yaWdpbmFsJyA6IG1vZGU7XHJcbiAgICBzeW5jQnV0dG9uU3RhdGVzKCk7XHJcbiAgfSBmaW5hbGx5IHtcclxuICAgIGhpZGVUb2FzdCh0cnVlKTtcclxuICAgIHNldExvYWRpbmdTdGF0ZShmYWxzZSk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyDilIDilIDilIAgUmVhcHBseSAmIEF1dG8tU3dpdGNoIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcmVhcHBseU1vZGUoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgaWYgKG1vZGUgPT09ICdvcmlnaW5hbCcpIHJldHVybjtcclxuXHJcbiAgY29uc3QgcHJvY2Vzc2VkID0gY2FjaGUucHJvY2Vzc2VkLmdldChjdXJyZW50QWN0aXZlTGFuZyk7XHJcbiAgaWYgKCFwcm9jZXNzZWQpIHJldHVybjtcclxuXHJcbiAgY29uc3QgbGluZXMgPSBtb2RlID09PSAncm9tYW5pemVkJyA/IHByb2Nlc3NlZC5yb21hbml6ZWQgOiBwcm9jZXNzZWQudHJhbnNsYXRlZDtcclxuICBhcHBseUxpbmVzVG9ET00obGluZXMsIGR1YWxMeXJpY3NFbmFibGVkID8gY2FjaGUub3JpZ2luYWwgOiB1bmRlZmluZWQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBhdXRvU3dpdGNoSWZOZWVkZWQoKTogdm9pZCB7XHJcbiAgaWYgKG1vZGUgPT09ICdvcmlnaW5hbCcgJiYgcHJlZmVycmVkTW9kZSAhPT0gJ29yaWdpbmFsJykge1xyXG4gICAgc3dpdGNoTW9kZShwcmVmZXJyZWRNb2RlKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIOKUgOKUgOKUgCBTZXR1cCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHRyeVNldHVwKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGlmICghaGFzTHlyaWNzKCkpIHJldHVybjtcclxuICBjb25zdCBjb250YWluZXIgPSBnZXRMeXJpY3NDb250YWluZXIoKTtcclxuICBpZiAoIWNvbnRhaW5lcikgcmV0dXJuO1xyXG4gIGlmIChjYWNoZS5vcmlnaW5hbC5sZW5ndGggPT09IDApIHNuYXBzaG90T3JpZ2luYWxzKCk7XHJcbiAgaW5qZWN0Q29udHJvbHMoY29udGFpbmVyKTtcclxuICBzdGFydEx5cmljc09ic2VydmVyKCk7XHJcbiAgYXdhaXQgcmVhcHBseU1vZGUoKTtcclxuICBhdXRvU3dpdGNoSWZOZWVkZWQoKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZGVib3VuY2VkU2V0dXAoKTogdm9pZCB7XHJcbiAgaWYgKHNldHVwRGVib3VuY2VUaW1lcikgY2FuY2VsQW5pbWF0aW9uRnJhbWUoc2V0dXBEZWJvdW5jZVRpbWVyKTtcclxuICBzZXR1cERlYm91bmNlVGltZXIgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4gdHJ5U2V0dXAoKSk7XHJcbn1cclxuXHJcbi8vIOKUgOKUgOKUgCBTb25nIENoYW5nZSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcclxuXHJcbmZ1bmN0aW9uIHBvbGxGb3JMeXJpY3NDb250YWluZXIoYXR0ZW1wdHMgPSAwKTogdm9pZCB7XHJcbiAgaWYgKGF0dGVtcHRzID4gMTIwKSByZXR1cm47XHJcbiAgaWYgKGhhc0x5cmljcygpICYmIGdldEx5cmljc0NvbnRhaW5lcigpKSB7XHJcbiAgICB0cnlTZXR1cCgpO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBwb2xsSWQgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4gcG9sbEZvckx5cmljc0NvbnRhaW5lcihhdHRlbXB0cyArIDEpKTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG9uU29uZ0NoYW5nZShuZXdLZXk6IHN0cmluZyk6IHZvaWQge1xyXG4gIGlmIChuZXdLZXkgPT09IHNvbmdLZXkpIHJldHVybjtcclxuICBzb25nS2V5ID0gbmV3S2V5O1xyXG4gIG1vZGUgPSAnb3JpZ2luYWwnO1xyXG4gIHByb2Nlc3NHZW4rKztcclxuICBseXJpY3NPYnNlcnZlcj8uZGlzY29ubmVjdCgpO1xyXG4gIGx5cmljc09ic2VydmVyID0gbnVsbDtcclxuICBjYWNoZSA9IHsgb3JpZ2luYWw6IFtdLCBwcm9jZXNzZWQ6IG5ldyBNYXAoKSB9O1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKENPTlRST0xTX0lEKT8ucmVtb3ZlKCk7XHJcblxyXG4gIGlmIChwb2xsSWQpIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHBvbGxJZCk7XHJcbiAgcG9sbEZvckx5cmljc0NvbnRhaW5lcigpO1xyXG59XHJcblxyXG4vLyDilIDilIDilIAgU3RvcmFnZSBMaXN0ZW5lciDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcclxuXHJcbmZ1bmN0aW9uIHN0YXJ0U3RvcmFnZUxpc3RlbmVyKCk6IHZvaWQge1xyXG4gIGJyb3dzZXIuc3RvcmFnZS5vbkNoYW5nZWQuYWRkTGlzdGVuZXIoKGNoYW5nZXMsIGFyZWEpID0+IHtcclxuICAgIGlmIChhcmVhICE9PSAnc3luYycpIHJldHVybjtcclxuXHJcbiAgICBpZiAoJ3RhcmdldExhbmcnIGluIGNoYW5nZXMgJiYgbW9kZSA9PT0gJ3RyYW5zbGF0ZWQnKSB7XHJcbiAgICAgIGNvbnN0IG5ld0xhbmcgPSAoY2hhbmdlcy50YXJnZXRMYW5nLm5ld1ZhbHVlIGFzIHN0cmluZyB8IHVuZGVmaW5lZCkgPz8gJ2VuJztcclxuICAgICAgc3dpdGNoTW9kZSgndHJhbnNsYXRlZCcsIG5ld0xhbmcpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICgnZHVhbEx5cmljcycgaW4gY2hhbmdlcykge1xyXG4gICAgICBkdWFsTHlyaWNzRW5hYmxlZCA9IChjaGFuZ2VzLmR1YWxMeXJpY3MubmV3VmFsdWUgYXMgYm9vbGVhbiB8IHVuZGVmaW5lZCkgPz8gdHJ1ZTtcclxuICAgICAgaWYgKG1vZGUgIT09ICdvcmlnaW5hbCcgJiYgY2FjaGUub3JpZ2luYWwubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnN0IHByb2Nlc3NlZCA9IGNhY2hlLnByb2Nlc3NlZC5nZXQoY3VycmVudEFjdGl2ZUxhbmcpO1xyXG4gICAgICAgIGlmIChwcm9jZXNzZWQpIHtcclxuICAgICAgICAgIGNvbnN0IGxpbmVzID0gbW9kZSA9PT0gJ3JvbWFuaXplZCcgPyBwcm9jZXNzZWQucm9tYW5pemVkIDogcHJvY2Vzc2VkLnRyYW5zbGF0ZWQ7XHJcbiAgICAgICAgICBhcHBseUxpbmVzVG9ET00obGluZXMsIGR1YWxMeXJpY3NFbmFibGVkID8gY2FjaGUub3JpZ2luYWwgOiB1bmRlZmluZWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIEhhbmRsZXMgcmVzZXQg4oCUIHNuYXBzIG1vZGUgYmFjayB0byBPcmlnaW5hbCBpbW1lZGlhdGVseVxyXG4gICAgLy8gaWYgdGhlIHBhbmVsIGlzIG9wZW4gd2hlbiB0aGUgdXNlciByZXNldHMgc2V0dGluZ3NcclxuICAgIGlmICgncHJlZmVycmVkTW9kZScgaW4gY2hhbmdlcykge1xyXG4gICAgICBjb25zdCBuZXdQcmVmID0gKGNoYW5nZXMucHJlZmVycmVkTW9kZS5uZXdWYWx1ZSBhcyBMeXJpY3NNb2RlIHwgdW5kZWZpbmVkKSA/PyAnb3JpZ2luYWwnO1xyXG4gICAgICBwcmVmZXJyZWRNb2RlID0gbmV3UHJlZjtcclxuICAgICAgaWYgKG5ld1ByZWYgPT09ICdvcmlnaW5hbCcgJiYgbW9kZSAhPT0gJ29yaWdpbmFsJykge1xyXG4gICAgICAgIHN3aXRjaE1vZGUoJ29yaWdpbmFsJyk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9KTtcclxufVxyXG5cclxuLy8g4pSA4pSA4pSAIEdsb2JhbCBNdXRhdGlvbk9ic2VydmVyIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxyXG5cclxuZnVuY3Rpb24gc3RhcnRPYnNlcnZlcigpOiB2b2lkIHtcclxuICBpZiAoZG9tT2JzZXJ2ZXIpIHJldHVybjtcclxuXHJcbiAgZG9tT2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcigobXV0YXRpb25zKSA9PiB7XHJcbiAgICBmb3IgKGNvbnN0IG11dCBvZiBtdXRhdGlvbnMpIHtcclxuICAgICAgaWYgKFxyXG4gICAgICAgIG11dC50eXBlID09PSAnYXR0cmlidXRlcycgJiZcclxuICAgICAgICBtdXQuYXR0cmlidXRlTmFtZSA9PT0gJ2FyaWEtbGFiZWwnICYmXHJcbiAgICAgICAgKG11dC50YXJnZXQgYXMgRWxlbWVudCkuY2xvc2VzdCgnW2RhdGEtdGVzdGlkPVwibm93LXBsYXlpbmctd2lkZ2V0XCJdJylcclxuICAgICAgKSB7XHJcbiAgICAgICAgb25Tb25nQ2hhbmdlKGdldE5vd1BsYXlpbmdLZXkoKSk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChtdXQudHlwZSAhPT0gJ2NoaWxkTGlzdCcpIGNvbnRpbnVlO1xyXG5cclxuICAgICAgZm9yIChjb25zdCBub2RlIG9mIG11dC5hZGRlZE5vZGVzKSB7XHJcbiAgICAgICAgaWYgKCEobm9kZSBpbnN0YW5jZW9mIEVsZW1lbnQpKSBjb250aW51ZTtcclxuICAgICAgICBpZiAoXHJcbiAgICAgICAgICBub2RlLm1hdGNoZXMoJ1tkYXRhLXRlc3RpZD1cImx5cmljcy1saW5lXCJdJykgfHxcclxuICAgICAgICAgIG5vZGUucXVlcnlTZWxlY3RvcignW2RhdGEtdGVzdGlkPVwibHlyaWNzLWxpbmVcIl0nKVxyXG4gICAgICAgICkge1xyXG4gICAgICAgICAgZGVib3VuY2VkU2V0dXAoKTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgZm9yIChjb25zdCBub2RlIG9mIG11dC5yZW1vdmVkTm9kZXMpIHtcclxuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIEVsZW1lbnQgJiYgbm9kZS5pZCA9PT0gQ09OVFJPTFNfSUQpIHtcclxuICAgICAgICAgIGRlYm91bmNlZFNldHVwKCk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgZG9tT2JzZXJ2ZXIub2JzZXJ2ZShkb2N1bWVudC5ib2R5LCB7XHJcbiAgICBjaGlsZExpc3Q6IHRydWUsXHJcbiAgICBzdWJ0cmVlOiB0cnVlLFxyXG4gICAgYXR0cmlidXRlczogdHJ1ZSxcclxuICAgIGF0dHJpYnV0ZUZpbHRlcjogWydhcmlhLWxhYmVsJ10sXHJcbiAgfSk7XHJcbn1cclxuXHJcbi8vIOKUgOKUgOKUgCBCb290IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxyXG5cclxuYXN5bmMgZnVuY3Rpb24gbWFpbigpOiBQcm9taXNlPHZvaWQ+IHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgcHJlZnMgPSBhd2FpdCBicm93c2VyLnN0b3JhZ2Uuc3luYy5nZXQoWydkdWFsTHlyaWNzJywgJ3RhcmdldExhbmcnLCAncHJlZmVycmVkTW9kZSddKTtcclxuICAgIGR1YWxMeXJpY3NFbmFibGVkID0gcHJlZnMuZHVhbEx5cmljcyAhPT0gdW5kZWZpbmVkXHJcbiAgICAgID8gKHByZWZzLmR1YWxMeXJpY3MgYXMgYm9vbGVhbilcclxuICAgICAgOiB0cnVlO1xyXG4gICAgY3VycmVudEFjdGl2ZUxhbmcgPSAocHJlZnMudGFyZ2V0TGFuZyBhcyBzdHJpbmcpID8/ICdlbic7XHJcbiAgICBwcmVmZXJyZWRNb2RlID0gKHByZWZzLnByZWZlcnJlZE1vZGUgYXMgTHlyaWNzTW9kZSkgPz8gJ29yaWdpbmFsJztcclxuICB9IGNhdGNoIHtcclxuICAgIGNvbnNvbGUud2FybignW1NseUx5cmljc10gc3RvcmFnZS5zeW5jIHVuYXZhaWxhYmxlLCB1c2luZyBkZWZhdWx0cycpO1xyXG4gICAgZHVhbEx5cmljc0VuYWJsZWQgPSB0cnVlO1xyXG4gICAgY3VycmVudEFjdGl2ZUxhbmcgPSAnZW4nO1xyXG4gICAgcHJlZmVycmVkTW9kZSA9ICdvcmlnaW5hbCc7XHJcbiAgfVxyXG5cclxuICBzdGFydE9ic2VydmVyKCk7XHJcbiAgc3RhcnRTdG9yYWdlTGlzdGVuZXIoKTtcclxuICB0cnlTZXR1cCgpO1xyXG59XHJcbiIsIi8vI3JlZ2lvbiBzcmMvdXRpbHMvaW50ZXJuYWwvbG9nZ2VyLnRzXG5mdW5jdGlvbiBwcmludChtZXRob2QsIC4uLmFyZ3MpIHtcblx0aWYgKGltcG9ydC5tZXRhLmVudi5NT0RFID09PSBcInByb2R1Y3Rpb25cIikgcmV0dXJuO1xuXHRpZiAodHlwZW9mIGFyZ3NbMF0gPT09IFwic3RyaW5nXCIpIG1ldGhvZChgW3d4dF0gJHthcmdzLnNoaWZ0KCl9YCwgLi4uYXJncyk7XG5cdGVsc2UgbWV0aG9kKFwiW3d4dF1cIiwgLi4uYXJncyk7XG59XG4vKipcbiogV3JhcHBlciBhcm91bmQgYGNvbnNvbGVgIHdpdGggYSBcIlt3eHRdXCIgcHJlZml4XG4qL1xuY29uc3QgbG9nZ2VyID0ge1xuXHRkZWJ1ZzogKC4uLmFyZ3MpID0+IHByaW50KGNvbnNvbGUuZGVidWcsIC4uLmFyZ3MpLFxuXHRsb2c6ICguLi5hcmdzKSA9PiBwcmludChjb25zb2xlLmxvZywgLi4uYXJncyksXG5cdHdhcm46ICguLi5hcmdzKSA9PiBwcmludChjb25zb2xlLndhcm4sIC4uLmFyZ3MpLFxuXHRlcnJvcjogKC4uLmFyZ3MpID0+IHByaW50KGNvbnNvbGUuZXJyb3IsIC4uLmFyZ3MpXG59O1xuXG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGxvZ2dlciB9OyIsImltcG9ydCB7IGJyb3dzZXIgfSBmcm9tIFwid3h0L2Jyb3dzZXJcIjtcblxuLy8jcmVnaW9uIHNyYy91dGlscy9pbnRlcm5hbC9jdXN0b20tZXZlbnRzLnRzXG52YXIgV3h0TG9jYXRpb25DaGFuZ2VFdmVudCA9IGNsYXNzIFd4dExvY2F0aW9uQ2hhbmdlRXZlbnQgZXh0ZW5kcyBFdmVudCB7XG5cdHN0YXRpYyBFVkVOVF9OQU1FID0gZ2V0VW5pcXVlRXZlbnROYW1lKFwid3h0OmxvY2F0aW9uY2hhbmdlXCIpO1xuXHRjb25zdHJ1Y3RvcihuZXdVcmwsIG9sZFVybCkge1xuXHRcdHN1cGVyKFd4dExvY2F0aW9uQ2hhbmdlRXZlbnQuRVZFTlRfTkFNRSwge30pO1xuXHRcdHRoaXMubmV3VXJsID0gbmV3VXJsO1xuXHRcdHRoaXMub2xkVXJsID0gb2xkVXJsO1xuXHR9XG59O1xuLyoqXG4qIFJldHVybnMgYW4gZXZlbnQgbmFtZSB1bmlxdWUgdG8gdGhlIGV4dGVuc2lvbiBhbmQgY29udGVudCBzY3JpcHQgdGhhdCdzIHJ1bm5pbmcuXG4qL1xuZnVuY3Rpb24gZ2V0VW5pcXVlRXZlbnROYW1lKGV2ZW50TmFtZSkge1xuXHRyZXR1cm4gYCR7YnJvd3Nlcj8ucnVudGltZT8uaWR9OiR7aW1wb3J0Lm1ldGEuZW52LkVOVFJZUE9JTlR9OiR7ZXZlbnROYW1lfWA7XG59XG5cbi8vI2VuZHJlZ2lvblxuZXhwb3J0IHsgV3h0TG9jYXRpb25DaGFuZ2VFdmVudCwgZ2V0VW5pcXVlRXZlbnROYW1lIH07IiwiaW1wb3J0IHsgV3h0TG9jYXRpb25DaGFuZ2VFdmVudCB9IGZyb20gXCIuL2N1c3RvbS1ldmVudHMubWpzXCI7XG5cbi8vI3JlZ2lvbiBzcmMvdXRpbHMvaW50ZXJuYWwvbG9jYXRpb24td2F0Y2hlci50c1xuLyoqXG4qIENyZWF0ZSBhIHV0aWwgdGhhdCB3YXRjaGVzIGZvciBVUkwgY2hhbmdlcywgZGlzcGF0Y2hpbmcgdGhlIGN1c3RvbSBldmVudCB3aGVuIGRldGVjdGVkLiBTdG9wc1xuKiB3YXRjaGluZyB3aGVuIGNvbnRlbnQgc2NyaXB0IGlzIGludmFsaWRhdGVkLlxuKi9cbmZ1bmN0aW9uIGNyZWF0ZUxvY2F0aW9uV2F0Y2hlcihjdHgpIHtcblx0bGV0IGludGVydmFsO1xuXHRsZXQgb2xkVXJsO1xuXHRyZXR1cm4geyBydW4oKSB7XG5cdFx0aWYgKGludGVydmFsICE9IG51bGwpIHJldHVybjtcblx0XHRvbGRVcmwgPSBuZXcgVVJMKGxvY2F0aW9uLmhyZWYpO1xuXHRcdGludGVydmFsID0gY3R4LnNldEludGVydmFsKCgpID0+IHtcblx0XHRcdGxldCBuZXdVcmwgPSBuZXcgVVJMKGxvY2F0aW9uLmhyZWYpO1xuXHRcdFx0aWYgKG5ld1VybC5ocmVmICE9PSBvbGRVcmwuaHJlZikge1xuXHRcdFx0XHR3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgV3h0TG9jYXRpb25DaGFuZ2VFdmVudChuZXdVcmwsIG9sZFVybCkpO1xuXHRcdFx0XHRvbGRVcmwgPSBuZXdVcmw7XG5cdFx0XHR9XG5cdFx0fSwgMWUzKTtcblx0fSB9O1xufVxuXG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGNyZWF0ZUxvY2F0aW9uV2F0Y2hlciB9OyIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gXCIuL2ludGVybmFsL2xvZ2dlci5tanNcIjtcbmltcG9ydCB7IGdldFVuaXF1ZUV2ZW50TmFtZSB9IGZyb20gXCIuL2ludGVybmFsL2N1c3RvbS1ldmVudHMubWpzXCI7XG5pbXBvcnQgeyBjcmVhdGVMb2NhdGlvbldhdGNoZXIgfSBmcm9tIFwiLi9pbnRlcm5hbC9sb2NhdGlvbi13YXRjaGVyLm1qc1wiO1xuaW1wb3J0IHsgYnJvd3NlciB9IGZyb20gXCJ3eHQvYnJvd3NlclwiO1xuXG4vLyNyZWdpb24gc3JjL3V0aWxzL2NvbnRlbnQtc2NyaXB0LWNvbnRleHQudHNcbi8qKlxuKiBJbXBsZW1lbnRzIFtgQWJvcnRDb250cm9sbGVyYF0oaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL0Fib3J0Q29udHJvbGxlcikuXG4qIFVzZWQgdG8gZGV0ZWN0IGFuZCBzdG9wIGNvbnRlbnQgc2NyaXB0IGNvZGUgd2hlbiB0aGUgc2NyaXB0IGlzIGludmFsaWRhdGVkLlxuKlxuKiBJdCBhbHNvIHByb3ZpZGVzIHNldmVyYWwgdXRpbGl0aWVzIGxpa2UgYGN0eC5zZXRUaW1lb3V0YCBhbmQgYGN0eC5zZXRJbnRlcnZhbGAgdGhhdCBzaG91bGQgYmUgdXNlZCBpblxuKiBjb250ZW50IHNjcmlwdHMgaW5zdGVhZCBvZiBgd2luZG93LnNldFRpbWVvdXRgIG9yIGB3aW5kb3cuc2V0SW50ZXJ2YWxgLlxuKlxuKiBUbyBjcmVhdGUgY29udGV4dCBmb3IgdGVzdGluZywgeW91IGNhbiB1c2UgdGhlIGNsYXNzJ3MgY29uc3RydWN0b3I6XG4qXG4qIGBgYHRzXG4qIGltcG9ydCB7IENvbnRlbnRTY3JpcHRDb250ZXh0IH0gZnJvbSAnd3h0L3V0aWxzL2NvbnRlbnQtc2NyaXB0cy1jb250ZXh0JztcbipcbiogdGVzdChcInN0b3JhZ2UgbGlzdGVuZXIgc2hvdWxkIGJlIHJlbW92ZWQgd2hlbiBjb250ZXh0IGlzIGludmFsaWRhdGVkXCIsICgpID0+IHtcbiogICBjb25zdCBjdHggPSBuZXcgQ29udGVudFNjcmlwdENvbnRleHQoJ3Rlc3QnKTtcbiogICBjb25zdCBpdGVtID0gc3RvcmFnZS5kZWZpbmVJdGVtKFwibG9jYWw6Y291bnRcIiwgeyBkZWZhdWx0VmFsdWU6IDAgfSk7XG4qICAgY29uc3Qgd2F0Y2hlciA9IHZpLmZuKCk7XG4qXG4qICAgY29uc3QgdW53YXRjaCA9IGl0ZW0ud2F0Y2god2F0Y2hlcik7XG4qICAgY3R4Lm9uSW52YWxpZGF0ZWQodW53YXRjaCk7IC8vIExpc3RlbiBmb3IgaW52YWxpZGF0ZSBoZXJlXG4qXG4qICAgYXdhaXQgaXRlbS5zZXRWYWx1ZSgxKTtcbiogICBleHBlY3Qod2F0Y2hlcikudG9CZUNhbGxlZFRpbWVzKDEpO1xuKiAgIGV4cGVjdCh3YXRjaGVyKS50b0JlQ2FsbGVkV2l0aCgxLCAwKTtcbipcbiogICBjdHgubm90aWZ5SW52YWxpZGF0ZWQoKTsgLy8gVXNlIHRoaXMgZnVuY3Rpb24gdG8gaW52YWxpZGF0ZSB0aGUgY29udGV4dFxuKiAgIGF3YWl0IGl0ZW0uc2V0VmFsdWUoMik7XG4qICAgZXhwZWN0KHdhdGNoZXIpLnRvQmVDYWxsZWRUaW1lcygxKTtcbiogfSk7XG4qIGBgYFxuKi9cbnZhciBDb250ZW50U2NyaXB0Q29udGV4dCA9IGNsYXNzIENvbnRlbnRTY3JpcHRDb250ZXh0IHtcblx0c3RhdGljIFNDUklQVF9TVEFSVEVEX01FU1NBR0VfVFlQRSA9IGdldFVuaXF1ZUV2ZW50TmFtZShcInd4dDpjb250ZW50LXNjcmlwdC1zdGFydGVkXCIpO1xuXHRpZDtcblx0YWJvcnRDb250cm9sbGVyO1xuXHRsb2NhdGlvbldhdGNoZXIgPSBjcmVhdGVMb2NhdGlvbldhdGNoZXIodGhpcyk7XG5cdGNvbnN0cnVjdG9yKGNvbnRlbnRTY3JpcHROYW1lLCBvcHRpb25zKSB7XG5cdFx0dGhpcy5jb250ZW50U2NyaXB0TmFtZSA9IGNvbnRlbnRTY3JpcHROYW1lO1xuXHRcdHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG5cdFx0dGhpcy5pZCA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIpO1xuXHRcdHRoaXMuYWJvcnRDb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuXHRcdHRoaXMuc3RvcE9sZFNjcmlwdHMoKTtcblx0XHR0aGlzLmxpc3RlbkZvck5ld2VyU2NyaXB0cygpO1xuXHR9XG5cdGdldCBzaWduYWwoKSB7XG5cdFx0cmV0dXJuIHRoaXMuYWJvcnRDb250cm9sbGVyLnNpZ25hbDtcblx0fVxuXHRhYm9ydChyZWFzb24pIHtcblx0XHRyZXR1cm4gdGhpcy5hYm9ydENvbnRyb2xsZXIuYWJvcnQocmVhc29uKTtcblx0fVxuXHRnZXQgaXNJbnZhbGlkKCkge1xuXHRcdGlmIChicm93c2VyLnJ1bnRpbWU/LmlkID09IG51bGwpIHRoaXMubm90aWZ5SW52YWxpZGF0ZWQoKTtcblx0XHRyZXR1cm4gdGhpcy5zaWduYWwuYWJvcnRlZDtcblx0fVxuXHRnZXQgaXNWYWxpZCgpIHtcblx0XHRyZXR1cm4gIXRoaXMuaXNJbnZhbGlkO1xuXHR9XG5cdC8qKlxuXHQqIEFkZCBhIGxpc3RlbmVyIHRoYXQgaXMgY2FsbGVkIHdoZW4gdGhlIGNvbnRlbnQgc2NyaXB0J3MgY29udGV4dCBpcyBpbnZhbGlkYXRlZC5cblx0KlxuXHQqIEByZXR1cm5zIEEgZnVuY3Rpb24gdG8gcmVtb3ZlIHRoZSBsaXN0ZW5lci5cblx0KlxuXHQqIEBleGFtcGxlXG5cdCogYnJvd3Nlci5ydW50aW1lLm9uTWVzc2FnZS5hZGRMaXN0ZW5lcihjYik7XG5cdCogY29uc3QgcmVtb3ZlSW52YWxpZGF0ZWRMaXN0ZW5lciA9IGN0eC5vbkludmFsaWRhdGVkKCgpID0+IHtcblx0KiAgIGJyb3dzZXIucnVudGltZS5vbk1lc3NhZ2UucmVtb3ZlTGlzdGVuZXIoY2IpO1xuXHQqIH0pXG5cdCogLy8gLi4uXG5cdCogcmVtb3ZlSW52YWxpZGF0ZWRMaXN0ZW5lcigpO1xuXHQqL1xuXHRvbkludmFsaWRhdGVkKGNiKSB7XG5cdFx0dGhpcy5zaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNiKTtcblx0XHRyZXR1cm4gKCkgPT4gdGhpcy5zaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNiKTtcblx0fVxuXHQvKipcblx0KiBSZXR1cm4gYSBwcm9taXNlIHRoYXQgbmV2ZXIgcmVzb2x2ZXMuIFVzZWZ1bCBpZiB5b3UgaGF2ZSBhbiBhc3luYyBmdW5jdGlvbiB0aGF0IHNob3VsZG4ndCBydW5cblx0KiBhZnRlciB0aGUgY29udGV4dCBpcyBleHBpcmVkLlxuXHQqXG5cdCogQGV4YW1wbGVcblx0KiBjb25zdCBnZXRWYWx1ZUZyb21TdG9yYWdlID0gYXN5bmMgKCkgPT4ge1xuXHQqICAgaWYgKGN0eC5pc0ludmFsaWQpIHJldHVybiBjdHguYmxvY2soKTtcblx0KlxuXHQqICAgLy8gLi4uXG5cdCogfVxuXHQqL1xuXHRibG9jaygpIHtcblx0XHRyZXR1cm4gbmV3IFByb21pc2UoKCkgPT4ge30pO1xuXHR9XG5cdC8qKlxuXHQqIFdyYXBwZXIgYXJvdW5kIGB3aW5kb3cuc2V0SW50ZXJ2YWxgIHRoYXQgYXV0b21hdGljYWxseSBjbGVhcnMgdGhlIGludGVydmFsIHdoZW4gaW52YWxpZGF0ZWQuXG5cdCpcblx0KiBJbnRlcnZhbHMgY2FuIGJlIGNsZWFyZWQgYnkgY2FsbGluZyB0aGUgbm9ybWFsIGBjbGVhckludGVydmFsYCBmdW5jdGlvbi5cblx0Ki9cblx0c2V0SW50ZXJ2YWwoaGFuZGxlciwgdGltZW91dCkge1xuXHRcdGNvbnN0IGlkID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuXHRcdFx0aWYgKHRoaXMuaXNWYWxpZCkgaGFuZGxlcigpO1xuXHRcdH0sIHRpbWVvdXQpO1xuXHRcdHRoaXMub25JbnZhbGlkYXRlZCgoKSA9PiBjbGVhckludGVydmFsKGlkKSk7XG5cdFx0cmV0dXJuIGlkO1xuXHR9XG5cdC8qKlxuXHQqIFdyYXBwZXIgYXJvdW5kIGB3aW5kb3cuc2V0VGltZW91dGAgdGhhdCBhdXRvbWF0aWNhbGx5IGNsZWFycyB0aGUgaW50ZXJ2YWwgd2hlbiBpbnZhbGlkYXRlZC5cblx0KlxuXHQqIFRpbWVvdXRzIGNhbiBiZSBjbGVhcmVkIGJ5IGNhbGxpbmcgdGhlIG5vcm1hbCBgc2V0VGltZW91dGAgZnVuY3Rpb24uXG5cdCovXG5cdHNldFRpbWVvdXQoaGFuZGxlciwgdGltZW91dCkge1xuXHRcdGNvbnN0IGlkID0gc2V0VGltZW91dCgoKSA9PiB7XG5cdFx0XHRpZiAodGhpcy5pc1ZhbGlkKSBoYW5kbGVyKCk7XG5cdFx0fSwgdGltZW91dCk7XG5cdFx0dGhpcy5vbkludmFsaWRhdGVkKCgpID0+IGNsZWFyVGltZW91dChpZCkpO1xuXHRcdHJldHVybiBpZDtcblx0fVxuXHQvKipcblx0KiBXcmFwcGVyIGFyb3VuZCBgd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZWAgdGhhdCBhdXRvbWF0aWNhbGx5IGNhbmNlbHMgdGhlIHJlcXVlc3Qgd2hlblxuXHQqIGludmFsaWRhdGVkLlxuXHQqXG5cdCogQ2FsbGJhY2tzIGNhbiBiZSBjYW5jZWxlZCBieSBjYWxsaW5nIHRoZSBub3JtYWwgYGNhbmNlbEFuaW1hdGlvbkZyYW1lYCBmdW5jdGlvbi5cblx0Ki9cblx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKGNhbGxiYWNrKSB7XG5cdFx0Y29uc3QgaWQgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKC4uLmFyZ3MpID0+IHtcblx0XHRcdGlmICh0aGlzLmlzVmFsaWQpIGNhbGxiYWNrKC4uLmFyZ3MpO1xuXHRcdH0pO1xuXHRcdHRoaXMub25JbnZhbGlkYXRlZCgoKSA9PiBjYW5jZWxBbmltYXRpb25GcmFtZShpZCkpO1xuXHRcdHJldHVybiBpZDtcblx0fVxuXHQvKipcblx0KiBXcmFwcGVyIGFyb3VuZCBgd2luZG93LnJlcXVlc3RJZGxlQ2FsbGJhY2tgIHRoYXQgYXV0b21hdGljYWxseSBjYW5jZWxzIHRoZSByZXF1ZXN0IHdoZW5cblx0KiBpbnZhbGlkYXRlZC5cblx0KlxuXHQqIENhbGxiYWNrcyBjYW4gYmUgY2FuY2VsZWQgYnkgY2FsbGluZyB0aGUgbm9ybWFsIGBjYW5jZWxJZGxlQ2FsbGJhY2tgIGZ1bmN0aW9uLlxuXHQqL1xuXHRyZXF1ZXN0SWRsZUNhbGxiYWNrKGNhbGxiYWNrLCBvcHRpb25zKSB7XG5cdFx0Y29uc3QgaWQgPSByZXF1ZXN0SWRsZUNhbGxiYWNrKCguLi5hcmdzKSA9PiB7XG5cdFx0XHRpZiAoIXRoaXMuc2lnbmFsLmFib3J0ZWQpIGNhbGxiYWNrKC4uLmFyZ3MpO1xuXHRcdH0sIG9wdGlvbnMpO1xuXHRcdHRoaXMub25JbnZhbGlkYXRlZCgoKSA9PiBjYW5jZWxJZGxlQ2FsbGJhY2soaWQpKTtcblx0XHRyZXR1cm4gaWQ7XG5cdH1cblx0YWRkRXZlbnRMaXN0ZW5lcih0YXJnZXQsIHR5cGUsIGhhbmRsZXIsIG9wdGlvbnMpIHtcblx0XHRpZiAodHlwZSA9PT0gXCJ3eHQ6bG9jYXRpb25jaGFuZ2VcIikge1xuXHRcdFx0aWYgKHRoaXMuaXNWYWxpZCkgdGhpcy5sb2NhdGlvbldhdGNoZXIucnVuKCk7XG5cdFx0fVxuXHRcdHRhcmdldC5hZGRFdmVudExpc3RlbmVyPy4odHlwZS5zdGFydHNXaXRoKFwid3h0OlwiKSA/IGdldFVuaXF1ZUV2ZW50TmFtZSh0eXBlKSA6IHR5cGUsIGhhbmRsZXIsIHtcblx0XHRcdC4uLm9wdGlvbnMsXG5cdFx0XHRzaWduYWw6IHRoaXMuc2lnbmFsXG5cdFx0fSk7XG5cdH1cblx0LyoqXG5cdCogQGludGVybmFsXG5cdCogQWJvcnQgdGhlIGFib3J0IGNvbnRyb2xsZXIgYW5kIGV4ZWN1dGUgYWxsIGBvbkludmFsaWRhdGVkYCBsaXN0ZW5lcnMuXG5cdCovXG5cdG5vdGlmeUludmFsaWRhdGVkKCkge1xuXHRcdHRoaXMuYWJvcnQoXCJDb250ZW50IHNjcmlwdCBjb250ZXh0IGludmFsaWRhdGVkXCIpO1xuXHRcdGxvZ2dlci5kZWJ1ZyhgQ29udGVudCBzY3JpcHQgXCIke3RoaXMuY29udGVudFNjcmlwdE5hbWV9XCIgY29udGV4dCBpbnZhbGlkYXRlZGApO1xuXHR9XG5cdHN0b3BPbGRTY3JpcHRzKCkge1xuXHRcdGRvY3VtZW50LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KENvbnRlbnRTY3JpcHRDb250ZXh0LlNDUklQVF9TVEFSVEVEX01FU1NBR0VfVFlQRSwgeyBkZXRhaWw6IHtcblx0XHRcdGNvbnRlbnRTY3JpcHROYW1lOiB0aGlzLmNvbnRlbnRTY3JpcHROYW1lLFxuXHRcdFx0bWVzc2FnZUlkOiB0aGlzLmlkXG5cdFx0fSB9KSk7XG5cdFx0d2luZG93LnBvc3RNZXNzYWdlKHtcblx0XHRcdHR5cGU6IENvbnRlbnRTY3JpcHRDb250ZXh0LlNDUklQVF9TVEFSVEVEX01FU1NBR0VfVFlQRSxcblx0XHRcdGNvbnRlbnRTY3JpcHROYW1lOiB0aGlzLmNvbnRlbnRTY3JpcHROYW1lLFxuXHRcdFx0bWVzc2FnZUlkOiB0aGlzLmlkXG5cdFx0fSwgXCIqXCIpO1xuXHR9XG5cdHZlcmlmeVNjcmlwdFN0YXJ0ZWRFdmVudChldmVudCkge1xuXHRcdGNvbnN0IGlzU2FtZUNvbnRlbnRTY3JpcHQgPSBldmVudC5kZXRhaWw/LmNvbnRlbnRTY3JpcHROYW1lID09PSB0aGlzLmNvbnRlbnRTY3JpcHROYW1lO1xuXHRcdGNvbnN0IGlzRnJvbVNlbGYgPSBldmVudC5kZXRhaWw/Lm1lc3NhZ2VJZCA9PT0gdGhpcy5pZDtcblx0XHRyZXR1cm4gaXNTYW1lQ29udGVudFNjcmlwdCAmJiAhaXNGcm9tU2VsZjtcblx0fVxuXHRsaXN0ZW5Gb3JOZXdlclNjcmlwdHMoKSB7XG5cdFx0Y29uc3QgY2IgPSAoZXZlbnQpID0+IHtcblx0XHRcdGlmICghKGV2ZW50IGluc3RhbmNlb2YgQ3VzdG9tRXZlbnQpIHx8ICF0aGlzLnZlcmlmeVNjcmlwdFN0YXJ0ZWRFdmVudChldmVudCkpIHJldHVybjtcblx0XHRcdHRoaXMubm90aWZ5SW52YWxpZGF0ZWQoKTtcblx0XHR9O1xuXHRcdGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoQ29udGVudFNjcmlwdENvbnRleHQuU0NSSVBUX1NUQVJURURfTUVTU0FHRV9UWVBFLCBjYik7XG5cdFx0dGhpcy5vbkludmFsaWRhdGVkKCgpID0+IGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoQ29udGVudFNjcmlwdENvbnRleHQuU0NSSVBUX1NUQVJURURfTUVTU0FHRV9UWVBFLCBjYikpO1xuXHR9XG59O1xuXG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IENvbnRlbnRTY3JpcHRDb250ZXh0IH07Il0sIm5hbWVzIjpbImRlZmluaXRpb24iLCJicm93c2VyIiwidG9hc3QiLCJkb2N1bWVudCIsInRvYXN0VGltZXIiLCJjbGVhclRpbWVvdXQiLCJsaW5lcyIsImVsIiwiY2FjaGUiLCJ3cmFwIiwiYnRuIiwiY29udGFpbmVyIiwiZ2V0THlyaWNzQ29udGFpbmVyIiwiaXNBcHBseWluZyIsImdldEx5cmljc0xpbmVzIiwibWFpblNwYW4iLCJzdWJTcGFuIiwic2V0VGltZW91dCIsImx5cmljc09ic2VydmVyIiwiYXBwbHlMaW5lc1RvRE9NIiwicmVzdWx0IiwibGFuZyIsInNldExvYWRpbmdTdGF0ZSIsIm1vZGUiLCJwcmVmZXJyZWRNb2RlIiwibmV4dCIsImN1cnJlbnRBY3RpdmVMYW5nIiwic3luY0J1dHRvblN0YXRlcyIsImNvbnNvbGUiLCJzaG93VG9hc3QiLCJoaWRlVG9hc3QiLCJzd2l0Y2hNb2RlIiwiaW5qZWN0Q29udHJvbHMiLCJzdGFydEx5cmljc09ic2VydmVyIiwiYXV0b1N3aXRjaElmTmVlZGVkIiwic2V0dXBEZWJvdW5jZVRpbWVyIiwidHJ5U2V0dXAiLCJwb2xsSWQiLCJzb25nS2V5IiwicHJvY2Vzc0dlbiIsInBvbGxGb3JMeXJpY3NDb250YWluZXIiLCJkdWFsTHlyaWNzRW5hYmxlZCIsImRvbU9ic2VydmVyIiwib25Tb25nQ2hhbmdlIiwiZGVib3VuY2VkU2V0dXAiLCJzdGFydE9ic2VydmVyIiwic3RhcnRTdG9yYWdlTGlzdGVuZXIiLCJwcmludCIsImxvZ2dlciIsIld4dExvY2F0aW9uQ2hhbmdlRXZlbnQiLCJDb250ZW50U2NyaXB0Q29udGV4dCJdLCJtYXBwaW5ncyI6Ijs7QUFDQSxXQUFTLG9CQUFvQkEsYUFBWTtBQUN4QyxXQUFPQTtBQUFBLEVBQ1I7QUNGTyxRQUFNQyxZQUFVLFdBQVcsU0FBUyxTQUFTLEtBQ2hELFdBQVcsVUFDWCxXQUFXO0FDV2YsUUFBTSxVQUFVO0FDWmhCLFFBQUEsYUFBQSxvQkFBQTtBQUFBLElBQW1DLFNBQUEsQ0FBQSx3QkFBQTtBQUFBLElBQ0MsT0FBQTtBQUFBLElBQzNCO0FBQUEsRUFFVCxDQUFBO0FBb0JBLFFBQUEsY0FBQTtBQUNBLE1BQUEsT0FBQTtBQUNBLE1BQUEsZ0JBQUE7QUFDQSxNQUFBLG9CQUFBO0FBQ0EsTUFBQSxvQkFBQTtBQUNBLE1BQUEsVUFBQTtBQUNBLE1BQUEsUUFBQTtBQUFBLElBQXVCLFVBQUEsQ0FBQTtBQUFBLElBQVksV0FBQSxvQkFBQSxJQUFBO0FBQUEsRUFBeUI7QUFDNUQsTUFBQSxjQUFBO0FBQ0EsTUFBQSxpQkFBQTtBQUNBLE1BQUEsYUFBQTtBQUNBLE1BQUEscUJBQUE7QUFDQSxNQUFBLFNBQUE7QUFDQSxNQUFBLGFBQUE7QUFJQSxNQUFBLGFBQUE7QUFFQSxXQUFBLFVBQUEsU0FBQSxhQUFBLEdBQUE7QUFDRSxRQUFBLFFBQUEsU0FBQSxlQUFBLFdBQUE7QUFDQSxRQUFBLENBQUEsT0FBQTtBQUNFQyxjQUFBQSxTQUFBQSxjQUFBQSxLQUFBQTtBQUNBQSxZQUFBQSxLQUFBQTtBQUNBQSxZQUFBQSxZQUFBQTtBQUNBQyxlQUFBQSxLQUFBQSxZQUFBQSxLQUFBQTtBQUFBQSxJQUErQjtBQUdqQyxRQUFBLFdBQUEsY0FBQSxVQUFBO0FBQ0FELFVBQUFBLGNBQUFBO0FBQ0FBLFVBQUFBLFVBQUFBLElBQUFBLFNBQUFBO0FBR0EsUUFBQSxhQUFBLEdBQUE7QUFDRUUsbUJBQUFBLFdBQUFBLE1BQUFBLFVBQUFBLEdBQUFBLFVBQUFBO0FBQUFBLElBQXFEO0FBQUEsRUFFekQ7QUFFQSxXQUFBLFVBQUEsaUJBQUEsT0FBQTtBQUNFLFVBQUEsUUFBQSxTQUFBLGVBQUEsV0FBQTtBQUNBLFFBQUEsQ0FBQSxNQUFBO0FBRUEsUUFBQSxrQkFBQSxlQUFBLEtBQUE7QUFDQUYsVUFBQUEsVUFBQUEsT0FBQUEsU0FBQUE7QUFDQSxRQUFBLFlBQUE7QUFDRUcsbUJBQUFBLFVBQUFBO0FBQ0FELG1CQUFBQTtBQUFBQSxJQUFhO0FBQUEsRUFFakI7QUFFQSxRQUFBLGlCQUFBLE1BQUEsTUFBQSxLQUFBLFNBQUEsaUJBQUEsbUNBQUEsQ0FBQTtBQUdBLFFBQUEscUJBQUEsTUFBQSxTQUFBLGNBQUEsNkJBQUEsR0FBQSxpQkFBQTtBQUdBLFFBQUEsbUJBQUEsTUFBQSxTQUFBLGNBQUEsb0NBQUEsR0FBQSxhQUFBLFlBQUEsS0FBQTtBQUlBLFFBQUEsWUFBQSxNQUFBLFNBQUEsY0FBQSwrQ0FBQSxNQUFBO0FBS0EsV0FBQSxvQkFBQTtBQUNFLFVBQUEsUUFBQSxlQUFBO0FBRUFFLFVBQUFBLFFBQUFBLENBQUFBLE9BQUFBO0FBQ0UsVUFBQSxHQUFBLGFBQUEsbUJBQUEsRUFBQTtBQUVBLFlBQUEsVUFBQSxHQUFBLGNBQUEsZ0JBQUE7QUFDQSxVQUFBLFNBQUE7QUFDRUMsV0FBQUEsYUFBQUEscUJBQUFBLFFBQUFBLGVBQUFBLEVBQUFBO0FBQ0E7QUFBQSxNQUFBO0FBRUYsWUFBQSxXQUFBLEdBQUEsY0FBQSxnQkFBQTtBQUNBLFVBQUEsVUFBQTtBQUNFQSxXQUFBQSxhQUFBQSxxQkFBQUEsU0FBQUEsZUFBQUEsRUFBQUE7QUFDQTtBQUFBLE1BQUE7QUFFRkEsU0FBQUEsYUFBQUEscUJBQUFBLEdBQUFBLGVBQUFBLEVBQUFBO0FBQUFBLElBQXlELENBQUE7QUFHM0RDLFVBQUFBLFdBQUFBLE1BQUFBLElBQUFBLENBQUFBLE9BQUFBLEdBQUFBLGFBQUFBLG1CQUFBQSxLQUFBQSxFQUFBQTtBQUFBQSxFQUdGO0FBSUEsV0FBQSxlQUFBLFdBQUE7QUFDRSxRQUFBLFNBQUEsZUFBQSxXQUFBLEVBQUE7QUFFQSxVQUFBLE9BQUEsU0FBQSxjQUFBLEtBQUE7QUFDQUMsU0FBQUEsS0FBQUE7QUFDQUEsU0FBQUEsWUFBQUE7QUFFQSxVQUFBLGNBQUEsU0FBQSxjQUFBLGtCQUFBLGFBQUEsZ0JBQUE7QUFHQSxLQUFBLFlBQUEsYUFBQSxZQUFBLEVBQUEsUUFBQSxDQUFBLE1BQUE7QUFDRSxZQUFBLE1BQUEsU0FBQSxjQUFBLFFBQUE7QUFDQUMsVUFBQUEsWUFBQUEsaUJBQUFBLGdCQUFBQSxJQUFBQSxZQUFBQSxFQUFBQTtBQUNBQSxVQUFBQSxjQUFBQSxFQUFBQSxPQUFBQSxDQUFBQSxFQUFBQSxnQkFBQUEsRUFBQUEsTUFBQUEsQ0FBQUE7QUFDQUEsVUFBQUEsUUFBQUEsT0FBQUE7QUFDQUEsVUFBQUEsaUJBQUFBLFNBQUFBLE1BQUFBLFdBQUFBLENBQUFBLENBQUFBO0FBQ0FELFdBQUFBLFlBQUFBLEdBQUFBO0FBQUFBLElBQW9CLENBQUE7QUFHdEJFLGNBQUFBLGFBQUFBLE1BQUFBLFVBQUFBLFVBQUFBO0FBQUFBLEVBQ0Y7QUFFQSxXQUFBLG1CQUFBO0FBQ0VSLGFBQUFBLGVBQUFBLFdBQUFBLEdBQUFBLGlCQUFBQSxpQkFBQUEsRUFBQUEsUUFBQUEsQ0FBQUEsUUFBQUEsSUFBQUEsVUFBQUEsT0FBQUEsVUFBQUEsSUFBQUEsUUFBQUEsU0FBQUEsSUFBQUEsQ0FBQUE7QUFBQUEsRUFJRjtBQUVBLFdBQUEsZ0JBQUEsU0FBQTtBQUNFQSxhQUFBQSxlQUFBQSxXQUFBQSxHQUFBQSxpQkFBQUEsaUJBQUFBLEVBQUFBLFFBQUFBLENBQUFBLE1BQUFBLEVBQUFB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
spotifyLyrics;