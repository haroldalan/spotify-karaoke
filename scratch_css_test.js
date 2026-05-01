const fs = require('fs');
const https = require('https');

https.get('https://open.spotifycdn.com/cdn/build/web-player/web-player.37b43ccc.css', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    // Write the css to a file so we can inspect it
    fs.writeFileSync('spotify.css', data);
    console.log("CSS downloaded. Size:", data.length);
    
    // Look for our targets
    const activeMatches = data.match(/\.([a-zA-Z0-9_-]+)[^{]*\{[^}]*var\(--lyrics-color-active\)[^}]*\}/g);
    const passedMatches = data.match(/\.([a-zA-Z0-9_-]+)[^{]*\{[^}]*var\(--lyrics-color-passed\)[^}]*\}/g);
    const inactiveMatches = data.match(/\.([a-zA-Z0-9_-]+)[^{]*\{[^}]*var\(--lyrics-color-inactive\)[^}]*\}/g);
    
    console.log("Active Matches:", activeMatches);
    console.log("Passed Matches:", passedMatches);
    console.log("Inactive Matches:", inactiveMatches);
  });
}).on('error', err => {
  console.log('Error:', err.message);
});
