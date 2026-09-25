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


test("GH#8: generate_image output schema permits attachment, qualityReport, fallback, and extra properties", async () => {
  const { registerGenerationTools } = await import("../lib/tools/generation.js");
  const registeredTools = [];
  const mockCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (tool) => { registeredTools.push(tool); },
    },
    get: () => null,
  };
  const mockDeps = {
    config: { enabled: true, provider: "fal", enhancePrompt: false, defaultFormat: "png" },
    live: () => ({ provider: "fal" }),
    resolveSource: async () => undefined,
    slugify: () => "test",
    resolveApiKey: () => "test-key",
  };
  registerGenerationTools(mockCtx, mockDeps);
  const tool = registeredTools.find((t) => t.name === "generate_image");
  assert.ok(tool, "generate_image tool must be registered");
  assert.ok(tool.output?.schema, "tool must have output.schema");

  const schema = tool.output.schema;
  assert.strictEqual(schema.additionalProperties, true, "top-level schema must allow additionalProperties");
  assert.strictEqual(schema.properties.attachment.additionalProperties, true, "top-level attachment must allow additionalProperties");
  assert.strictEqual(schema.properties.images.items.additionalProperties, true, "images items must allow additionalProperties (GH#8)");

  const itemProps = schema.properties.images.items.properties;
  assert.ok(itemProps.attachment, "images.items must declare attachment");
  assert.strictEqual(itemProps.attachment.additionalProperties, true, "images.items.attachment must allow additionalProperties");
  assert.ok(itemProps.qualityReport, "images.items must declare qualityReport");
  assert.ok(itemProps._fallback, "images.items must declare _fallback");
  assert.ok(itemProps.cost, "images.items must declare cost");
  assert.ok(itemProps.fromCache, "images.items must declare fromCache");
  assert.ok(itemProps.originalPrompt, "images.items must declare originalPrompt");
  assert.ok(itemProps.provider, "images.items must declare provider");
  assert.ok(itemProps.model, "images.items must declare model");

  function validateAgainstSchema(val, s, path = "root") {
    if (!s || typeof s !== "object") return [];
    const errors = [];
    if (s.type === "object") {
      if (typeof val !== "object" || val === null || Array.isArray(val)) {
        errors.push(path + ": expected object, got " + typeof val);
        return errors;
      }
      if (s.additionalProperties === false) {
        for (const k of Object.keys(val)) {
          if (!s.properties || !(k in s.properties)) {
            errors.push(path + "." + k + " is not a declared property (additionalProperties: false)");
          }
        }
      }
      if (s.properties) {
        for (const [k, propSchema] of Object.entries(s.properties)) {
          if (k in val && val[k] !== undefined) {
            errors.push(...validateAgainstSchema(val[k], propSchema, path + "." + k));
          }
        }
      }
    } else if (s.type === "array") {
      if (!Array.isArray(val)) {
        errors.push(path + ": expected array, got " + typeof val);
        return errors;
      }
      if (s.items) {
        val.forEach((item, idx) => {
          errors.push(...validateAgainstSchema(item, s.items, path + "[" + idx + "]"));
        });
      }
    }
    return errors;
  }

  const realisticPayload = {
    summary: "Generated image",
    channel: "local",
    provider: "local",
    model: "dreamshaper_8.safetensors",
    _fallback: "local",
    path: "/tmp/generated.png",
    url: "http://127.0.0.1:8188/view?filename=generated.png",
    width: 512,
    height: 512,
    seed: 12345,
    prompt: "a cat in space",
    originalPrompt: "a cat in space",
    format: "png",
    cost: 0,
    fromCache: false,
    qualityReport: { score: 95, passed: true },
    attachment: {
      attachmentId: "att-123",
      mediaType: "image/png",
      bytes: 268819,
      width: 512,
      height: 512,
      name: "generated.png",
    },
    images: [
      {
        path: "/tmp/generated.png",
        url: "http://127.0.0.1:8188/view?filename=generated.png",
        width: 512,
        height: 512,
        seed: 12345,
        prompt: "a cat in space",
        originalPrompt: "a cat in space",
        format: "png",
        cost: 0,
        fromCache: false,
        qualityReport: { score: 95, passed: true },
        _fallback: "local",
        provider: "local",
        model: "dreamshaper_8.safetensors",
        attachment: {
          attachmentId: "att-123",
          mediaType: "image/png",
          bytes: 268819,
          width: 512,
          height: 512,
          name: "generated.png",
        },
      },
    ],
  };

  const validationErrors = validateAgainstSchema(realisticPayload, schema, "value");
  assert.deepStrictEqual(validationErrors, [], "realistic payload must have 0 schema errors, got: " + validationErrors.join(", "));
});
