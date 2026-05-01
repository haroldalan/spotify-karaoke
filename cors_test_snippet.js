let success = false;
for (const sheet of document.styleSheets) {
  try {
    if (sheet.href && sheet.href.includes('open.spotifycdn.com')) {
      const rules = sheet.cssRules;
      console.log("SUCCESS! Can read " + rules.length + " rules from " + sheet.href);
      success = true;
      break;
    }
  } catch(e) {
    console.error("CORS BLOCKED:", e.message);
  }
}
if (!success) console.log("Failed to read any Spotify stylesheets.");
