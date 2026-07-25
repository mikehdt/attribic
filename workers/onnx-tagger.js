/**
 * Worker thread for ONNX WD14 image tagging.
 *
 * Runs inference off the main Next.js event loop so the dev server
 * and UI stay responsive during batch tagging operations.
 *
 * Messages in:
 *   { type: 'tag', imagePath, modelId, provider, options }
 *   { type: 'unload' }  — release cached session/labels
 *
 * Messages out:
 *   { type: 'result', tags: { general, character, rating } }
 *   { type: 'error', error: string }
 *   { type: 'ready' }
 */

'use strict';

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');

// workerData provides the resolved models folder — the worker can't read
// config.json itself (that's server-config's job), so the manager passes it in
const MODELS_DIR = workerData.modelsDir;

// Lazy-loaded native modules (loaded on first use)
let ort = null;
let sharp = null;

function loadNativeModules() {
  if (!ort) ort = require('onnxruntime-node');
  if (!sharp) sharp = require('sharp');
}

// ---------------------------------------------------------------------------
// Model path resolution (mirrors model-manager.ts getModelFilePath)
// ---------------------------------------------------------------------------

function getModelFilePath(provider, modelId, fileName) {
  return path.join(MODELS_DIR, provider, modelId, fileName);
}

// ---------------------------------------------------------------------------
// Session and label caches (per-worker, persist across messages)
// ---------------------------------------------------------------------------

/** @type {Map<string, import('onnxruntime-node').InferenceSession>} */
const sessionCache = new Map();

/** @type {Map<string, { names: string[], ratingIndices: number[], generalIndices: number[], characterIndices: number[] }>} */
const tagLabelCache = new Map();

// ---------------------------------------------------------------------------
// Execution provider selection
// ---------------------------------------------------------------------------

/**
 * Pick the best available execution provider.
 * Tries DirectML (Windows GPU) first, then CUDA, then falls back to CPU.
 */
async function pickExecutionProviders() {
  const candidates = [];

  // DirectML — Windows GPU acceleration (AMD, Intel, NVIDIA)
  if (process.platform === 'win32') {
    candidates.push('dml');
  }

  // CUDA — NVIDIA GPU (requires CUDA toolkit + cuDNN)
  candidates.push('cuda');

  // Always fall back to CPU
  candidates.push('cpu');

  // onnxruntime will try each in order and skip unavailable ones
  return candidates;
}

// ---------------------------------------------------------------------------
// Tag label loading (mirrors inference.ts loadTagLabels)
// ---------------------------------------------------------------------------

function loadTagLabels(provider, modelId) {
  const cacheKey = modelId;
  const cached = tagLabelCache.get(cacheKey);
  if (cached) return cached;

  const csvPath = getModelFilePath(provider, modelId, 'selected_tags.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.trim().split('\n');

  const names = [];
  const ratingIndices = [];
  const generalIndices = [];
  const characterIndices = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length >= 3) {
      const modelIndex = i - 1;
      const name = parts[1];
      const category = parseInt(parts[2], 10);

      names[modelIndex] = name;

      switch (category) {
        case 0:
          generalIndices.push(modelIndex);
          break;
        case 4:
          characterIndices.push(modelIndex);
          break;
        case 9:
          ratingIndices.push(modelIndex);
          break;
      }
    }
  }

  const labels = { names, ratingIndices, generalIndices, characterIndices };
  tagLabelCache.set(cacheKey, labels);
  return labels;
}

// ---------------------------------------------------------------------------
// ONNX session management
// ---------------------------------------------------------------------------

async function getSession(provider, modelId) {
  const cached = sessionCache.get(modelId);
  if (cached) return cached;

  const modelPath = getModelFilePath(provider, modelId, 'model.onnx');
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model file not found: ${modelPath}`);
  }

  const executionProviders = await pickExecutionProviders();
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders,
  });

  sessionCache.set(modelId, session);
  return session;
}

// ---------------------------------------------------------------------------
// Image preprocessing (mirrors preprocessing.ts)
// ---------------------------------------------------------------------------

const IMAGE_SIZE = 448;

async function preprocessImage(imagePath) {
  const image = sharp(imagePath);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image dimensions: ${imagePath}`);
  }

  const maxDim = Math.max(metadata.width, metadata.height);

  const resized = await image
    .resize(IMAGE_SIZE, IMAGE_SIZE, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255 },
      kernel:
        maxDim > IMAGE_SIZE ? sharp.kernel.lanczos3 : sharp.kernel.lanczos2,
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  const float32Data = new Float32Array(IMAGE_SIZE * IMAGE_SIZE * 3);

  for (let i = 0; i < IMAGE_SIZE * IMAGE_SIZE; i++) {
    const srcIdx = i * 3;
    const dstIdx = i * 3;
    // RGB to BGR
    float32Data[dstIdx] = resized[srcIdx + 2];
    float32Data[dstIdx + 1] = resized[srcIdx + 1];
    float32Data[dstIdx + 2] = resized[srcIdx];
  }

  return float32Data;
}

// ---------------------------------------------------------------------------
// Tag processing (mirrors inference.ts process* functions)
// ---------------------------------------------------------------------------

function processRating(probabilities, labels) {
  const results = [];
  for (const idx of labels.ratingIndices) {
    if (idx < probabilities.length) {
      results.push({ tag: labels.names[idx], confidence: probabilities[idx] });
    }
  }
  return results.sort((a, b) => b.confidence - a.confidence);
}

function processGeneral(probabilities, labels, options) {
  const results = [];
  const excludeSet = new Set(options.excludeTags || []);

  for (const idx of labels.generalIndices) {
    if (
      idx < probabilities.length &&
      probabilities[idx] >= options.generalThreshold
    ) {
      let tag = labels.names[idx];
      if (options.removeUnderscore) tag = tag.replace(/_/g, ' ');
      if (!excludeSet.has(tag)) {
        results.push({ tag, confidence: probabilities[idx] });
      }
    }
  }
  return results.sort((a, b) => b.confidence - a.confidence);
}

function processCharacter(probabilities, labels, options) {
  const results = [];
  const excludeSet = new Set(options.excludeTags || []);

  for (const idx of labels.characterIndices) {
    if (
      idx < probabilities.length &&
      probabilities[idx] >= options.characterThreshold
    ) {
      let tag = labels.names[idx];
      if (options.removeUnderscore) tag = tag.replace(/_/g, ' ');
      if (!excludeSet.has(tag)) {
        results.push({ tag, confidence: probabilities[idx] });
      }
    }
  }
  return results.sort((a, b) => b.confidence - a.confidence);
}

// ---------------------------------------------------------------------------
// Main inference entry point
// ---------------------------------------------------------------------------

async function tagImage(provider, modelId, imagePath, options) {
  loadNativeModules();

  const session = await getSession(provider, modelId);
  const labels = loadTagLabels(provider, modelId);

  const imageData = await preprocessImage(imagePath);
  const inputTensor = new ort.Tensor('float32', imageData, [
    1,
    IMAGE_SIZE,
    IMAGE_SIZE,
    3,
  ]);

  const inputName = session.inputNames[0];
  const results = await session.run({ [inputName]: inputTensor });

  const outputName = session.outputNames[0];
  const output = results[outputName];
  const probabilities = output.data;

  return {
    rating: processRating(probabilities, labels),
    general: processGeneral(probabilities, labels, options),
    character: processCharacter(probabilities, labels, options),
  };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'tag') {
      const result = await tagImage(
        msg.provider,
        msg.modelId,
        msg.imagePath,
        msg.options,
      );
      parentPort.postMessage({ type: 'result', tags: result });
    } else if (msg.type === 'unload') {
      // Release cached sessions to free memory/GPU
      for (const session of sessionCache.values()) {
        try {
          await session.release();
        } catch {
          // best-effort cleanup
        }
      }
      sessionCache.clear();
      tagLabelCache.clear();
      parentPort.postMessage({ type: 'unloaded' });
    }
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// Signal ready
parentPort.postMessage({ type: 'ready' });
