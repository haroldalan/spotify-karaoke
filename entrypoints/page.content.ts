import { installHook } from '../src/page/hook';
import { installDevkit } from '../src/devkit/page';
import { DEVKIT } from '../src/devkit/protocol';

export default defineContentScript({
  matches: ['https://open.spotify.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installHook();
    if (DEVKIT) installDevkit();
  },
});
