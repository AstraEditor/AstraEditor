import paper from '@turbowarp/paper';
import { isCompoundPathChild } from './compound-path';

const BOOLEAN_OPTIONS = { insert: false };

const isValidPath = (path) => Boolean(path && path.bounds.width > 0 && path.bounds.height > 0 && path.length > 0);

const applyResultStyle = (target, source) => {
  target.fillColor = source.fillColor;
  target.strokeColor = source.strokeColor;
  target.strokeWidth = source.strokeWidth;
};

const validateBooleanOperation = (items) => {
  if (items.length < 2) return false;
  for (const item of items) {
    if (!(item instanceof paper.PathItem)) return false;
    if (isCompoundPathChild(item)) return false;
  }
  return true;
};

// 合并
export const uniteShapes = (items) => {
  if (!validateBooleanOperation(items)) return null;

  let result = items[0].clone(false);

  for (let i = 1; i < items.length; i++) {
    const temp = result.unite(items[i], BOOLEAN_OPTIONS);
    result.remove();
    if (!isValidPath(temp)) {
      if (temp) temp.remove();
      return null;
    }
    result = temp;
  }
  applyResultStyle(result, items[0]);
  result.insertAbove(items[0]);

  return result;
};

// 香蕉
export const intersectShapes = (items) => {
  if (!validateBooleanOperation(items)) return null;

  let result = items[0].clone(false);

  for (let i = 1; i < items.length; i++) {
    if (!result.bounds.intersects(items[i].bounds)) {
      result.remove();
      return null;
    }

    const temp = result.intersect(items[i], BOOLEAN_OPTIONS);
    result.remove();
    if (!isValidPath(temp)) {
      if (temp) temp.remove();
      return null;
    }
    result = temp;
  }

  applyResultStyle(result, items[0]);
  result.insertAbove(items[0]);
  return result;
};

// 剪除
export const subtractShapes = (items) => {
  if (!validateBooleanOperation(items)) return null;

  let result = items[0].clone(false);

  for (let i = 1; i < items.length; i++) {
    if (!result.bounds.intersects(items[i].bounds)) {
      continue;
    }

    const temp = result.subtract(items[i], BOOLEAN_OPTIONS);
    result.remove();
    if (!isValidPath(temp)) {
      if (temp) temp.remove();
      return null;
    }
    result = temp;
  }

  applyResultStyle(result, items[0]);
  result.insertAbove(items[0]);
  return result;
};

// 拆分
export const splitShapes = (items) => {
  if (!validateBooleanOperation(items)) return null;
  if (items.length >= 31) return null;

  const resultGroup = new paper.Group();

  const addPathToGroup = (path) => {
    if (!isValidPath(path)) {
      if (path) path.remove();
      return;
    }

    applyResultStyle(path, items[0]);
    resultGroup.addChild(path);
  };

  const extractPathsToGroup = (item) => {
    if (!item) return;

    if (item instanceof paper.PathItem) {
      addPathToGroup(item);
      return;
    }

    if (item.children && item.children.length) {
      const children = item.children.slice();
      for (const child of children) {
        extractPathsToGroup(child);
      }
    }

    if (typeof item.remove === 'function') {
      item.remove();
    }
  };

  const itemCount = items.length;
  const totalMasks = 1 << itemCount;
  const fullMask = totalMasks - 1;
  const intersections = new Array(totalMasks).fill(null);

  const boundsIntersections = new Array(itemCount);
  for (let i = 0; i < itemCount; i++) {
    boundsIntersections[i] = new Array(itemCount).fill(true);
  }
  for (let i = 0; i < itemCount; i++) {
    for (let j = i + 1; j < itemCount; j++) {
      const intersects = items[i].bounds.intersects(items[j].bounds);
      boundsIntersections[i][j] = intersects;
      boundsIntersections[j][i] = intersects;
    }
  }

  for (let mask = 1; mask < totalMasks; mask++) {
    const lowBit = mask & -mask;
    const bitIndex = Math.log2(lowBit);
    const prevMask = mask ^ lowBit;

    if (prevMask === 0) {
      const cloned = items[bitIndex].clone(false);
      if (isValidPath(cloned)) {
        intersections[mask] = cloned;
      } else {
        cloned.remove();
      }
      continue;
    }

    const prevIntersection = intersections[prevMask];
    if (!prevIntersection) continue;

    let hasDisjointPair = false;
    for (let bit = prevMask; bit > 0; bit &= bit - 1) {
      const idx = Math.log2(bit & -bit);
      if (!boundsIntersections[bitIndex][idx]) {
        hasDisjointPair = true;
        break;
      }
    }
    if (hasDisjointPair) continue;
    if (!prevIntersection.bounds.intersects(items[bitIndex].bounds)) continue;

    const nextIntersection = prevIntersection.intersect(items[bitIndex], BOOLEAN_OPTIONS);
    if (isValidPath(nextIntersection)) {
      intersections[mask] = nextIntersection;
    } else if (nextIntersection) {
      nextIntersection.remove();
    }
  }

  for (let mask = 1; mask < totalMasks; mask++) {
    const intersection = intersections[mask];
    if (!intersection) continue;

    let finalResult = intersection.clone(false);
    const remaining = fullMask ^ mask;

    for (let subset = remaining; subset > 0; subset = (subset - 1) & remaining) {
      const supersetIntersection = intersections[mask | subset];
      if (!supersetIntersection) continue;
      if (!finalResult.bounds.intersects(supersetIntersection.bounds)) continue;

      const subtracted = finalResult.subtract(supersetIntersection, BOOLEAN_OPTIONS);
      finalResult.remove();

      if (!isValidPath(subtracted)) {
        if (subtracted) subtracted.remove();
        finalResult = null;
        break;
      }
      finalResult = subtracted;
    }

    if (finalResult) {
      extractPathsToGroup(finalResult);
    }
  }

  for (let mask = 1; mask < totalMasks; mask++) {
    if (intersections[mask]) {
      intersections[mask].remove();
    }
  }

  if (resultGroup.children.length === 0) {
    resultGroup.remove();
    return null;
  }

  return resultGroup;
};

export const performBooleanOperation = (operation, selectedItems) => {
  const items = selectedItems.filter((item) => item.selected);
  let result;

  switch (operation) {
    case 'unite':
      result = uniteShapes(items);
      break;
    case 'intersect':
      result = intersectShapes(items);
      break;
    case 'subtract':
      result = subtractShapes(items);
      break;
    case 'split':
      result = splitShapes(items);
      break;
    default:
      return items;
  }

  if (!result) return null;

  items.forEach((item) => item.remove());

  return result;
};
