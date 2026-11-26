// E5-T36: recover the hotspot of a guest cursor image the device did not describe.
//
// A compositor on legacy KMS (wlroots with WLR_DRM_NO_ATOMIC) sets the cursor image without a
// hotspot and instead moves the cursor plane to "pointer minus hotspot". The host, which draws
// the image at the real pointer, therefore needs the hotspot — and can work it out: it knows the
// guest-space positions it sent, and every plane position the guest MOVES the plane to is one
// of them minus the hotspot of the image shown. Each such move turns the recent sent positions
// into candidate hotspots; the true one is a candidate every time, so intersecting the candidate
// sets of a few moves to different places leaves it alone. Lag, coalesced or dropped moves only
// shrink how recent the matching sent position is; they never remove the true candidate while it
// is still in history.
//
// What is NOT evidence, and must never be given to `noteMove`:
//   * the position carried by a cursor UPDATE. A legacy-KMS commit is "set image" at the
//     plane's previous position, then "move"; the update's position was computed with the
//     previous image's hotspot;
//   * positions reported while the page sends no absolute pointer positions (relative mode), or
//     for sent positions computed at another output size. The caller `reset`s on those changes.
//
// Two more rules keep an answer honest:
//   * at rest the lag is zero. When the pointer has not been moved and the guest has reported
//     nothing for a while (`noteRest`), the plane is where the guest put it for the last
//     position sent, so that one position is the only candidate;
//   * an answer is dropped when the guest contradicts it: a move the answer cannot explain
//     although other sent positions could (three in a row), or a plane that moves again after a
//     rest answer while nothing new was sent (the guest had not caught up).

const DEFAULT_HISTORY = 128;
const DEFAULT_TOLERANCE = 1;
const DEFAULT_CONFIRMATIONS = 2;
// Images remembered at once. A desktop uses a dozen cursor shapes; a page that animates a custom
// cursor could produce any number, and each key is the image's whole data URL.
const DEFAULT_MAX_IMAGES = 64;
// Consecutive moves an answer fails to explain before it is dropped.
const DEFAULT_CONTRADICTIONS = 3;

function int32(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${name} must be a finite number`);
  // virtio carries plane positions as u32; a position left of or above the origin wraps.
  return number | 0;
}

function near(a, b, tolerance) {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function positiveInteger(value, minimum, name) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${name} must be an integer >= ${minimum}`);
  return value;
}

export class CursorHotspotEstimator {
  constructor({ history = DEFAULT_HISTORY, tolerance = DEFAULT_TOLERANCE,
    confirmations = DEFAULT_CONFIRMATIONS, maxImages = DEFAULT_MAX_IMAGES,
    contradictions = DEFAULT_CONTRADICTIONS } = {}) {
    this._history = positiveInteger(history, 2, "history");
    this._tolerance = positiveInteger(tolerance, 0, "tolerance");
    this._confirmations = positiveInteger(confirmations, 2, "confirmations");
    this._maxImages = positiveInteger(maxImages, 1, "maxImages");
    this._contradictions = positiveInteger(contradictions, 1, "contradictions");
    this._sent = [];
    // Positions sent so far; tells a rest answer whether anything was sent after it.
    this._sends = 0;
    this._images = new Map();
  }

  /** A guest-space pointer position the host has just sent to the guest. */
  notePointer(x, y) {
    const point = { x: int32(x, "pointer x"), y: int32(y, "pointer y") };
    const last = this._sent[this._sent.length - 1];
    if (last && last.x === point.x && last.y === point.y) return;
    this._sent.push(point);
    this._sends += 1;
    if (this._sent.length > this._history) this._sent.shift();
  }

  _image(key) {
    let image = this._images.get(key);
    if (!image) {
      image = { candidates: null, moves: 0, last: null, resolved: null, misses: 0, restSends: -1 };
      this._images.set(key, image);
      // Oldest first out (a Map keeps insertion order); a forgotten image is inferred again.
      while (this._images.size > this._maxImages) this._images.delete(this._images.keys().next().value);
    }
    return image;
  }

  /**
   * A cursor update installed image `key`. Its own position says nothing about this image (see
   * the top of the file); what it does say is that a plane position remembered from an earlier
   * showing of this image is no longer where the plane is.
   */
  noteInstall(key) {
    const image = this._images.get(key);
    if (image) image.last = null;
  }

  /** Hotspots some recently sent position gives for a plane at `plane` (deduplicated). */
  _candidates(plane, width, height) {
    // The slack of one tolerance either side absorbs the rounding of the guest's own
    // absolute-axis to pixel mapping at the image's edges.
    const slack = this._tolerance;
    const seen = [];
    const keys = new Set();
    for (const sent of this._sent) {
      const x = sent.x - plane.x;
      const y = sent.y - plane.y;
      if (x < -slack || y < -slack || x >= width + slack || y >= height + slack) continue;
      const key = (x + slack) * 65536 + (y + slack);
      if (keys.has(key)) continue;
      keys.add(key);
      seen.push({ x, y });
    }
    return seen;
  }

  _resolve(image, candidate, width, height) {
    // Clamp into the image (the slack let edge candidates survive).
    image.resolved = Object.freeze({
      x: Math.min(width - 1, Math.max(0, candidate.x)),
      y: Math.min(height - 1, Math.max(0, candidate.y)),
    });
    image.misses = 0;
    return image.resolved;
  }

  /**
   * The guest MOVED the plane showing image `key` (`width`×`height`) to (`x`, `y`).
   * Returns the image's hotspot `{x, y}` if it is determined after this move, otherwise `null`.
   */
  noteMove(key, width, height, x, y) {
    positiveInteger(width, 1, "cursor image width");
    positiveInteger(height, 1, "cursor image height");
    const plane = { x: int32(x, "plane x"), y: int32(y, "plane y") };
    const image = this._image(key);
    // A second report from the same place carries no new information.
    if (image.last && image.last.x === plane.x && image.last.y === plane.y) return image.resolved;
    image.last = plane;
    const seen = this._candidates(plane, width, height);

    if (image.resolved) {
      // The plane moved although nothing was sent since the pointer came to rest: the guest had
      // not caught up, and the rest answer was read off a plane still on its way.
      const stillArriving = image.restSends === this._sends;
      if (!stillArriving) {
        if (seen.some((candidate) => near(candidate, image.resolved, this._tolerance))) {
          image.misses = 0;
          return image.resolved;
        }
        // Nothing recent explains this position at all (the guest is further behind than the
        // history reaches): no evidence either way.
        if (seen.length === 0) return image.resolved;
        image.misses += 1;
        if (image.misses < this._contradictions) return image.resolved;
      }
      // Contradicted. Start again from what this move allows.
      image.resolved = null;
      image.misses = 0;
      image.restSends = -1;
      image.candidates = seen.length === 0 ? null : seen;
      image.moves = seen.length === 0 ? 0 : 1;
      return null;
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
    return this._resolve(image, first, width, height); // one cluster left
  }

  /**
   * The pointer is at rest: nothing was sent and the guest reported nothing for a while, so the
   * plane showing image `key` is where the guest put it for the LAST position sent. Returns the
   * image's hotspot if that settles it, otherwise `null`. Needs a move of this image since it
   * was last installed, and never overrides evidence: the rest position has to be one of the
   * candidates the moves so far allow.
   */
  noteRest(key, width, height) {
    positiveInteger(width, 1, "cursor image width");
    positiveInteger(height, 1, "cursor image height");
    const image = this._images.get(key);
    if (!image) return null;
    if (image.resolved) return image.resolved;
    const sent = this._sent[this._sent.length - 1];
    if (!image.last || !sent || image.candidates === null) return null;
    const slack = this._tolerance;
    const rest = { x: sent.x - image.last.x, y: sent.y - image.last.y };
    if (rest.x < -slack || rest.y < -slack || rest.x >= width + slack || rest.y >= height + slack) return null;
    if (!image.candidates.some((candidate) => near(candidate, rest, this._tolerance))) return null;
    image.candidates = [rest];
    image.restSends = this._sends;
    return this._resolve(image, rest, width, height);
  }

  /** The hotspot currently determined for image `key`, or `null`. */
  hotspot(key) {
    return this._images.get(key)?.resolved ?? null;
  }

  /**
   * Forget everything: the positions sent and every image. For when what was sent stops being
   * comparable with what the guest reports — the pointer left absolute mode, or the guest
   * output the positions were computed for changed size.
   */
  reset() {
    this._images.clear();
    this._sent.length = 0;
  }
}
