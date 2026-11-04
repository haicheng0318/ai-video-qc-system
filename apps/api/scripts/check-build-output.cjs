const { existsSync, statSync } = require('node:fs');
const { resolve, join } = require('node:path');

function assertBuildOutput(directory) {
  for (const entry of ['app.module.js', 'main.js', 'worker.js']) {
    const path = join(directory, entry);
    if (!existsSync(path) || !statSync(path).isFile()) throw Error(`Missing build entry: ${entry}`);
  }
  for (const forbidden of ['api/src', 'web', 'tests']) {
    if (existsSync(join(directory, forbidden))) throw Error(`Forbidden build output: ${forbidden}`);
  }
}

module.exports = { assertBuildOutput };
if (require.main === module) {
  assertBuildOutput(resolve(__dirname, '../dist'));
  console.log('API_BUILD_OUTPUT=PASS (app.module.js, main.js, worker.js; no nested/test output)');
}
