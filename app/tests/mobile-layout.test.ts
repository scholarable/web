import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("phone layout keeps shared content fluid and actions touch-usable", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(css, /body \{[^}]*min-width: 320px/);
  for (const container of ["list", "detail", "mine", "page-wrap"]) assert.match(css, new RegExp(`\\.${container} \\{[^}]*width: min\\(100%, \\d+px\\)`), container);
  // One column first; wider layouts only from a breakpoint up.
  assert.match(css, /\.cards \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.d-grid \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.card \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@container cards \(min-width: 560px\)/);
  // Touch targets of at least 44 px.
  assert.match(css, /\.btn \{[^}]*min-height: 48px/);
  assert.match(css, /\.chip \{[^}]*min-height: 46px/);
  assert.match(css, /\.save \{[^}]*width: 46px; height: 46px/);
  assert.match(css, /\.filter-chip \{[^}]*min-height: 44px/);
  assert.match(css, /\.sort-by a \{[^}]*min-height: 44px/);
  assert.match(css, /\.site-nav a \{[^}]*min-height: 44px/);
  assert.match(css, /\.text-link, \.text-button, summary, \.back \{ min-height: 44px; \}/);
  assert.match(css, /\.vault-card-heading, \.cv-candidate-actions \{ flex-wrap: wrap; \}/);
  // Save and apply stay in reach on a phone; the desktop box replaces the bar.
  assert.match(css, /\.actionbar \{ position: sticky; bottom: 0;/);
  assert.match(css, /@media \(min-width: 900px\) \{[^@]*\.actionbar \{ display: none; \}/);
});
