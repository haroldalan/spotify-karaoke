import { LANGUAGES } from '../../src/shared/languages';
import { loadSettings, saveSettings } from '../../src/shared/settings';
import type { Mode, Settings } from '../../src/shared/types';

const lang = document.querySelector<HTMLSelectElement>('#lang')!;
for (const [code, name] of LANGUAGES) lang.add(new Option(name, code));

const BOOLS = ['showOriginal', 'showRomanized', 'showTranslation', 'fillMissing', 'restoreNative', 'showPill'] as const;

function render(s: Settings) {
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) r.checked = r.value === s.mode;
  for (const k of BOOLS) document.querySelector<HTMLInputElement>(`input[name="${k}"]`)!.checked = s[k];
  lang.value = s.targetLang;
}

void loadSettings().then(render);

document.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (el.name === 'mode') void saveSettings({ mode: el.value as Mode });
  else if (el.name === 'targetLang') void saveSettings({ targetLang: el.value });
  else if ((BOOLS as readonly string[]).includes(el.name)) void saveSettings({ [el.name]: (el as HTMLInputElement).checked });
});

document.querySelector('#version')!.textContent = `v${chrome.runtime.getManifest().version}`;
document.querySelector('#shortcuts')!.addEventListener('click', (e) => {
  e.preventDefault();
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
