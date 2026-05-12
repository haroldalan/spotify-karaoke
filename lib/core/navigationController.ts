/**
 * navigationController.ts
 * 
 * Centralized logic for Spotify-locked navigation, History Shielding,
 * and Context-Aware "Safe Release" of the lyrics panel.
 */

const SLY_RETURN_POINT = 'sly_return_point';
const SLY_SHIELD_TAG = 'sly_shield_active';

/**
 * Deploys the History Shield buffer if we arrived at Spotify 
 * directly at the /lyrics route.
 */
export function wrapHistoryForBridge(): void {
  if (typeof window === 'undefined' || (window as any).__sly_history_wrapped) return;
  (window as any).__sly_history_wrapped = true;

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    window.postMessage({ source: 'SLY_NAV_CHANGE' }, '*');
  };

  window.addEventListener('popstate', () => {
    window.postMessage({ source: 'SLY_NAV_CHANGE' }, '*');
  });
}

export function deployHistoryShield(): void {
  if (typeof window === 'undefined') return;

  if (!sessionStorage.getItem(SLY_SHIELD_TAG) || history.length <= 2) {
    console.log('>>> [sly-nav] Direct entry detected. Deploying History Buffer.');
    sessionStorage.setItem(SLY_SHIELD_TAG, 'true');
    
    const currentState = { ...history.state, [SLY_SHIELD_TAG]: true };
    history.replaceState(currentState, '');
    history.pushState({ ...currentState, is_buffer: true }, '');
  }

  // Intercept 'Back' events that breach the buffer
  window.addEventListener('popstate', (event) => {
    if (window.location.pathname === '/lyrics' && event.state && event.state[SLY_SHIELD_TAG] && !event.state.is_buffer) {
      console.log('>>> [sly-nav] Shield breached. Redirecting to Spotify Home.');
      window.location.href = '/';
    }
  });
}

/**
 * Captures the current path as a "Return Point" if we are entering 
 * the lyrics view from another Spotify page.
 */
export function captureReturnPoint(currentPath: string, lastPath: string): string {
  if (currentPath === '/lyrics' && lastPath !== '/lyrics' && lastPath !== '/') {
    console.log(`>>> [sly-nav] Saving "${lastPath}" as return point.`);
    sessionStorage.setItem(SLY_RETURN_POINT, lastPath);
    return currentPath;
  }
  return currentPath;
}

/**
 * Performs a "Safe Release" by nuking Genetic Locks and executing 
 * an Atomic Navigation to the best available context.
 */
export function performAtomicRelease(configPool?: Set<any>): void {
  console.log('>>> [sly-nav] Executing Atomic Safe Release...');

  // 1. Fiber Nuke for the Lyrics Button
  const btn = document.querySelector('[data-testid="lyrics-button"]');
  if (btn) {
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

  // 2. Deep Nuke for pooled objects (Now Playing Bar / Hub state)
  if (configPool) {
    configPool.forEach((obj: any) => {
      ['isActive', 'aria-pressed', 'lyricsHub'].forEach(key => {
        if (key in obj) {
          Object.defineProperty(obj, key, { value: false, configurable: true, enumerable: true });
        }
      });
    });
  }

  // 3. Navigation Logic
  const returnPoint = sessionStorage.getItem(SLY_RETURN_POINT);
  const track = (window as any).spotifyState?.track;
  const trackId = track?.uri?.split(':').pop() || track?.id;

  if (returnPoint) {
    console.log(`>>> [sly-nav] Navigating to Saved Context: ${returnPoint}`);
    history.pushState(null, '', returnPoint);
  } else if (trackId && trackId !== 'ad' && trackId !== 'N/A') {
    console.log(`>>> [sly-nav] Navigating to Track Page: /track/${trackId}`);
    history.pushState(null, '', `/track/${trackId}`);
  } else {
    console.log('>>> [sly-nav] Navigating to Home Fallback');
    history.pushState(null, '', '/');
  }

  // Trigger the router update with a micro-tick to ensure the history stack has settled
  setTimeout(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
    sessionStorage.removeItem(SLY_RETURN_POINT);
  }, 0);
}
