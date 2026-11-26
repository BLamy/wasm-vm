// E5-T36: recover the hotspot of a guest cursor image the device did not describe.
//
// A compositor on legacy KMS (wlroots with WLR_DRM_NO_ATOMIC) sets the cursor image without a
// hotspot and instead moves the cursor plane to "pointer minus hotspot". The host, which draws
// the image at the real pointer, therefore needs the hotspot — and can work it out: it knows the
// guest-space positions it sent, and every plane position the guest reports is one of them minus
// the hotspot. Each reported position turns the recent sent positions into candidate hotspots;
// the true one is a candidate every time, so intersecting the candidate sets of a few moves to
// different places leaves it alone. Lag, coalesced or dropped moves only shrink how recent the
// matching sent position is; they never remove the true candidate while it is still in history.

const DEFAULT_HISTORY = 128;
const DEFAULT_TOLERANCE = 1;
const DEFAULT_CONFIRMATIONS = 2;
// Images remembered at once. A desktop uses a dozen cursor shapes; a page that animates a custom
// cursor could produce any number, and each key is the image's whole data URL.
const DEFAULT_MAX_IMAGES = 64;

function int32(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${name} must be a finite number`);
  // virtio carries plane positions as u32; a position left of or above the origin wraps.
  return number | 0;
}

function near(a, b, tolerance) {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

export class CursorHotspotEstimator {
  constructor({ history = DEFAULT_HISTORY, tolerance = DEFAULT_TOLERANCE,
    confirmations = DEFAULT_CONFIRMATIONS, maxImages = DEFAULT_MAX_IMAGES } = {}) {
    if (!Number.isSafeInteger(history) || history < 2) throw new RangeError("history must be an integer >= 2");
    if (!Number.isSafeInteger(tolerance) || tolerance < 0) throw new RangeError("tolerance must be an integer >= 0");
    if (!Number.isSafeInteger(confirmations) || confirmations < 2) {
      throw new RangeError("confirmations must be an integer >= 2");
    }
    if (!Number.isSafeInteger(maxImages) || maxImages < 1) throw new RangeError("maxImages must be an integer >= 1");
    this._maxImages = maxImages;
    this._history = history;
    this._tolerance = tolerance;
    this._confirmations = confirmations;
    this._sent = [];
    this._images = new Map();
  }

  /** A guest-space pointer position the host has just sent to the guest. */
  notePointer(x, y) {
    const point = { x: int32(x, "pointer x"), y: int32(y, "pointer y") };
    const last = this._sent[this._sent.length - 1];
    if (last && last.x === point.x && last.y === point.y) return;
    this._sent.push(point);
    if (this._sent.length > this._history) this._sent.shift();
  }

  /**
   * The guest placed the plane showing image `key` (`width`×`height`) at (`x`, `y`).
   * Returns the image's hotspot `{x, y}` once it is determined, otherwise `null`.
   */
  noteMove(key, width, height, x, y) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw new RangeError("cursor image size must be positive integers");
    }
    const plane = { x: int32(x, "plane x"), y: int32(y, "plane y") };
    let image = this._images.get(key);
    if (!image) {
      image = { candidates: null, moves: 0, last: null, resolved: null };
      this._images.set(key, image);
      // Oldest first out (a Map keeps insertion order); a forgotten image is inferred again.
      while (this._images.size > this._maxImages) this._images.delete(this._images.keys().next().value);
    }
    if (image.resolved) return image.resolved;
    // A second report from the same place carries no new information.
    if (image.last && image.last.x === plane.x && image.last.y === plane.y) return null;
    image.last = plane;

    // The slack of one tolerance either side absorbs the rounding of the guest's own
    // absolute-axis to pixel mapping at the image's edges.
    const slack = this._tolerance;
    const seen = [];
    for (const sent of this._sent) {
      const candidate = { x: sent.x - plane.x, y: sent.y - plane.y };
      if (candidate.x < -slack || candidate.y < -slack ||
          candidate.x >= width + slack || candidate.y >= height + slack) continue;
      if (!seen.some((other) => other.x === candidate.x && other.y === candidate.y)) seen.push(candidate);
    }
    if (seen.length === 0) return null; // nothing sent recently can explain this position
    const kept = image.candidates === null
      ? seen
      : image.candidates.filter((candidate) => seen.some((other) => near(candidate, other, this._tolerance)));
    if (kept.length === 0) {
      // The history no longer reaches the moves these candidates came from: start again here.
      image.candidates = seen;
      image.moves = 1;
      return null;
    }
    image.candidates = kept;
    image.moves += 1;
    if (image.moves < this._confirmations) return null;
    const first = kept[0];
    if (!kept.every((candidate) => near(candidate, first, this._tolerance))) return null;
    // One cluster left. Clamp into the image (the slack let edge candidates survive).
    image.resolved = Object.freeze({
      x: Math.min(width - 1, Math.max(0, first.x)),
      y: Math.min(height - 1, Math.max(0, first.y)),
    });
    return image.resolved;
  }

  /** The hotspot already determined for image `key`, or `null`. */
  hotspot(key) {
    return this._images.get(key)?.resolved ?? null;
  }

  /** Forget one image (its pixels changed) or, with no argument, everything. */
  forget(key) {
    if (key === undefined) {
      this._images.clear();
      this._sent.length = 0;
    } else {
      this._images.delete(key);
    }
  }
}
