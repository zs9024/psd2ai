import sharp from 'sharp';
import { spreadMask } from './alpha-mask.js';

const effectNames = {
  FrFX: '描边',
  DrSh: '投影',
  OrGl: '外发光',
  SoFi: '颜色叠加',
};
const multiEffectTypes = { frameFXMulti: 'FrFX', dropShadowMulti: 'DrSh', solidFillMulti: 'SoFi' };

const unit = (effect, key, fallback) => {
  const value = effect[key]?.value;
  return Number.isFinite(value) ? value : fallback;
};
const percent = (effect, key, fallback) => Math.min(100, Math.max(0, unit(effect, key, fallback))) / 100;

export function enabledTextEffects(descriptor) {
  if (!descriptor || descriptor.masterFXSwitch === false) return [];
  const scale = Math.max(0, unit(descriptor, 'Scl ', 100)) / 100;
  return Object.entries(descriptor).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value])
      .filter(effect => effect?.enab === true && effect.present !== false && percent(effect, 'Opct', 100) > 0)
      .map(settings => ({ type: multiEffectTypes[key] ?? key, settings, scale }))
  );
}

export function readLayerEffects(layer) {
  const block = layer.objectEffects?.();
  block?.load();
  return enabledTextEffects(block?.obj.data);
}

function rgbColor(settings) {
  const color = settings['Clr '];
  const channels = ['Rd  ', 'Grn ', 'Bl  '].map(key => color?.[key]);
  return channels.every(Number.isFinite)
    ? channels.map(channel => Math.round(Math.max(0, Math.min(255, channel))))
    : null;
}

function prepareEffects(effects, warnings) {
  const prepared = [];
  for (const { type, settings, scale } of effects) {
    const name = effectNames[type] ?? type;
    const opacity = percent(settings, 'Opct', 100);
    if (!opacity) continue;
    const color = rgbColor(settings);
    const blendMode = settings['Md  ']?.value;
    const normal = !blendMode || blendMode === 'Nrml';
    if (!Object.prototype.hasOwnProperty.call(effectNames, type) || !color ||
        (!normal && (type === 'FrFX' || type === 'SoFi'))) {
      warnings.push(`${name}（暂不支持此样式、颜色或混合模式）`);
      continue;
    }
    if (type === 'FrFX') {
      const position = settings.Styl?.value;
      const fill = settings.PntT?.value;
      if (!['OutF', 'InsF', 'CtrF'].includes(position) || (fill && fill !== 'SClr')) {
        warnings.push(`${name}（暂不支持此描边位置或填充类型）`);
        continue;
      }
      const size = Math.max(0, unit(settings, 'Sz  ', 0) * scale);
      if (size === 0) continue;
      const outside = position === 'OutF' ? size : position === 'CtrF' ? size / 2 : 0;
      prepared.push({ type, color, opacity, outside, inside: size - outside, extent: outside });
    } else if (type === 'SoFi') {
      prepared.push({ type, color, opacity, extent: 0 });
    } else {
      if (!normal) warnings.push(`${name}（${blendMode} 混合模式按普通透明合成近似）`);
      if (unit(settings, 'Nose', 0) > 0 || unit(settings, 'ShdN', 0) > 0 ||
          settings.TrnS?.Crv?.length > 2 || (type === 'OrGl' && percent(settings, 'Inpr', 50) !== 0.5)) {
        warnings.push(`${name}（噪点、轮廓或发光范围按基础羽化近似）`);
      }
      const size = Math.max(0, unit(settings, 'blur', 0) * scale);
      const spread = size * percent(settings, 'Ckmt', 0);
      const sigma = (size - spread) / 2;
      const distance = type === 'DrSh' ? Math.max(0, unit(settings, 'Dstn', 0) * scale) : 0;
      const angle = unit(settings, 'lagl', 120) * Math.PI / 180;
      const dx = Math.round(-distance * Math.cos(angle));
      const dy = Math.round(distance * Math.sin(angle));
      const extent = spread + 3 * sigma;
      prepared.push({ type, color, opacity, spread, sigma, dx, dy, extent });
    }
  }
  return prepared;
}

export function outsideStrokeRadius(effect) {
  if (effect.type !== 'FrFX') return null;
  const [stroke] = prepareEffects([effect], []);
  return stroke?.inside === 0 ? stroke.outside : null;
}

function over(data, offset, r, g, b, sourceAlpha) {
  if (sourceAlpha <= 0) return;
  const keptAlpha = data[offset + 3] / 255 * (1 - sourceAlpha);
  const alpha = sourceAlpha + keptAlpha;
  data[offset] = Math.round((r * sourceAlpha + data[offset] * keptAlpha) / alpha);
  data[offset + 1] = Math.round((g * sourceAlpha + data[offset + 1] * keptAlpha) / alpha);
  data[offset + 2] = Math.round((b * sourceAlpha + data[offset + 2] * keptAlpha) / alpha);
  data[offset + 3] = Math.round(alpha * 255);
}

function paintEffect(data, mask, width, height, { color: [r, g, b], opacity, dx = 0, dy = 0 }) {
  for (let y = Math.max(0, -dy); y < Math.min(height, height - dy); y++) {
    for (let x = Math.max(0, -dx); x < Math.min(width, width - dx); x++) {
      const offset = ((y + dy) * width + x + dx) * 4;
      over(data, offset, r, g, b, mask[y * width + x] / 255 * opacity);
    }
  }
}

function tintPixel(data, offset, color, opacity) {
  for (let channel = 0; channel < 3; channel++) {
    data[offset + channel] = Math.round(data[offset + channel] * (1 - opacity) + color[channel] * opacity);
  }
}

function visibleBounds(data, width, height) {
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

export async function renderTextEffects(image, effects) {
  const warnings = [];
  const prepared = prepareEffects(effects, warnings);
  if (!prepared.length) return { warnings };
  let left = 0, top = 0, right = 0, bottom = 0;
  for (const { extent, dx = 0, dy = 0 } of prepared) {
    left = Math.max(left, Math.ceil(extent + Math.max(0, -dx)));
    top = Math.max(top, Math.ceil(extent + Math.max(0, -dy)));
    right = Math.max(right, Math.ceil(extent + Math.max(0, dx)));
    bottom = Math.max(bottom, Math.ceil(extent + Math.max(0, dy)));
  }
  const width = image.width + left + right;
  const height = image.height + top + bottom;
  const mask = Buffer.alloc(width * height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      mask[(y + top) * width + x + left] = image.data[(y * image.width + x) * 4 + 3];
    }
  }

  const data = Buffer.alloc(width * height * 4);
  for (const type of ['DrSh', 'OrGl', 'FrFX']) {
    for (const effect of prepared.filter(effect => effect.type === type).reverse()) {
      if (type === 'FrFX' && !effect.outside) continue;
      const radius = type === 'FrFX' ? effect.outside : effect.spread;
      let shaped = spreadMask(mask, width, height, radius);
      if (effect.sigma >= 0.3) {
        shaped = await sharp(shaped, { raw: { width, height, channels: 1 } })
          .blur(effect.sigma).toColourspace('b-w').raw().toBuffer();
      }
      paintEffect(data, shaped, width, height, effect);
    }
  }

  const glyph = Buffer.from(image.data);
  const overlays = prepared.filter(effect => effect.type === 'SoFi').reverse();
  const innerStrokes = prepared.filter(effect => effect.inside > 0).reverse().map(effect => ({
    ...effect, eroded: spreadMask(mask, width, height, effect.inside, true),
  }));
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const source = (y * image.width + x) * 4;
      const target = (y + top) * width + x + left;
      const alpha = glyph[source + 3];
      if (alpha === 0) continue;
      for (const effect of overlays) tintPixel(glyph, source, effect.color, effect.opacity);
      for (const effect of innerStrokes) {
        const coverage = Math.max(0, 1 - effect.eroded[target] / alpha);
        tintPixel(glyph, source, effect.color, effect.opacity * coverage);
      }
      over(data, target * 4, glyph[source], glyph[source + 1], glyph[source + 2], alpha / 255);
    }
  }

  const bounds = visibleBounds(data, width, height);
  if (!bounds) return { warnings };
  const png = await sharp(data, { raw: { width, height, channels: 4 } }).extract(bounds).png().toBuffer();
  return { png, warnings, width: bounds.width, height: bounds.height, dx: bounds.left - left, dy: bounds.top - top };
}
