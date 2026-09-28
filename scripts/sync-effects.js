// Desktop owns the shared offline effects. Android bundles an identical copy; no runtime build step.
const fs = require('fs');
const path = require('path');
for (const file of ['effects.js', 'effects.css', 'vendor/thinking-orbs.js', 'vendor/LIBRARIES-LICENSE.txt']) {
  const source = path.resolve(__dirname, '../renderer', file);
  const destination = path.resolve(__dirname, '../phone/app/src/main/assets/www', file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
