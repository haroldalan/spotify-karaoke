// Centralized declarativeNetRequest header rules for background network requests.
//
// Browsers attach the extension's Origin/Referer to background fetch requests. YouTube Music
// refuses them, and its Android client (the one that serves timed lyrics) expects that app's
// User-Agent (the owner's decision, 2026-11-09). LRCLIB doesn't need them (it is told who we
// are by its Lrclib-Client header).
//
// Google Translate's requests are left as the browser sends them: while Google is refusing
// this network, making them look like another client would be getting around its block.
//
// All rules are strictly scoped to:
//   - Background requests (tabIds: [-1], never touching user tabs)
//   - Initiator: this extension's host only (Chrome extension id or Firefox moz-extension uuid)
//   - Resource types: xmlhttprequest and other

export const ANDROID_UA = 'com.google.android.apps.youtube.music/7.21.50 (Linux; U; Android 12; en_US; Pixel 6) gzip';
export const ANDROID_MARK = 'sk_client=android';

export const RULE_IDS = {
  YTM_WEB: 101,
  YTM_ANDROID: 102,
  LRCLIB: 104,
} as const;

let rulesReady: Promise<void> | null = null;

/** Session rules for declarativeNetRequest. Call at every service worker start. */
export async function installHeaderRules(): Promise<void> {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return;

  // Only this extension's own background requests: never a tab, never another extension or site worker.
  const noTab = [chrome.tabs?.TAB_ID_NONE ?? -1];

  // The extension's own origin host: the extension id in Chrome and Edge, the internal uuid
  // in Firefox (where runtime.id is the add-on id, which is not a valid domain there).
  const ours = [new URL(chrome.runtime.getURL('/')).hostname];
  const types = ['xmlhttprequest', 'other'] as chrome.declarativeNetRequest.ResourceType[];

  await dnr.updateSessionRules({
    // 103 was a Google Translate rule (removed): taken out of browsers that installed it.
    removeRuleIds: [...Object.values(RULE_IDS), 103],
    addRules: [
      // 101: YouTube Music web requests - remove Origin and Referer
      {
        id: RULE_IDS.YTM_WEB,
        priority: 1,
        action: {
          type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [
            { header: 'origin', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
            { header: 'referer', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
          ],
        },
        condition: { urlFilter: '||music.youtube.com/youtubei/', tabIds: noTab, initiatorDomains: ours, resourceTypes: types },
      },
      // 102: YouTube Music Android requests - remove Origin/Referer and set Android UA
      {
        id: RULE_IDS.YTM_ANDROID,
        priority: 2,
        action: {
          type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [
            { header: 'origin', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
            { header: 'referer', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
            { header: 'user-agent', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: ANDROID_UA },
          ],
        },
        condition: { urlFilter: `||music.youtube.com/youtubei/*${ANDROID_MARK}`, tabIds: noTab, initiatorDomains: ours, resourceTypes: types },
      },
      // 104: LRCLIB (lrclib.net) - remove Origin/Referer (keeps custom Lrclib-Client intact)
      {
        id: RULE_IDS.LRCLIB,
        priority: 1,
        action: {
          type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [
            { header: 'origin', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
            { header: 'referer', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
          ],
        },
        condition: { urlFilter: '||lrclib.net/api/', tabIds: noTab, initiatorDomains: ours, resourceTypes: types },
      },
    ],
  });
}

/** Makes sure the header rules exist (once per worker lifetime; again after a failure). */
export function ensureHeaderRules(): Promise<void> {
  rulesReady ??= (async () => {
    const dnr = chrome.declarativeNetRequest;
    if (!dnr?.getSessionRules) return;
    const ids = new Set((await dnr.getSessionRules()).map((r) => r.id));
    const expected = Object.values(RULE_IDS);
    if (!expected.every((id) => ids.has(id))) {
      await installHeaderRules();
    }
  })().catch((e) => {
    rulesReady = null;
    throw e;
  });
  return rulesReady;
}

/** Reset for tests. */
export function resetRulesReadyForTest(): void {
  rulesReady = null;
}

