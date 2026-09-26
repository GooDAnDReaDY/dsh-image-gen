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


test("GH#8 and GH#9: generate_image output schema permits attachment, qualityReport, object _fallback, and golden payloads", async () => {
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

  // GH#9 regression check: _fallback must be an object schema matching runtime shape from fallback-router.js
  assert.strictEqual(schema.properties._fallback.type, "object", "top-level _fallback must be declared as object (GH#9)");
  assert.strictEqual(schema.properties._fallback.properties.triggered.type, "boolean");
  assert.strictEqual(schema.properties._fallback.properties.primaryProvider.type, "string");
  assert.strictEqual(schema.properties._fallback.properties.providerUsed.type, "string");
  assert.strictEqual(schema.properties._fallback.properties.attempts.type, "array");

  const itemProps = schema.properties.images.items.properties;
  assert.ok(itemProps.attachment, "images.items must declare attachment");
  assert.strictEqual(itemProps.attachment.additionalProperties, true, "images.items.attachment must allow additionalProperties");
  assert.ok(itemProps.qualityReport, "images.items must declare qualityReport");
  assert.ok(itemProps._fallback, "images.items must declare _fallback");
  assert.strictEqual(itemProps._fallback.type, "object", "images.items._fallback must be declared as object (GH#9)");
  assert.strictEqual(itemProps._fallback.properties.triggered.type, "boolean");
  assert.strictEqual(itemProps._fallback.properties.primaryProvider.type, "string");
  assert.strictEqual(itemProps._fallback.properties.providerUsed.type, "string");
  assert.strictEqual(itemProps._fallback.properties.attempts.type, "array");
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
    } else if (s.type === "string") {
      if (typeof val !== "string") errors.push(path + " must be a string, got " + typeof val);
    } else if (s.type === "boolean") {
      if (typeof val !== "boolean") errors.push(path + " must be a boolean, got " + typeof val);
    } else if (s.type === "number" || s.type === "integer") {
      if (typeof val !== "number") errors.push(path + " must be a number, got " + typeof val);
    }
    return errors;
  }

  // Golden Payload 1: Primary provider success (e.g. local ComfyUI)
  const primaryPayload = {
    summary: "Generated image",
    channel: "local",
    provider: "local",
    model: "dreamshaper_8.safetensors",
    _fallback: {
      triggered: false,
      primaryProvider: "local",
      providerUsed: "local",
      attempts: [
        { provider: "local", durationMs: 4700, success: true },
      ],
    },
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
        _fallback: {
          triggered: false,
          primaryProvider: "local",
          providerUsed: "local",
          attempts: [
            { provider: "local", durationMs: 4700, success: true },
          ],
        },
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

  const primaryErrors = validateAgainstSchema(primaryPayload, schema, "value");
  assert.deepStrictEqual(primaryErrors, [], "primary golden payload must have 0 schema errors, got: " + primaryErrors.join(", "));

  // Golden Payload 2: Fallback provider cascade success (e.g. fal failed, local succeeded)
  const fallbackPayload = {
    summary: "Generated image via fallback",
    channel: "local",
    provider: "local",
    model: "v1-5-pruned-emaonly.safetensors",
    _fallback: {
      triggered: true,
      primaryProvider: "fal",
      providerUsed: "local",
      attempts: [
        { provider: "fal", error: "FAL_API_KEY environment variable is not set", durationMs: 12, success: false },
        { provider: "local", durationMs: 3400, success: true },
      ],
    },
    path: "/tmp/fallback.png",
    url: "http://127.0.0.1:7860/file=fallback.png",
    width: 512,
    height: 512,
    seed: 54321,
    prompt: "cyberpunk skyline",
    originalPrompt: "cyberpunk skyline",
    format: "png",
    cost: 0,
    fromCache: false,
    qualityReport: { score: 90, passed: true },
    images: [
      {
        path: "/tmp/fallback.png",
        url: "http://127.0.0.1:7860/file=fallback.png",
        width: 512,
        height: 512,
        seed: 54321,
        prompt: "cyberpunk skyline",
        originalPrompt: "cyberpunk skyline",
        format: "png",
        cost: 0,
        fromCache: false,
        qualityReport: { score: 90, passed: true },
        _fallback: {
          triggered: true,
          primaryProvider: "fal",
          providerUsed: "local",
          attempts: [
            { provider: "fal", error: "FAL_API_KEY environment variable is not set", durationMs: 12, success: false },
            { provider: "local", durationMs: 3400, success: true },
          ],
        },
        provider: "local",
        model: "v1-5-pruned-emaonly.safetensors",
      },
    ],
  };

  const fallbackErrors = validateAgainstSchema(fallbackPayload, schema, "value");
  assert.deepStrictEqual(fallbackErrors, [], "fallback golden payload must have 0 schema errors, got: " + fallbackErrors.join(", "));
});

