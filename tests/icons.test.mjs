import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every name in iconNames renders without throwing", async () => {
  const { iconNames, AIcon } = await import(path.join(root, "dist/index.mjs"));
  
  for (const name of iconNames) {
    // Just verify the component can be created without throwing
    assert.doesNotThrow(() => {
      // We're not rendering to DOM, just checking the function exists and accepts the name
      const result = AIcon({ name });
      // Result can be null for unknown names, but should not throw
    }, `Icon "${name}" should render without throwing`);
  }
});

test("every src/svg file contains stroke=\"currentColor\" and stroke-width=\"1.5\"", () => {
  const svgDir = path.join(root, "src", "svg");
  const files = fs.readdirSync(svgDir).filter(f => f.endsWith(".svg"));
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(svgDir, file), "utf8");
    assert.match(content, /stroke="currentColor"/, `${file} must have stroke="currentColor"`);
    assert.match(content, /stroke-width="1\.5"/, `${file} must have stroke-width="1.5"`);
  }
});

test("no src/svg file has a fill attribute other than \"none\"", () => {
  const svgDir = path.join(root, "src", "svg");
  const files = fs.readdirSync(svgDir).filter(f => f.endsWith(".svg"));
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(svgDir, file), "utf8");
    const fillMatches = content.match(/fill="[^"]*"/g) || [];
    for (const fill of fillMatches) {
      assert.equal(fill, 'fill="none"', `${file} has invalid fill attribute: ${fill}`);
    }
  }
});

test("iconNames is sorted and has no duplicates", async () => {
  const { iconNames } = await import(path.join(root, "dist/index.mjs"));
  
  // Check sorted
  const sorted = [...iconNames].sort();
  assert.deepEqual([...iconNames], sorted, "iconNames must be sorted alphabetically");
  
  // Check no duplicates
  const unique = new Set(iconNames);
  assert.equal(unique.size, iconNames.length, "iconNames must have no duplicates");
});
