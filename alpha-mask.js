// A disk-shaped minimum or maximum filter. Use a sliding window horizontally
// and reuse the filtered rows for vertical offsets with the same horizontal reach.
function filterDisk(mask, width, height, radius, erode) {
  if (radius === 0) return mask;
  const combine = erode ? Math.min : Math.max;
  const filtered = Buffer.alloc(mask.length, erode ? 255 : 0);
  const horizontal = Buffer.alloc(mask.length);
  const queue = new Int32Array(width);
  let previousReach = -1;

  for (let dy = 0; dy <= Math.min(radius, height - 1); dy++) {
    const reach = Math.min(width - 1, Math.floor(Math.sqrt(radius * radius - dy * dy)));
    if (reach !== previousReach) {
      previousReach = reach;
      for (let y = 0; y < height; y++) {
        const row = y * width;
        let first = 0;
        let end = 0;
        let next = 0;
        for (let x = 0; x < width; x++) {
          while (first < end && queue[first] < x - reach) first++;
          while (next < width && next <= x + reach) {
            const value = mask[row + next];
            while (first < end && combine(mask[row + queue[end - 1]], value) === value) end--;
            queue[end++] = next++;
          }
          horizontal[row + x] = mask[row + queue[first]];
        }
      }
    }
    const offset = dy * width;
    for (let src = 0; src < mask.length - offset; src++) {
      filtered[src + offset] = combine(filtered[src + offset], horizontal[src]);
      if (dy !== 0) filtered[src] = combine(filtered[src], horizontal[src + offset]);
    }
  }

  if (erode) {
    // Pixels outside the cutout are transparent.
    for (let y = 0; y < height; y++) {
      const row = y * width;
      if (y < radius || y >= height - radius) filtered.fill(0, row, row + width);
      else {
        filtered.fill(0, row, row + Math.min(radius, width));
        filtered.fill(0, row + Math.max(0, width - radius), row + width);
      }
    }
  }
  return filtered;
}

export function spreadMask(mask, width, height, radius, erode = false) {
  const whole = Math.floor(radius);
  const first = filterDisk(mask, width, height, whole, erode);
  const fraction = radius - whole;
  if (fraction === 0) return first;
  const second = filterDisk(mask, width, height, whole + 1, erode);
  for (let i = 0; i < second.length; i++) {
    second[i] = Math.round(first[i] + (second[i] - first[i]) * fraction);
  }
  return second;
}
