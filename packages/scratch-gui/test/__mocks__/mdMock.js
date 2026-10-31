const fs = require('fs');
const path = require('path');

// Jest runs in Node, so expose the real Scrathon documentation file as a
// string in tests. Webpack uses `asset/source` for the same import in the app.
const docPath = path.resolve(__dirname, '../../src/addons/addons/astras-copilot/docs/scrathon.md');
module.exports = fs.readFileSync(docPath, 'utf8');
