import fs from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';

// Configuration interface
interface AppConfig {
  batchSize?: number;
  projectsFolder?: string;
  infoFolder?: string;
  modelsFolder?: string;
  hfToken?: string;
  startSidecarOnLaunch?: boolean;
  trainingBackends?: Record<string, string>;
}

function getConfigPath() {
  return path.join(process.cwd(), 'config.json');
}

function readConfig(): Record<string, unknown> {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

/** Mask a token for client display — keep first 4 / last 4, redact the middle. */
function maskToken(token: string): string {
  if (token.length <= 10) return '••••••••';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export async function GET() {
  try {
    const config = readConfig() as AppConfig;
    // Never send the raw HF token to the client — only a masked preview.
    const { hfToken, ...rest } = config;
    return NextResponse.json({
      ...rest,
      hfTokenMasked: hfToken ? maskToken(hfToken) : null,
      hasHfToken: !!hfToken,
    });
  } catch (error) {
    console.warn('Failed to load config.json:', error);
    return NextResponse.json({}, { status: 500 });
  }
}

/** POST — update top-level config fields. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AppConfig>;
    const config = readConfig();

    if (body.projectsFolder !== undefined) {
      const folder = body.projectsFolder.trim();

      if (!folder) {
        return NextResponse.json(
          { error: 'Projects folder path cannot be empty' },
          { status: 400 },
        );
      }

      // Verify the folder exists on disk
      if (!fs.existsSync(folder)) {
        return NextResponse.json(
          { error: `Folder does not exist: ${folder}` },
          { status: 400 },
        );
      }

      config.projectsFolder = folder;
    }

    if (body.startSidecarOnLaunch !== undefined) {
      config.startSidecarOnLaunch = !!body.startSidecarOnLaunch;
    }

    if (body.trainingBackends !== undefined) {
      // Per-key merge: only the submitted backends change, an empty string
      // clears that backend, and untouched entries survive.
      const existing =
        config.trainingBackends &&
        typeof config.trainingBackends === 'object' &&
        !Array.isArray(config.trainingBackends)
          ? (config.trainingBackends as Record<string, string>)
          : {};

      for (const [key, value] of Object.entries(body.trainingBackends)) {
        const folder = typeof value === 'string' ? value.trim() : '';
        if (!folder) {
          delete existing[key];
          continue;
        }
        if (!fs.existsSync(folder)) {
          return NextResponse.json(
            { error: `Folder does not exist: ${folder}` },
            { status: 400 },
          );
        }
        existing[key] = folder;
      }

      if (Object.keys(existing).length > 0) {
        config.trainingBackends = existing;
      } else {
        delete config.trainingBackends;
      }
    }

    if (body.hfToken !== undefined) {
      const trimmed = body.hfToken.trim();
      // Empty string clears the token
      if (trimmed === '') {
        delete config.hfToken;
      } else {
        config.hfToken = trimmed;
      }
    }

    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');

    // Mirror the GET response shape so the client can update its view
    const { hfToken, ...rest } = config as AppConfig;
    return NextResponse.json({
      ...rest,
      hfTokenMasked: hfToken ? maskToken(hfToken) : null,
      hasHfToken: !!hfToken,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
