/**
 * API Route: GET /api/model-manager/scan
 *
 * Scans the models folder for .model.json sidecars.
 * Supports filtering by architecture via query param.
 *
 * GET /api/model-manager/scan?architecture=flux
 */

import fs from 'fs';
import { NextRequest } from 'next/server';
import path from 'path';

import { getModelsFolder } from '@/app/services/config/server-config';
import type { ModelSidecar } from '@/app/services/model-manager/types';

type ScannedModel = ModelSidecar & {
  filePath: string;
  fileSize: number;
};

/**
 * Recursively scan a directory for .model.json sidecar files.
 */
function scanForSidecars(dir: string): ScannedModel[] {
  const results: ScannedModel[] = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...scanForSidecars(fullPath));
    } else if (entry.name.endsWith('.model.json')) {
      try {
        const sidecar: ModelSidecar = JSON.parse(
          fs.readFileSync(fullPath, 'utf8'),
        );

        // Find the associated model file (sidecar name without .model.json)
        const modelFileName = entry.name.replace('.model.json', '');
        const modelFilePath = path.join(dir, modelFileName);
        let fileSize = 0;
        if (fs.existsSync(modelFilePath)) {
          fileSize = fs.statSync(modelFilePath).size;
        }

        results.push({
          ...sidecar,
          filePath: modelFilePath,
          fileSize,
        });
      } catch {
        // Skip invalid sidecar files
      }
    }
  }

  return results;
}

export async function GET(request: NextRequest) {
  try {
    const modelsFolder = getModelsFolder();
    const architecture = request.nextUrl.searchParams.get('architecture');

    let models = scanForSidecars(modelsFolder);

    if (architecture) {
      models = models.filter((m) => m.architecture === architecture);
    }

    return Response.json({ models, modelsFolder });
  } catch (error) {
    console.error('Scan error:', error);
    return Response.json({ error: 'Failed to scan models' }, { status: 500 });
  }
}
