import type { SongCache } from '../core/lyricsTypes';
import { getLyricsLines, getNowPlayingKey } from './domQueries';

/**
 * Physically removes all extension-injected elements and attributes from the 
 * native lyrics container, restoring it to its original Spotify state.
 */
/**
 * Physically removes all extension-injected elements and attributes from the 
 * native lyrics container, restoring it to its original Spotify state.
 */
export function purgeSlyDOM(): void {
  console.log('[sly-purge] 🧹 Beginning DOM purge. Querying target elements...');
  const lines = document.querySelectorAll('[data-testid="lyrics-line"] > div');
  console.log(`[sly-purge] 🧹 Found ${lines.length} elements to evaluate for purging.`);
  
  console.groupCollapsed(`[sly-purge] 🧹 Detailed elements purging evaluation (${lines.length} elements)`);
  lines.forEach((el, idx) => {
    const original = el.getAttribute('data-sly-original');
    const innerSpans = el.querySelectorAll('.sly-main-line, .sly-dual-line');
    
    console.log(`[sly-purge] 🧹 Element [${idx}] | textContent="${el.textContent?.trim()}" | data-sly-original="${original}" | Injected spans: ${innerSpans.length}`);
    
    if (original !== null) {
      console.log(`[sly-purge]   -> Restoring text to "${original}" and removing attribute.`);
      el.textContent = original;
      el.removeAttribute('data-sly-original');
    } else {
      if (innerSpans.length > 0) {
        console.log(`[sly-purge]   -> No data-sly-original but found ${innerSpans.length} spans. Removing spans.`);
        innerSpans.forEach(s => s.remove());
      } else {
        console.log(`[sly-purge]   -> Pristine element. No actions needed.`);
      }
    }
    // Also clear the active class if it survived
    el.classList.remove('sly-active');
  });
  console.groupEnd();
  console.log('[sly-purge] 🧹 DOM purge finished.');
}

export function snapshotOriginals(cache: SongCache): void {
  const lines = getLyricsLines();
  const currentKey = getNowPlayingKey();
  console.log(`[sly-audit] 📸 snapshotOriginals executing for active songKey: "${currentKey}". Snapped ${lines.length} lines. First line preview: "${lines[0]?.textContent?.trim() || 'empty'}"`);

  lines.forEach((el) => {
    if (el.hasAttribute('data-sly-original')) return;
    
    // SLY FIX: Never read from .sly-main-line during a snapshot. 
    // If the extension has already injected spans (due to a race), 
    // we must ignore them and use textContent (which should be the native text 
    // if Spotify just updated the node) or ideally, we should have purged first.
    el.setAttribute('data-sly-original', el.textContent ?? '');
  });

  const snapped = lines.map(
    (el) => el.getAttribute('data-sly-original') ?? ''
  );

  const hasContent = snapped.filter(l => l.trim().length > 0).length >= 3;
  if (!hasContent) return;

  cache.original = snapped;
}

/**
 * Capitalizes the first alphabetic character in a string, preserving any leading
 * non-alphabetic characters (e.g., "(dha" -> "(Dha").
 */
export function capitalizeLine(line: string): string {
  if (!line) return line;
  return line.replace(/^([^a-zA-Z]*)([a-z])/, (match, prefix, firstChar) => {
    return prefix + firstChar.toUpperCase();
  });
}

function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()♪?…\s]/g, '')
    .trim();
}

function getBigrams(str: string): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.push(str.substring(i, i + 2));
  }
  return bigrams;
}

function getDiceSimilarity(s1: string, s2: string): number {
  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  const set2 = new Set(b2);
  let intersection = 0;
  for (const b of b1) {
    if (set2.has(b)) {
      intersection++;
    }
  }
  const totalLength = b1.length + b2.length;
  return totalLength > 0 ? (2 * intersection) / totalLength : 0;
}

export function applyLinesToDOM(
  lines: string[] | null | undefined,
  originals: string[] | undefined,
  dualLyricsEnabled: boolean,
  setApplying: (v: boolean) => void,
  targetElements?: Element[]
): void {
  if (!Array.isArray(lines)) {
    console.warn('[sly-dom] 🚫 applyLinesToDOM called with invalid/non-array lines:', lines);
    return;
  }

  setApplying(true);

  const domElements = targetElements ?? getLyricsLines();
  const isTakeoverMode = document.getElementById('lyrics-root-sync') !== null;
  const useTextMatching = !isTakeoverMode && Array.isArray(originals) && originals.length > 0;
  
  console.log(`%c[sly-dom] 🚀 applyLinesToDOM invoked!`, 'color: #38bdf8; font-weight: bold;');
  console.log(`[sly-dom] Args: linesLength=${lines.length} | originalsLength=${originals?.length ?? 'none'} | dualEnabled=${dualLyricsEnabled} | targetElementsGiven=${!!targetElements} | domElementsLength=${domElements.length} | isTakeoverMode=${isTakeoverMode}`);
  if (useTextMatching) {
    console.log(`[sly-dom] Text matching is ACTIVE. Space count in cache.original:`, originals!.filter(l => !l.trim()).length);
  } else {
    console.log(`[sly-dom] Text matching is INACTIVE (falling back strictly to 1:1 index alignment).`);
  }

  let currentArrayIdx = 0;

  console.groupCollapsed(`[sly-dom] 🔍 Detailed line matching and rendering details (${domElements.length} lines)`);
  domElements.forEach((el, i) => {
    // BUG-15 Fix: If the element is no longer connected to the DOM, skip it.
    // This happens if a panel close -> reopen occurred during an async fetch.
    // We allow 'lyrics-root-sync' even if not yet connected (during initial injection).
    if (!el) {
      console.log(`[sly-dom] Element [${i}] is null! Skipping.`);
      return;
    }
    if (!el.isConnected && el.id !== 'lyrics-root-sync') {
      console.log(`[sly-dom] Element [${i}] is not connected (detached). Skipping.`);
      return;
    }

    let matchIndex = i; // Default index-based fallback

    const isProcessed = el.querySelector('.sly-main-line, .sly-dual-line') !== null;
    let domOriginalText = '';
    const rawAttrOriginal = el.getAttribute('data-sly-original');

    if (isProcessed) {
      domOriginalText = rawAttrOriginal ?? '';
      console.log(`[sly-dom] [${i}] Element is PROCESSED (has spans) | textContent="${el.textContent?.trim()}" | data-sly-original attribute="${rawAttrOriginal}"`);
    } else {
      domOriginalText = el.textContent?.trim() ?? '';
      console.log(`[sly-dom] [${i}] Element is NATIVE/RECYCLED (no spans) | textContent="${domOriginalText}" | data-sly-original attribute="${rawAttrOriginal}"`);
      if (rawAttrOriginal !== null) {
        console.log(`[sly-dom]   -> Cleared stale data-sly-original attribute!`);
        el.removeAttribute('data-sly-original');
      }
    }

    domOriginalText = domOriginalText.replace(/\s+/g, ' ').trim();
    const originalTextToRestore = domOriginalText;

    const paddingLineClass = window.SPOTIFY_CLASSES?.paddingLineHelper || 'aLaX8poOH8kdbmGf';
    const isSpacer = el.classList.contains(paddingLineClass) ||
                     el.parentElement?.classList.contains(paddingLineClass) ||
                     (i < 2 && domOriginalText === '');

    if (isSpacer) {
      matchIndex = -1;
      console.log(`[sly-dom] [${i}] Identified as SPACER | Mapping to matchIndex=-1 (Ignored)`);
    } else if (useTextMatching) {
      const isDomInstrumental = domOriginalText === '' || domOriginalText === '♪';

      let foundIndex = -1;

      if (isDomInstrumental) {
        console.log(`[sly-dom] [${i}] Instrumental matching search starting from currentArrayIdx=${currentArrayIdx}...`);
        for (let j = currentArrayIdx; j < originals!.length; j++) {
          const origText = (originals![j] ?? '').replace(/\s+/g, ' ').trim();
          const isOrigInstrumental = origText === '' || origText === '♪';

          if (isOrigInstrumental) {
            let hasVocalSkipped = false;
            for (let k = currentArrayIdx; k < j; k++) {
              const betweenText = (originals![k] ?? '').replace(/\s+/g, ' ').trim();
              if (betweenText !== '' && betweenText !== '♪') {
                hasVocalSkipped = true;
                break;
              }
            }
            if (!hasVocalSkipped) {
              foundIndex = j;
              console.log(`[sly-dom]   -> Found sliding-window instrumental match at index=${foundIndex}`);
              break;
            }
          }
        }
      } else {
        console.log(`[sly-dom] [${i}] Vocal Line Sørensen-Dice matching search starting from currentArrayIdx=${currentArrayIdx}...`);
        const normDom = normalizeText(domOriginalText);
        if (normDom !== '') {
          let bestIndex = -1;
          let bestScore = 0;
          const searchLimit = Math.min(currentArrayIdx + 15, originals!.length);

          for (let j = currentArrayIdx; j < searchLimit; j++) {
            const origText = (originals![j] ?? '').replace(/\s+/g, ' ').trim();
            const isOrigInstrumental = origText === '' || origText === '♪';
            if (isOrigInstrumental) continue;

            const normOrig = normalizeText(origText);
            if (normOrig === '') continue;

            if (normDom === normOrig) {
              bestIndex = j;
              bestScore = 1.0;
              break;
            }

            if (normDom.includes(normOrig) || normOrig.includes(normDom)) {
              const score = Math.min(normDom.length, normOrig.length) / Math.max(normDom.length, normOrig.length);
              if (score > bestScore) {
                bestScore = score;
                bestIndex = j;
              }
            }

            const dice = getDiceSimilarity(normDom, normOrig);
            if (dice >= 0.50 && dice > bestScore) {
              bestScore = dice;
              bestIndex = j;
            }
          }

          if (bestIndex !== -1 && bestScore >= 0.45) {
            foundIndex = bestIndex;
            console.log(`[sly-dom]   -> Found sliding-window vocal match at index=${foundIndex} with score=${bestScore.toFixed(3)} ("${originals![foundIndex]}")`);
          }
        }
      }

      if (foundIndex === -1 && !isDomInstrumental) {
        console.log(`[sly-dom] [${i}] Sliding window mismatch. Running fallback global search for exact normalized match...`);
        const normDom = normalizeText(domOriginalText);
        if (normDom !== '') {
          for (let j = 0; j < originals!.length; j++) {
            const origText = (originals![j] ?? '').replace(/\s+/g, ' ').trim();
            if (normDom === normalizeText(origText)) {
              foundIndex = j;
              console.log(`[sly-dom]   -> Found fallback global match at index=${foundIndex} ("${originals![foundIndex]}")`);
              break;
            }
          }
        }
      }

      if (foundIndex !== -1) {
        matchIndex = foundIndex;
        currentArrayIdx = foundIndex + 1;
        console.log(`[sly-dom] [${i}] Matched successfully! matchIndex=${matchIndex} | Advanced sliding-window pointer to j=${currentArrayIdx}`);
      } else {
        console.warn(`[sly-dom] ⚠️ [${i}] Could NOT match native text "${domOriginalText}" inside originals cache! Falling back to 1:1 index alignment (matchIndex=${matchIndex})`);
        matchIndex = i;
      }
    }

    if (matchIndex === -1) {
      el.textContent = '';
      el.removeAttribute('data-sly-original');
      console.log(`[sly-dom] [${i}] Spacer div ignored & cleared.`);
      return;
    }

    if (originalTextToRestore !== '') {
      el.setAttribute('data-sly-original', originalTextToRestore);
      console.log(`[sly-dom] [${i}] Set data-sly-original attribute to raw DOM text: "${originalTextToRestore}"`);
    }

    if (lines[matchIndex] === undefined) {
      console.warn(`[sly-dom] [${i}] Target line at matchIndex=${matchIndex} is undefined inside processed lines! skipping replacement.`);
      return;
    }

    const processedLine = capitalizeLine(lines[matchIndex]);

    const showDual =
      dualLyricsEnabled &&
      originals !== undefined &&
      originals[matchIndex] !== undefined &&
      originals[matchIndex] !== lines[matchIndex];

    console.log(`[sly-dom] [${i}] Rendering: showDual=${showDual} | Original="${originals?.[matchIndex]}" | Processed/Romanized="${processedLine}"`);

    if (showDual) {
      el.textContent = '';
      const mainSpan = document.createElement('span');
      mainSpan.className = 'sly-main-line';
      mainSpan.textContent = processedLine;
      el.appendChild(mainSpan);

      const subSpan = document.createElement('span');
      subSpan.className = 'sly-dual-line';
      subSpan.textContent = originals![matchIndex];
      el.appendChild(subSpan);
    } else {
      if (originalTextToRestore === '') {
        el.textContent = '';
      } else {
        el.textContent = '';
        const mainSpan = document.createElement('span');
        mainSpan.className = 'sly-main-line';
        mainSpan.textContent = processedLine;
        el.appendChild(mainSpan);
      }
    }
  });
  console.groupEnd();

  // CENTRALIZED DEBUG LOGGING: Spit out the entire lyrics side-by-side in console.table
  try {
    const isOriginalMode = !originals || originals.length === 0 || originals === lines;
    const modeName = isOriginalMode ? 'ORIGINAL' : 'PROCESSED';
    
    console.groupCollapsed(`%c[sly-debug] 📋 ENTIRE LYRICS APPLIED (Mode: ${modeName}) (${lines.length} lines)`, 'color: #1DB954; font-weight: bold; font-size: 12px;');
    console.log(`[sly-debug] Applied Lines Count: ${lines.length}`);
    
    const table = lines.map((line, idx) => {
      const orig = originals?.[idx] ?? line;
      if (isOriginalMode) {
        return {
          Index: idx,
          Original: orig
        };
      } else {
        return {
          Index: idx,
          Original: orig,
          Applied: line
        };
      }
    });
    console.table(table);
    console.groupEnd();
  } catch (logErr) {
    console.warn('[sly-debug] Failed to print entire lyrics table:', logErr);
  }

  // setTimeout defers the flag reset to a macrotask, ensuring the MutationObserver
  // microtask (which fires during the same synchronous task as the DOM writes above)
  // still sees isApplying=true and skips its re-apply check.
  setTimeout(() => { setApplying(false); }, 50);
}
