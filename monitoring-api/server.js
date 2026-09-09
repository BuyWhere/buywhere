// Wrapper for buywhere-monitoring-api. Loads the actual entry from api/src/index.js
// so the prober service can be deployed as a standalone NIXPACKS app.
const path = require('path');
require(path.join(__dirname, 'api/src/index.js'));
