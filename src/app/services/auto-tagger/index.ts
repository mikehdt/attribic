/**
 * Auto-Tagger Service
 * Main exports for the auto-tagger functionality
 *
 * NOTE: This file only exports types and client-safe utilities.
 * Server-side code (model-manager, providers) should be imported directly
 * in API routes where they are needed.
 */

// Types (safe for both client and server)
export type {
  AutoTaggerSettings,
  ProviderType,
  TaggerOptions,
  TaggingSseEvent,
  TagInsertMode,
  TagResult,
  TriggerPhraseInsertMode,
  VlmOptions,
  VlmVideoQuality,
} from './types';
// VLM_VIDEO_QUALITY_PIXELS is deliberately not re-exported — its only consumer
// (the VLM client) sits beside it and imports from './types' directly.
export { DEFAULT_TAGGER_OPTIONS, DEFAULT_VLM_OPTIONS } from './types';

// Model Registry (client-safe utilities - no fs operations)
export {
  getAllModels,
  getAllProviders,
  getModel,
  getModelTotalSize,
  getProviderTypeForModel,
} from './model-registry';

// NOTE: model-manager and providers use Node.js fs module and should only
// be imported in server-side code (API routes). Import them directly:
// import { checkModelStatus, ... } from '@/app/services/auto-tagger/model-manager';
// import { wd14Provider } from '@/app/services/auto-tagger/providers/wd14';
