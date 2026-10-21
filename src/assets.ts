import type { Object3D } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

// The artist's files (D-022) are listed in public/assets/manifest.json and fetched at boot, before the title
// screen (REQ-009). The list is empty until the models arrive; the model factories keep their simple shapes
// until they ask `assets` for a model by id.

export interface ManifestFile {
  /** What the game code asks for, e.g. "rov". */
  id: string;
  /** Path of a .glb/.gltf file, relative to the manifest. */
  url: string;
}

/** A file the game cannot start without could not be loaded. */
export class AssetLoadError extends Error {}

/** The loaded models, looked up by manifest id. */
export class AssetLibrary {
  private readonly scenes = new Map<string, Object3D>();

  add(id: string, scene: Object3D): void {
    this.scenes.set(id, scene);
  }

  has(id: string): boolean {
    return this.scenes.has(id);
  }

  /** A fresh copy of the model, safe to add to a scene and to move; null when the manifest has no such id. */
  model(id: string): Object3D | null {
    const scene = this.scenes.get(id);
    return scene ? clone(scene) : null;
  }

  clear(): void {
    this.scenes.clear();
  }
}

/** The library the model factories read from. */
export const assets = new AssetLibrary();

export interface LoaderOptions {
  /** Where the manifest is; model paths are relative to it. */
  manifestUrl: string;
  fetchJson: (url: string) => Promise<unknown>;
  /** Loads one model and reports its progress as a fraction between 0 and 1. */
  loadModel: (url: string, onProgress: (fraction: number) => void) => Promise<Object3D>;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new AssetLoadError(`${url}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new AssetLoadError(`${url}: not valid JSON`);
  }
}

async function loadModel(url: string, onProgress: (fraction: number) => void): Promise<Object3D> {
  // Loaded on demand, so a build with an empty manifest never downloads the glTF parser.
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(url, (event) => {
    if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
  });
  return gltf.scene;
}

const defaultOptions = (): LoaderOptions => ({
  manifestUrl: new URL("assets/manifest.json", document.baseURI).href,
  fetchJson,
  loadModel,
});

/** Checks the manifest's shape; a typo in the file should name itself, not fail later as a missing model. */
export function parseManifest(data: unknown): ManifestFile[] {
  const files = (data as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) throw new AssetLoadError('manifest: "files" must be a list');
  const ids = new Set<string>();
  return files.map((file: unknown, index) => {
    const { id, url } = (file ?? {}) as Partial<ManifestFile>;
    if (typeof id !== "string" || typeof url !== "string" || !id || !url) {
      throw new AssetLoadError(`manifest: file ${index} needs an "id" and a "url"`);
    }
    if (ids.has(id)) throw new AssetLoadError(`manifest: id "${id}" is listed twice`);
    if (!/\.(glb|gltf)$/i.test(url)) throw new AssetLoadError(`manifest: ${url} is not a .glb or .gltf file`);
    ids.add(id);
    return { id, url };
  });
}

/**
 * Fetches the manifest and every model in it, in parallel, into `library`. `onProgress` gets the overall
 * fraction (0 to 1, never going back); each file counts the same. Rejects with an AssetLoadError as soon
 * as the manifest or one file cannot be loaded.
 */
export async function loadAssets(
  onProgress: (fraction: number) => void,
  options: Partial<LoaderOptions> = {},
  library: AssetLibrary = assets,
): Promise<void> {
  const { manifestUrl, fetchJson, loadModel } = { ...defaultOptions(), ...options };
  onProgress(0);
  let files: ManifestFile[];
  try {
    files = parseManifest(await fetchJson(manifestUrl));
  } catch (error) {
    throw error instanceof AssetLoadError ? error : new AssetLoadError(`${manifestUrl}: ${String(error)}`);
  }

  const done = files.map(() => 0);
  let reported = 0;
  const report = () => {
    reported = Math.max(reported, done.reduce((sum, fraction) => sum + fraction, 0) / files.length);
    onProgress(reported);
  };
  await Promise.all(
    files.map(async ({ id, url }, index) => {
      const absolute = new URL(url, manifestUrl).href;
      try {
        const scene = await loadModel(absolute, (fraction) => {
          done[index] = Math.min(Math.max(fraction, done[index]), 0.99);
          report();
        });
        library.add(id, scene);
      } catch (error) {
        throw error instanceof AssetLoadError ? error : new AssetLoadError(`${absolute}: ${String(error)}`);
      }
      done[index] = 1;
      report();
    }),
  );
  onProgress(1);
}
