import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { enabledTextEffects, labelEffects, renderTextEffects } from '../text-effects.js';

const unit = value => ({ value });
const color = (r, g, b) => ({ 'Rd  ': r, 'Grn ': g, 'Bl  ': b });
const stroke = (position, size) => ({
  enab: true, Styl: unit(position), PntT: unit('SClr'), 'Sz  ': unit(size),
  'Clr ': color(173, 77, 58),
});

function whiteGlyph(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4, 255) };
}

async function render(glyph, descriptor) {
  const result = await renderTextEffects(glyph, enabledTextEffects(descriptor));
  const data = await sharp(result.png).raw().toBuffer();
  const pixel = (x, y) => [...data.subarray((y * result.width + x) * 4, (y * result.width + x) * 4 + 4)];
  return { ...result, pixel };
}

test('an outside stroke expands the bounds and leaves the glyph registered at its original position', async () => {
  const result = await render(whiteGlyph(1, 1), { 'Scl ': unit(50), FrFX: stroke('OutF', 4) });
  assert.deepEqual([result.width, result.height, result.dx, result.dy], [5, 5, -2, -2]);
  assert.deepEqual(result.pixel(0, 0), [0, 0, 0, 0]);
  assert.deepEqual(result.pixel(0, 2), [173, 77, 58, 255]);
  assert.deepEqual(result.pixel(2, 2), [255, 255, 255, 255]);
});

test('an inside stroke takes no extra space and a centered stroke covers both sides', async () => {
  const fill = { enab: true, 'Clr ': color(0, 0, 255), Opct: unit(50) };
  const inside = await render(whiteGlyph(5, 5), { FrFX: stroke('InsF', 1), SoFi: fill });
  assert.deepEqual([inside.width, inside.height, inside.dx, inside.dy], [5, 5, 0, 0]);
  assert.deepEqual(inside.pixel(0, 2), [173, 77, 58, 255]);
  assert.deepEqual(inside.pixel(2, 2), [128, 128, 255, 255]);
  const center = await render(whiteGlyph(5, 5), { FrFX: stroke('CtrF', 2) });
  assert.deepEqual([center.width, center.height, center.dx, center.dy], [7, 7, -1, -1]);
  assert.deepEqual(center.pixel(0, 3), [173, 77, 58, 255]);
  assert.deepEqual(center.pixel(1, 3), [173, 77, 58, 255]);
});

test('a shadow follows its offset and a glow feathers outward on the same canvas', async () => {
  const shadow = await render(whiteGlyph(1, 1), { DrSh: {
    enab: true, Dstn: unit(2), lagl: unit(90), Opct: unit(50), 'Clr ': color(32, 48, 64),
    'Md  ': unit('Mltp'),
  } });
  assert.deepEqual([shadow.width, shadow.height, shadow.dx, shadow.dy], [1, 3, 0, 0]);
  assert.deepEqual(shadow.pixel(0, 1), [0, 0, 0, 0]);
  assert.deepEqual(shadow.pixel(0, 2), [32, 48, 64, 128]);
  assert.match(shadow.warnings[0], /Mltp/);

  const glow = await render(whiteGlyph(3, 3), { OrGl: {
    enab: true, blur: unit(4), 'Clr ': color(240, 150, 0),
  } });
  assert.ok(glow.width > 3 && glow.height > 3);
  const outside = glow.pixel(-glow.dx - 1, -glow.dy);
  assert.deepEqual(outside.slice(0, 3), [240, 150, 0]);
  assert.ok(outside[3] > 0 && outside[3] < 255);
});

test('disabled descriptors are ignored and unsupported active effects are reported', async () => {
  assert.deepEqual(enabledTextEffects({ masterFXSwitch: false, FrFX: stroke('OutF', 3) }), []);
  const effects = enabledTextEffects({
    frameFXMulti: [{ ...stroke('OutF', 3), enab: false }, { ...stroke('OutF', 3), Opct: unit(0) }],
    GrFl: { enab: true },
  });
  const result = await renderTextEffects(whiteGlyph(1, 1), effects);
  assert.equal(result.png, undefined);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /GrFl/);
});

test('editable labels normalize one outside outline and one shadow and report omitted effects', () => {
  const effects = enabledTextEffects({
    'Scl ': unit(50),
    frameFXMulti: [stroke('InsF', 6), stroke('OutF', 10), stroke('OutF', 16)],
    DrSh: { enab: true, Dstn: unit(8), lagl: unit(90), blur: unit(6), Opct: unit(50),
      Ckmt: unit(25), 'Md  ': unit('Mltp'), 'Clr ': color(32, 48, 64) },
    GrFl: { enab: true },
  });
  const data = labelEffects(effects);
  assert.deepEqual(data.outline, { width: 5, color: [173, 77, 58, 255] });
  assert.equal(data.shadow.blur, 3);
  assert.ok(Math.abs(data.shadow.offset[0]) < 1e-9);
  assert.deepEqual(data.shadow.offset.slice(1), [4]);
  assert.deepEqual(data.shadow.color, [32, 48, 64, 128]);
  for (const note of ['内描边', '额外的描边', 'Mltp', '扩展', 'GrFl']) {
    assert.ok(data.effectNotes.some(message => message.includes(note)));
  }
});
