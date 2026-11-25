import { createRequire } from 'module';
import PSD from 'psd';
import { readLayerEffects, outsideStrokeRadius } from './text-effects.js';

const require = createRequire(import.meta.url);
// PSD.js uses the same object-effects payload for lfx2 and lmfx. Photoshop
// stores the group variant lfxs with that payload too.
const ObjectEffects = require('psd/lib/psd/layer_info/object_effects.coffee');

export async function openPsdWithGroups(path) {
  const psd = await PSD.open(path);
  // Building the tree synchronously parses the lazy layer records.
  const original = ObjectEffects.shouldParse;
  ObjectEffects.shouldParse = key => key === 'lfxs' || original.call(ObjectEffects, key);
  try {
    return { psd, tree: psd.tree() };
  } finally {
    ObjectEffects.shouldParse = original;
  }
}

function hasCustomBlendRange({ grey, channels = [] } = {}) {
  return [grey, ...channels].filter(Boolean).some(range =>
    ['source', 'dest'].some(side => range[side].black.some(value => value !== 0) ||
      range[side].white.some(value => value !== 255))
  );
}

function isPlainLayer(layer, group) {
  const mode = layer.blendMode.blendKey;
  const fill = layer.fillOpacity?.();
  fill?.load();
  return (mode === 'norm' || (group && mode === 'pass')) &&
    layer.opacity === 255 && (!fill || fill.obj.value === 255) &&
    !layer.clipped && !layer.mask?.size && !layer.vectorMask &&
    !hasCustomBlendRange(layer.blendingRanges);
}

function collectStrokeBounds(node, pad, boxes) {
  for (const child of node.children()) {
    const layer = child.layer;
    if (!layer.visible) continue;
    const group = child.isGroup();
    if (!group && (layer.width <= 0 || layer.height <= 0)) continue;
    if (!isPlainLayer(layer, group) || readLayerEffects(layer).length) return false;
    if (group) {
      if (!collectStrokeBounds(child, pad, boxes)) return false;
      continue;
    }
    boxes.push({
      left: layer.left - pad, top: layer.top - pad,
      right: layer.left + layer.width + pad, bottom: layer.top + layer.height + pad,
    });
  }
  return true;
}

export function groupStroke(node) {
  const effects = readLayerEffects(node.layer);
  if (!effects.length) return {};
  const radius = effects.length === 1 ? outsideStrokeRadius(effects[0]) : null;
  if (radius === null) return { reason: '仅支持单个正常混合模式的纯色外描边' };

  const boxes = [];
  if (!isPlainLayer(node.layer, true) || !collectStrokeBounds(node, Math.ceil(radius), boxes)) {
    return { reason: '存在蒙版、剪贴、图层样式或复杂混合' };
  }
  const overlap = boxes.some((a, i) => boxes.some((b, j) =>
    j < i && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  ));
  if (overlap) return { reason: '子图层扩展描边后的范围相交' };
  return boxes.length ? { effect: effects[0] } : {};
}
