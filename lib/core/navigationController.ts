/**
 * navigationController.ts
 * 
 * Centralized logic for Spotify-locked navigation and 
 * Context-Aware "Safe Release" of the lyrics panel.
 */

const SLY_RETURN_POINT = 'sly_return_point';

export function findActiveViewport(): HTMLElement | null {
  // 1. Search for ANY element with scroll in the entire document.
  // This is the most reliable way in a complex SPA like Spotify.
  const all = document.querySelectorAll('*');
  let best = null;
  let maxScroll = 0;
  
  const scrollCandidates: string[] = [];

  for (let i = 0; i < all.length; i++) {
    const el = all[i] as HTMLElement;
    const s = el.scrollTop;
    if (s > 0) {
      scrollCandidates.push(`${el.tagName}.${el.className.split(' ').join('.')} (${s}px)`);
      if (s > maxScroll) {
        maxScroll = s;
        best = el;
      }
    }
  }

  if (scrollCandidates.length > 0) {
    console.log(`>>> [sly-nav] Detected scrolling candidates:`, scrollCandidates);
  }

  if (best) return best;

  // 2. Fallback to common Spotify containers if no active scroll is found (e.g. at the top)
  return (document.querySelector('.os-viewport') as HTMLElement) || 
         (document.querySelector('main') as HTMLElement) || 
         document.documentElement;
}

/**
 * Captures the current path as a "Return Point" if we are entering 
 * the lyrics view from another Spotify page.
 */
export function captureReturnPoint(currentPath: string, lastPath: string): string {
  if (currentPath === '/lyrics' && lastPath !== '/lyrics' && lastPath !== '/') {
    // SLY FIX: Check if we have a proactively saved scroll from the click event first
    let scrollPos = 0;
    const proactiveScroll = sessionStorage.getItem(SLY_RETURN_POINT + '_scroll');
    
    if (proactiveScroll) {
      scrollPos = parseInt(proactiveScroll);
      console.log(`>>> [sly-nav] Using proactively saved scroll for "${lastPath}": ${scrollPos}px.`);
    } else {
      const viewport = findActiveViewport();
      scrollPos = viewport ? viewport.scrollTop : 0;
      console.log(`>>> [sly-nav] Saving "${lastPath}" as return point (Detected Scroll: ${scrollPos}px).`);
    }

    sessionStorage.setItem(SLY_RETURN_POINT, lastPath);
    sessionStorage.setItem(SLY_RETURN_POINT + '_scroll', scrollPos.toString());
    
    return currentPath;
  }
  return currentPath;
}

/**
 * Performs a "Safe Release" by executing an Atomic Navigation 
 * back to the original Spotify context.
 */
export function performAtomicRelease(configPool?: Set<any>): void {
  console.log('>>> [sly-nav] Executing Atomic Safe Release...');

  // Helper: Nuclear Cleanup of Genetic Locks
  const nuke = () => {
    const btn = document.querySelector('[data-testid="lyrics-button"]');
    if (btn) {
      // SLY FIX: Also clear DOM attributes to prevent stale reads in events.ts
      btn.removeAttribute('data-active');
      btn.setAttribute('aria-pressed', 'false');

      const fiberKey = Object.keys(btn).find(k => k.startsWith('__reactFiber$'));
      let curr = (btn as any)[fiberKey!];
      while (curr) {
        const props = curr.memoizedProps;
        if (props) {
          if ('isActive' in props) {
            Object.defineProperty(props, 'isActive', { value: false, configurable: true, enumerable: true });
          }
          if ('aria-pressed' in props) {
            Object.defineProperty(props, 'aria-pressed', { value: false, configurable: true, enumerable: true });
          }
        }
        curr = curr.return;
      }
    }
    if (configPool) {
      configPool.forEach((obj: any) => {
        ['isActive', 'aria-pressed', 'lyricsHub'].forEach(key => {
          if (key in obj) {
            Object.defineProperty(obj, key, { value: false, configurable: true, enumerable: true });
          }
        });
      });
    }
  };

  const returnPoint = sessionStorage.getItem(SLY_RETURN_POINT);
  const track = (window as any).spotifyState?.track;
  const trackId = track?.uri?.split(':').pop() || track?.id;

  // SLY FIX: Natively, Spotify uses a 1-step push/pop history stack for lyrics.
  // By using history.back() directly, we land on the EXACT history key that Spotify 
  // generated when the user was scrolling, which triggers perfect native scroll restoration.
  if (window.location.pathname.includes('/lyrics')) {
    if (returnPoint) {
      console.log(`>>> [sly-nav] Native-aligned Release: Returning to ${returnPoint}`);
      history.back();

      // SLY WATCHDOG: Cleanup AFTER navigation jump to ensure scroll restoration is not 
      // interrupted by React layout shifts.
      setTimeout(() => {
        const path = window.location.pathname;
        const viewport = findActiveViewport();
        
        if (path.includes('/lyrics')) {
          console.warn(`>>> [sly-nav] Back-navigation stalled. Forcing pushState fallback.`);
          history.pushState(null, '', returnPoint);
          window.dispatchEvent(new PopStateEvent('popstate'));
        } else {
          // SLY FIX: Verify scroll restoration after the 150ms window.
          // If native history restoration drifted, we force a hard correction.
          const savedScroll = sessionStorage.getItem(SLY_RETURN_POINT + '_scroll');
          if (savedScroll && viewport) {
            const targetScroll = parseInt(savedScroll);
            const currentScroll = viewport.scrollTop;
            if (Math.abs(currentScroll - targetScroll) > 5) {
              console.log(`>>> [sly-nav] 🛠️ Drift detected (${currentScroll}px vs ${targetScroll}px). Correcting...`);
              viewport.scrollTop = targetScroll;
            } else {
              console.log(`>>> [sly-nav] ✅ Scroll restored perfectly at ${currentScroll}px.`);
            }
          }
        }
        
        nuke();
        sessionStorage.removeItem(SLY_RETURN_POINT);
        sessionStorage.removeItem(SLY_RETURN_POINT + '_scroll');
      }, 150); // Safe margin beyond Spotify's 75ms snap window.
      return;
    } else if (trackId && trackId !== 'ad' && trackId !== 'N/A') {
      console.log(`>>> [sly-nav] Fallback: Navigating to Track Page.`);
      history.pushState(null, '', `/track/${trackId}`);
      setTimeout(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
        nuke();
      }, 0);
      return;
    } else {
      console.log('>>> [sly-nav] Fallback: Navigating to Home.');
      history.pushState(null, '', '/');
      setTimeout(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
        nuke();
      }, 0);
      return;
    }
  } else {
    console.log('>>> [sly-nav] Safe Release: Already outside /lyrics. Performing silent nuke.');
    nuke();
    sessionStorage.removeItem(SLY_RETURN_POINT);
    sessionStorage.removeItem(SLY_RETURN_POINT + '_scroll');
  }
}

