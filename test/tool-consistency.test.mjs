import test from "node:test";
import assert from "node:assert/strict";

test("tool consistency: extractDesignTokens, generateCssGradient, checkWcagContrast handle empty inputs safely", async () => {
  const { extractDesignTokens, generateCssGradient, checkWcagContrast } = await import("../lib/frontend-assets.js");

  const palette = extractDesignTokens([], { prefix: "test" });
  assert.ok(palette.tokens.background);
  assert.ok(palette.cssVariables.includes("--test-background"));

  const gradient = generateCssGradient([], "linear");
  assert.strictEqual(gradient.type, "linear");
  assert.ok(gradient.byteSize > 0);

  const contrast = checkWcagContrast([], "#ffffff");
  assert.ok(contrast.minContrastRatio > 0);
  assert.strictEqual(typeof contrast.passedAA, "boolean");
});

test("tool consistency: generatePwaIconSuite produces valid PWA assets and manifest", async () => {
  const { generatePwaIconSuite } = await import("../lib/frontend-assets.js");
  const suite = await generatePwaIconSuite({
    name: "Test App",
    shortName: "Test",
    themeColor: "#123456",
    backgroundColor: "#ffffff"
  });
  assert.strictEqual(suite.name, "Test App");
  assert.strictEqual(suite.icons.length, 7);
  const parsedManifest = JSON.parse(suite.manifestJson);
  assert.strictEqual(parsedManifest.name, "Test App");
  assert.ok(suite.htmlHeadSnippet.includes("<link rel=\"manifest\" href=\"/manifest.json\">"));
});
