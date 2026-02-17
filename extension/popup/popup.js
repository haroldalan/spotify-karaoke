document.addEventListener('DOMContentLoaded', () => {
    const languageSelect = document.getElementById('language-select');
    const statusMsg = document.getElementById('status-msg');

    // Comprehensive list of languages supported by Google Translate
    const languages = [
        { code: 'af', name: 'Afrikaans' },
        { code: 'sq', name: 'Albanian' },
        { code: 'am', name: 'Amharic' },
        { code: 'ar', name: 'Arabic' },
        { code: 'hy', name: 'Armenian' },
        { code: 'az', name: 'Azerbaijani' },
        { code: 'eu', name: 'Basque' },
        { code: 'be', name: 'Belarusian' },
        { code: 'bn', name: 'Bengali' },
        { code: 'bs', name: 'Bosnian' },
        { code: 'bg', name: 'Bulgarian' },
        { code: 'ca', name: 'Catalan' },
        { code: 'ceb', name: 'Cebuano' },
        { code: 'ny', name: 'Chichewa' },
        { code: 'zh-CN', name: 'Chinese (Simplified)' },
        { code: 'zh-TW', name: 'Chinese (Traditional)' },
        { code: 'co', name: 'Corsican' },
        { code: 'hr', name: 'Croatian' },
        { code: 'cs', name: 'Czech' },
        { code: 'da', name: 'Danish' },
        { code: 'nl', name: 'Dutch' },
        { code: 'en', name: 'English' },
        { code: 'eo', name: 'Esperanto' },
        { code: 'et', name: 'Estonian' },
        { code: 'tl', name: 'Filipino' },
        { code: 'fi', name: 'Finnish' },
        { code: 'fr', name: 'French' },
        { code: 'fy', name: 'Frisian' },
        { code: 'gl', name: 'Galician' },
        { code: 'ka', name: 'Georgian' },
        { code: 'de', name: 'German' },
        { code: 'el', name: 'Greek' },
        { code: 'gu', name: 'Gujarati' },
        { code: 'ht', name: 'Haitian Creole' },
        { code: 'ha', name: 'Hausa' },
        { code: 'haw', name: 'Hawaiian' },
        { code: 'iw', name: 'Hebrew' },
        { code: 'hi', name: 'Hindi' },
        { code: 'hmn', name: 'Hmong' },
        { code: 'hu', name: 'Hungarian' },
        { code: 'is', name: 'Icelandic' },
        { code: 'ig', name: 'Igbo' },
        { code: 'id', name: 'Indonesian' },
        { code: 'ga', name: 'Irish' },
        { code: 'it', name: 'Italian' },
        { code: 'ja', name: 'Japanese' },
        { code: 'jw', name: 'Javanese' },
        { code: 'kn', name: 'Kannada' },
        { code: 'kk', name: 'Kazakh' },
        { code: 'km', name: 'Khmer' },
        { code: 'rw', name: 'Kinyarwanda' },
        { code: 'ko', name: 'Korean' },
        { code: 'ku', name: 'Kurdish (Kurmanji)' },
        { code: 'ky', name: 'Kyrgyz' },
        { code: 'lo', name: 'Lao' },
        { code: 'la', name: 'Latin' },
        { code: 'lv', name: 'Latvian' },
        { code: 'lt', name: 'Lithuanian' },
        { code: 'lb', name: 'Luxembourgish' },
        { code: 'mk', name: 'Macedonian' },
        { code: 'mg', name: 'Malagasy' },
        { code: 'ms', name: 'Malay' },
        { code: 'ml', name: 'Malayalam' },
        { code: 'mt', name: 'Maltese' },
        { code: 'mi', name: 'Maori' },
        { code: 'mr', name: 'Marathi' },
        { code: 'mn', name: 'Mongolian' },
        { code: 'my', name: 'Myanmar (Burmese)' },
        { code: 'ne', name: 'Nepali' },
        { code: 'no', name: 'Norwegian' },
        { code: 'or', name: 'Odia (Oriya)' },
        { code: 'ps', name: 'Pashto' },
        { code: 'fa', name: 'Persian' },
        { code: 'pl', name: 'Polish' },
        { code: 'pt', name: 'Portuguese' },
        { code: 'pa', name: 'Punjabi' },
        { code: 'ro', name: 'Romanian' },
        { code: 'ru', name: 'Russian' },
        { code: 'sm', name: 'Samoan' },
        { code: 'gd', name: 'Scots Gaelic' },
        { code: 'sr', name: 'Serbian' },
        { code: 'st', name: 'Sesotho' },
        { code: 'sn', name: 'Shona' },
        { code: 'sd', name: 'Sindhi' },
        { code: 'si', name: 'Sinhala' },
        { code: 'sk', name: 'Slovak' },
        { code: 'sl', name: 'Slovenian' },
        { code: 'so', name: 'Somali' },
        { code: 'es', name: 'Spanish' },
        { code: 'su', name: 'Sundanese' },
        { code: 'sw', name: 'Swahili' },
        { code: 'sv', name: 'Swedish' },
        { code: 'tg', name: 'Tajik' },
        { code: 'ta', name: 'Tamil' },
        { code: 'tt', name: 'Tatar' },
        { code: 'te', name: 'Telugu' },
        { code: 'th', name: 'Thai' },
        { code: 'tr', name: 'Turkish' },
        { code: 'tk', name: 'Turkmen' },
        { code: 'uk', name: 'Ukrainian' },
        { code: 'ur', name: 'Urdu' },
        { code: 'ug', name: 'Uyghur' },
        { code: 'uz', name: 'Uzbek' },
        { code: 'vi', name: 'Vietnamese' },
        { code: 'cy', name: 'Welsh' },
        { code: 'xh', name: 'Xhosa' },
        { code: 'yi', name: 'Yiddish' },
        { code: 'yo', name: 'Yoruba' },
        { code: 'zu', name: 'Zulu' }
    ];

    // Populate dropdown
    languages.forEach(lang => {
        const option = document.createElement('option');
        option.value = lang.code;
        option.textContent = lang.name;
        languageSelect.appendChild(option);
    });

    // Load saved settings
    chrome.storage.local.get(['targetLanguage'], (result) => {
        if (result.targetLanguage) {
            languageSelect.value = result.targetLanguage;
        } else {
            languageSelect.value = 'en'; // Default
        }
    });

    // Save on change
    languageSelect.addEventListener('change', (e) => {
        const selectedLang = e.target.value;
        chrome.storage.local.set({ targetLanguage: selectedLang }, () => {
            showSaved();
        });
    });

    // Dual Lyrics Logic
    const dualLyricsCheck = document.getElementById('dual-lyrics-check');

    // Load setting
    chrome.storage.local.get(['dualLyrics'], (result) => {
        dualLyricsCheck.checked = result.dualLyrics === true;
    });

    // Save setting
    dualLyricsCheck.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        chrome.storage.local.set({ dualLyrics: isChecked }, () => {
            showSaved();
        });
    });

    function showSaved() {
        statusMsg.textContent = 'Saved';
        statusMsg.classList.add('visible');
        setTimeout(() => {
            statusMsg.classList.remove('visible');
        }, 1500);
    }

    // Storage Usage & Reset Logic
    const storageInfo = document.getElementById('storage-info');
    const resetBtn = document.getElementById('reset-btn');

    function updateStorageUsage() {
        if (chrome.storage.local.getBytesInUse) {
            chrome.storage.local.getBytesInUse(null, (bytes) => {
                const kb = (bytes / 1024).toFixed(2);
                storageInfo.textContent = `${kb} KB used`;
            });
        } else {
            storageInfo.textContent = 'Data: N/A';
        }
    }

    updateStorageUsage();

    resetBtn.addEventListener('click', () => {
        if (confirm('Reset all extension settings and cache?')) {
            chrome.storage.local.clear(() => {
                statusMsg.textContent = 'Reset!';
                statusMsg.classList.add('visible');

                // Reset UI defaults
                languageSelect.value = 'en';
                updateStorageUsage();

                setTimeout(() => {
                    statusMsg.classList.remove('visible');
                }, 2000);
            });
        }
    });

    // Star Feature
    const starBtn = document.getElementById('star-btn');
    starBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://github.com/haroldalan/spotify-karaoke' });
    });

    // Listen for storage changes to update UI live
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            updateStorageUsage();
        }
    });
});
