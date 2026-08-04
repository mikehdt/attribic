/**
 * WD14 Tagger Provider
 * Anime/illustration focused image tagging using SmilingWolf's models
 */

import type { TaggerProvider } from '../../types';
import { WD14_MODELS } from './models';

export const wd14Provider: TaggerProvider = {
  id: 'wd14',
  name: 'Image Tagging',
  description:
    'Imageboard-style tag classification. Produces structured tags for anime/illustration training.',
  providerType: 'onnx',
  models: WD14_MODELS,
};
