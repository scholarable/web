import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
let checked = 0;
async function scan(directory) {
  for (const item of await readdir(directory, {withFileTypes:true})) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await scan(path);
    else if (item.name.endsWith(".js")) {
      const source = await readFile(path, "utf8");
      assert.doesNotMatch(source, /Sample: Undergraduate study support|Sample: Postgraduate research support|Sample: Doctoral travel support|Sample: Exchange preparation grant|Example University|demo-catalogue/, path);
      checked++;
    }
  }
}
await scan("build");
assert.ok(checked > 0, "Build the application before checking production isolation");
console.log(`Production isolation passed: ${checked} JavaScript files contain no sample catalogue.`);
