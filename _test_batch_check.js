const fs = require('fs');

async function testGoogleBatch() {
    const text = "A\nB\nC";
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&dt=rm&q=${encodeURIComponent(text)}`;
    // Using en->ar just to test newline preservation in romanization block
    // Actually better to test known lang. Let's stick to Ar->En romanization.
    const url2 = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ar&tl=en&dt=t&dt=rm&q=${encodeURIComponent("كلام\nعينيه\nفي")}`;

    try {
        const res = await fetch(url2);
        const data = await res.json();
        // Check if we get 3 lines
        if (data && data[0]) {
            for (let i = data[0].length - 1; i >= 0; i--) {
                const item = data[0][i];
                if (Array.isArray(item)) {
                    if (item[2] || item[3]) {
                        const rom = item[2] || item[3];
                        const count = rom.split('\n').length;
                        console.log(`Google: Input 3 lines -> Output ${count} lines. Match? ${count === 3}`);
                        return count === 3;
                    }
                }
            }
        }
    } catch (e) { console.log('Google Error', e.message); }
    return false;
}

async function testAksharamukhaBatch() {
    const text = "A\nB";
    const params = new URLSearchParams({ source: 'Tamil', target: 'IAST', text: "வணக்கம்\nஉலகம்" });
    const url = 'https://aksharamukha-plugin.appspot.com/api/public?' + params.toString();
    try {
        const res = await fetch(url);
        const txt = await res.text();
        const count = txt.split('\n').length;
        console.log(`Aksharamukha: Input 2 lines -> Output ${count} lines. Match? ${count === 2}`);
        return count === 2;
    } catch (e) { console.log('Akshar Error', e.message); }
    return false;
}

(async () => {
    await testGoogleBatch();
    await testAksharamukhaBatch();
})();
