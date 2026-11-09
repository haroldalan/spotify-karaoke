import { installHook } from '../src/page/hook';

export default defineContentScript({
  matches: ['https://open.spotify.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installHook();
  },
});
