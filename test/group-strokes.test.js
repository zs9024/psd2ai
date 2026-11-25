import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupStroke } from '../group-strokes.js';

const stroke = {
  enab: true, Styl: { value: 'OutF' }, PntT: { value: 'SClr' },
  'Sz  ': { value: 5 }, 'Clr ': { 'Rd  ': 90, 'Grn ': 135, 'Bl  ': 28 },
};

function node(layer = {}, children = null, effects) {
  return {
    layer: {
      left: 0, top: 0, width: 20, height: 10, visible: true, opacity: 255,
      blendMode: { blendKey: children ? 'pass' : 'norm' },
      ...(effects ? { objectEffects: () => ({ load() {}, obj: { data: effects } }) } : {}),
      ...layer,
    },
    isGroup: () => children !== null,
    children: () => children ?? [],
  };
}

test('allows a group stroke on separated leaves and skips hidden subtrees', () => {
  const group = node({}, [
    node(),
    node({}, [node({ left: 30 })]),
    node({ visible: false }, [node({ clipped: true })], { FrFX: stroke }),
  ], { FrFX: stroke });
  assert.deepEqual(groupStroke(group), { effect: { type: 'FrFX', settings: stroke, scale: 1 } });
});

test('rejects a group when expanded child bounds intersect after effect scaling', () => {
  const group = node({}, [node(), node({ left: 33 })], {
    'Scl ': { value: 150 }, FrFX: stroke,
  });
  assert.match(groupStroke(group).reason, /范围相交/);
});

test('reports a mask, clipping, or child style and leaves the children independent', () => {
  for (const child of [
    node({ mask: { size: 20 } }),
    node({ clipped: true }),
    node({ opacity: 128 }),
    node({}, null, { FrFX: stroke }),
  ]) {
    assert.match(groupStroke(node({}, [child], { FrFX: stroke })).reason, /复杂混合/);
  }
});

test('requires a single enabled solid outside stroke', () => {
  assert.deepEqual(groupStroke(node({}, [node()], { masterFXSwitch: false, FrFX: stroke })), {});
  for (const effects of [
    { FrFX: stroke, DrSh: { enab: true } },
    { FrFX: { ...stroke, Styl: { value: 'InsF' } } },
    { FrFX: { ...stroke, PntT: { value: 'GrFl' } } },
  ]) assert.match(groupStroke(node({}, [node()], effects)).reason, /纯色外描边/);
});
