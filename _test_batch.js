const fs = require('fs');

async function testGoogleBatch() {
    const text = "كلام عينيه\nفي الغرام\nأحلى من الأغاني";
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ar&tl=en&dt=t&dt=rm&q=${encodeURIComponent(text)}`;

    console.log('Testing Google Batch...');
    try {
        const res = await fetch(url);
        const data = await res.json();

        // Find romanization block
        if (data && data[0]) {
            for (let i = data[0].length - 1; i >= 0; i--) {
                const item = data[0][i];
                if (Array.isArray(item)) {
                    if (item[2] && item[2].includes('\n')) {
                        console.log('Google Romanization found:\n' + item[2]);
                        const lines = item[2].split('\n');
                        console.log(`Input lines: 3, Output lines: ${lines.length}`);
                        return lines.length === 3;
                    }
                    // Fallback check index 3
                    if (item[3] && item[3].includes('\n')) {
                        console.log('Google Romanization found (idx 3):\n' + item[3]);
                        const lines = item[3].split('\n');
                        console.log(`Input lines: 3, Output lines: ${lines.length}`);
                        return lines.length === 3;
                    }
                }
            }
        }
        console.log('Google did not return batched romanization properly', JSON.stringify(data[0]));
    } catch (e) {
        console.log('Google Error:', e.message);
    }
    return false;
}

async function testAksharamukhaBatch() {
    const text = "வணக்கம்\nஉலகம்"; // Tamil: Vanakkam\nUlagam
    // Aksharamukha API
    const params = new URLSearchParams({
        source: 'Tamil',
        target: 'IAST',
        text: text
    });
    const url = 'https://aksharamukha-plugin.appspot.com/api/public?' + params.toString();

    console.log('\nTesting Aksharamukha Batch...');
    try {
        const res = await fetch(url);
        const result = await res.text();
        console.log('Aksharamukha result:\n' + result);
        const lines = result.split('\n');
        console.log(`Input lines: 2, Output lines: ${lines.length}`);
        return lines.length === 2;
    } catch (e) {
        console.log('Aksharamukha Error:', e.message);
    }
    return false;
}

(async () => {
    await testGoogleBatch();
    await testAksharamukhaBatch();
})();
