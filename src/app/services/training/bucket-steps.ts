/**
 * Steps per epoch, accounting for aspect-ratio bucketing.
 *
 * An epoch is not `images / batch`. The trainers group images into
 * aspect-ratio buckets and batch *within* each bucket, so every bucket rounds
 * its own partial batch up to a whole step. Fifteen images at batch 2 is 8
 * steps if they all share a shape and 10 once they spread across six buckets —
 * a 25% difference in the real length of the run, and one that grows with the
 * variety of the dataset.
 *
 * Dividing the whole dataset by the batch size (as this used to) is wrong in
 * two compounding ways: it drops each epoch's partial batch, and it ignores
 * bucketing entirely. That undercount then propagates into everything derived
 * from a step total — the sampling tally, predicted marker positions, and the
 * step count sent to step-driven backends.
 *
 * The bucket maths here mirrors sd-scripts (`library/model_util.py`
 * `make_bucket_resolutions` and `library/dataset.py` `BucketManager.
 * select_bucket`), which is what Kohya and Musubi both run; `_length` there is
 * literally `Σ ceil(len(bucket) / batch_size)`, which is what
 * {@link bucketedStepsPerEpoch} returns. ai-toolkit buckets too but by its own
 * rules, so for that backend this is an estimate rather than an exact count —
 * still far closer than a flat division, since the round-up-per-bucket effect
 * is what dominates.
 */

/** `WxH` → number of images that size, as the dataset scan records them. */
type SizeHistogram = Record<string, number>;

/** sd-scripts' bucket floor, mirroring `DEFAULT_MIN_BUCKET_RESO` in the sidecar. */
const DEFAULT_MIN_BUCKET_RESO = 256;

type Reso = readonly [number, number];

type BucketedStepsInput = {
  /** Trained folders only — zero-repeat folders never reach the dataloader. */
  folders: { histogram: SizeHistogram | undefined; effectiveImages: number }[];
  batchSize: number;
  /** Training resolution(s); the largest sets the bucket area. */
  resolution: number[];
  /** Kohya-only exact `WxH`. Non-empty turns bucketing off entirely. */
  nativeResolution: string;
  bucketResoSteps: number;
  bucketNoUpscale: boolean;
};

/** Python's `int(x + 0.5) - (int(x + 0.5) % steps)`. */
const roundToSteps = (x: number, steps: number): number => {
  const i = Math.floor(x + 0.5);
  return i - (i % steps);
};

/**
 * The candidate bucket shapes, as `make_bucket_resolutions` builds them: every
 * `divisible`-aligned width from `minSize` to `maxSize` paired with the tallest
 * height that keeps the area under the training resolution's, plus each pair
 * transposed. Sorted by (width, height) so the nearest-aspect search below
 * resolves ties the same way `argmin` does on the Python side.
 */
function makeBucketResolutions(
  maxReso: Reso,
  minSize: number,
  maxSize: number,
  divisible: number,
): Reso[] {
  const maxArea = maxReso[0] * maxReso[1];
  const seen = new Set<string>();
  const resos: Reso[] = [];

  const add = (w: number, h: number) => {
    const key = `${w}x${h}`;
    if (seen.has(key)) return;
    seen.add(key);
    resos.push([w, h]);
  };

  const square = Math.floor(Math.sqrt(maxArea) / divisible) * divisible;
  add(square, square);

  for (let width = minSize; width <= maxSize; width += divisible) {
    const height = Math.min(
      maxSize,
      Math.floor(Math.floor(maxArea / width) / divisible) * divisible,
    );
    if (height >= minSize) {
      add(width, height);
      add(height, width);
    }
  }

  resos.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return resos;
}

/**
 * The bucket an image lands in. With upscaling allowed the bucket *is* the
 * predefined shape closest in aspect ratio (an exact size match wins outright);
 * with `bucketNoUpscale` the image keeps its own size, shrunk under the area
 * cap if need be and floored to the step grid, so the buckets are whatever the
 * dataset happens to contain.
 */
function selectBucket(
  width: number,
  height: number,
  resos: Reso[],
  resoKeys: Set<string>,
  maxArea: number,
  resoSteps: number,
  noUpscale: boolean,
): string {
  const aspect = width / height;

  if (!noUpscale) {
    if (resoKeys.has(`${width}x${height}`)) return `${width}x${height}`;
    let best = resos[0];
    let bestError = Infinity;
    for (const reso of resos) {
      const error = Math.abs(reso[0] / reso[1] - aspect);
      if (error < bestError) {
        bestError = error;
        best = reso;
      }
    }
    return `${best[0]}x${best[1]}`;
  }

  let resized: Reso = [width, height];
  if (width * height > maxArea) {
    const resizedWidth = Math.sqrt(maxArea * aspect);
    const resizedHeight = maxArea / resizedWidth;

    // Round whichever side keeps the aspect ratio closer — the same tie-break
    // sd-scripts uses, so the two agree on which bucket an odd size falls in.
    const widthRounded = roundToSteps(resizedWidth, resoSteps);
    const heightInWr = roundToSteps(widthRounded / aspect, resoSteps);
    const heightRounded = roundToSteps(resizedHeight, resoSteps);
    const widthInHr = roundToSteps(heightRounded * aspect, resoSteps);

    const arWidthRounded = heightInWr > 0 ? widthRounded / heightInWr : Infinity;
    const arHeightRounded =
      heightRounded > 0 ? widthInHr / heightRounded : Infinity;

    resized =
      Math.abs(arWidthRounded - aspect) < Math.abs(arHeightRounded - aspect)
        ? [widthRounded, Math.floor(widthRounded / aspect + 0.5)]
        : [Math.floor(heightRounded * aspect + 0.5), heightRounded];
  }

  return `${resized[0] - (resized[0] % resoSteps)}x${
    resized[1] - (resized[1] % resoSteps)
  }`;
}

/** `1280x768` → `[1280, 768]`; anything else → null. */
function parseSize(key: string): Reso | null {
  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(key.trim());
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? [w, h] : null;
}

/**
 * Steps in one epoch: `Σ ceil(bucket images / batch size)`.
 *
 * Folders share one bucket set — the sidecar writes every folder as a subset of
 * a single `[[datasets]]` entry, and sd-scripts gives each entry one bucket
 * manager. A folder with no scanned histogram is counted as a single bucket of
 * its own, which is the floor rather than a guess.
 *
 * Returns 0 when there's nothing to train on, so callers can keep treating 0 as
 * "no dataset yet".
 */
export function bucketedStepsPerEpoch({
  folders,
  batchSize,
  resolution,
  nativeResolution,
  bucketResoSteps,
  bucketNoUpscale,
}: BucketedStepsInput): number {
  const batch = Math.max(1, batchSize);
  const trained = folders.filter((f) => f.effectiveImages > 0);
  if (trained.length === 0) return 0;

  const totalEffective = trained.reduce((sum, f) => sum + f.effectiveImages, 0);

  // A pinned exact size means one fixed bucket — every image trains at WxH.
  if (parseSize(nativeResolution)) return Math.ceil(totalEffective / batch);

  const maxRes = resolution.length > 0 ? Math.max(...resolution) : 1024;
  const minRes = resolution.length > 0 ? Math.min(...resolution) : maxRes;
  const minSize =
    resolution.length > 1 ? minRes : Math.min(DEFAULT_MIN_BUCKET_RESO, maxRes);
  const resoSteps = bucketResoSteps > 0 ? bucketResoSteps : 64;
  const maxArea = maxRes * maxRes;

  const resos = makeBucketResolutions([maxRes, maxRes], minSize, maxRes, resoSteps);
  const resoKeys = new Set(resos.map(([w, h]) => `${w}x${h}`));

  const counts = new Map<string, number>();
  const bump = (key: string, n: number) =>
    counts.set(key, (counts.get(key) ?? 0) + n);

  for (const folder of trained) {
    const entries = Object.entries(folder.histogram ?? {});
    const scanned = entries.reduce((sum, [, n]) => sum + n, 0);
    if (scanned === 0) {
      // Unscanned: its own bucket, so it still costs at least one step.
      bump(`unscanned:${counts.size}`, folder.effectiveImages);
      continue;
    }

    // Repeats multiply bucket membership (sd-scripts adds each image
    // `num_repeats` times), and the histogram is the un-repeated count.
    const repeats = folder.effectiveImages / scanned;
    for (const [size, count] of entries) {
      const parsed = parseSize(size);
      if (!parsed) {
        bump(`unparsed:${size}`, count * repeats);
        continue;
      }
      bump(
        selectBucket(
          parsed[0],
          parsed[1],
          resos,
          resoKeys,
          maxArea,
          resoSteps,
          bucketNoUpscale,
        ),
        count * repeats,
      );
    }
  }

  let steps = 0;
  for (const count of counts.values()) steps += Math.ceil(count / batch);
  return Math.max(1, steps);
}
