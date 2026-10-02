import type { mat3 } from 'gl-matrix';
import type { Camera, PatternObject, Point, Project, RenderOptions } from '../types';
import {
  GROUP_SPECS,
  compose,
  getCellSize,
  invert,
  latticeVectors,
  reflectionX,
  reflectionY,
  transformPoint,
  translationMatrix
} from './groups';
import { makePath2D, makePolygonPath, tracePath } from './path';

export interface InstanceKey {
  objectId: string;
  coset: number;
  n: number;
  m: number;
  matrix: mat3;
}

export function applyMat3(ctx: CanvasRenderingContext2D, m: mat3) {
  ctx.transform(m[0], m[1], m[3], m[4], m[6], m[7]);
}

export function screenToWorld(camera: Camera, x: number, y: number): Point {
  return [(x - camera.x) / camera.zoom, (y - camera.y) / camera.zoom];
}

export function worldToScreen(camera: Camera, x: number, y: number): Point {
  return [x * camera.zoom + camera.x, y * camera.zoom + camera.y];
}

export function instanceMatrix(project: Project, coset: number, n: number, m: number): mat3 {
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const spec = GROUP_SPECS[project.group];
  return compose(translationMatrix(project.group, w, h, n, m), spec.cosets(w, h)[coset]!);
}

/**
 * Enumerate enough primitive lattice copies to cover the screen. Each transformed
 * fundamental domain is clipped individually, so motifs crossing its boundary are
 * represented by matrix images rather than duplicated hand-placed shapes.
 */
export function visibleInstances(project: Project, camera: Camera, width: number, height: number): InstanceKey[][] {
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const spec = GROUP_SPECS[project.group];
  const cosets = spec.cosets(w, h);
  const margin = 2;
  const range = translationRange(project, camera, width, height, margin);
  const result: InstanceKey[][] = [];
  for (const object of project.objects) {
    const keys: InstanceKey[] = [];
    for (const [cosetIndex] of cosets.entries()) {
      for (let n = range.nMin; n <= range.nMax; n += 1) {
        for (let m = range.mMin; m <= range.mMax; m += 1) {
          keys.push({
            objectId: object.id,
            coset: cosetIndex,
            n,
            m,
            matrix: instanceMatrix(project, cosetIndex, n, m)
          });
        }
      }
    }
    result.push(keys);
  }
  return result;
}

export function translationRange(
  project: Project,
  camera: Camera,
  width: number,
  height: number,
  margin = 1
): { nMin: number; nMax: number; mMin: number; mMax: number } {
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const corners: Point[] = [
    screenToWorld(camera, 0, 0),
    screenToWorld(camera, width, 0),
    screenToWorld(camera, width, height),
    screenToWorld(camera, 0, height)
  ];
  const [[a, b], [c, d]] = latticeVectors(project.group, w, h);
  const determinant = a * d - b * c;
  let nMin = Infinity;
  let nMax = -Infinity;
  let mMin = Infinity;
  let mMax = -Infinity;
  for (const [x, y] of corners) {
    const n = (d * x - c * y) / determinant;
    const m = (-b * x + a * y) / determinant;
    nMin = Math.min(nMin, n);
    nMax = Math.max(nMax, n);
    mMin = Math.min(mMin, m);
    mMax = Math.max(mMax, m);
  }
  return {
    nMin: Math.floor(nMin) - margin,
    nMax: Math.ceil(nMax) + margin,
    mMin: Math.floor(mMin) - margin,
    mMax: Math.ceil(mMax) + margin
  };
}

function paintObject(ctx: CanvasRenderingContext2D, item: PatternObject, selected: boolean) {
  const path = makePath2D(item.path);
  ctx.save();
  ctx.globalAlpha = item.opacity;
  if (item.fill !== 'transparent') {
    ctx.fillStyle = item.fill;
    ctx.fill(path);
  }
  if (item.strokeWidth > 0) {
    ctx.lineWidth = item.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = selected ? '#f97316' : item.stroke;
    ctx.stroke(path);
  }
  ctx.restore();
}

function drawDomain(ctx: CanvasRenderingContext2D, project: Project, selectedOnly: boolean) {
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const polygon = GROUP_SPECS[project.group].domain(w, h);
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, makePolygonPath(polygon));
  ctx.fillStyle = selectedOnly ? 'rgba(249,115,22,0.10)' : 'rgba(37,99,235,0.08)';
  ctx.fill();
  ctx.setLineDash([8, 5]);
  ctx.lineWidth = 1.5 / ctx.getTransform().a;
  ctx.strokeStyle = selectedOnly ? '#f97316' : '#2563eb';
  ctx.stroke();
  ctx.restore();
}

function drawLattice(ctx: CanvasRenderingContext2D, project: Project, range: ReturnType<typeof translationRange>) {
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const [[ax, ay], [bx, by]] = latticeVectors(project.group, w, h);
  ctx.save();
  ctx.strokeStyle = 'rgba(100,116,139,0.38)';
  ctx.lineWidth = 1 / ctx.getTransform().a;
  for (let n = range.nMin - 1; n <= range.nMax + 1; n += 1) {
    for (let m = range.mMin - 1; m <= range.mMax + 1; m += 1) {
      const ox = n * ax + m * bx;
      const oy = n * ay + m * by;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + ax, oy + ay);
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + bx, oy + by);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, a: Point, b: Point) {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

function rotationMarker(ctx: CanvasRenderingContext2D, point: Point, angle: number, label: string, color: string) {
  const radius = 18 / ctx.getTransform().a;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2 / ctx.getTransform().a;
  ctx.beginPath();
  ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
  ctx.stroke();
  const sectors = Math.round((Math.PI * 2) / angle);
  for (let i = 0; i < sectors; i += 1) {
    const a = i * angle;
    line(ctx, point, [point[0] + Math.cos(a) * radius, point[1] + Math.sin(a) * radius]);
  }
  ctx.font = `${13 / ctx.getTransform().a}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, point[0], point[1]);
  ctx.restore();
}

function drawSymmetry(ctx: CanvasRenderingContext2D, project: Project, range: ReturnType<typeof translationRange>) {
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const group = project.group;
  const [[ax, ay], [bx, by]] = latticeVectors(project.group, w, h);
  ctx.save();
  ctx.lineWidth = 2 / ctx.getTransform().a;

  const eachOrigin = (callback: (x: number, y: number, n: number, m: number) => void) => {
    for (let n = range.nMin; n <= range.nMax; n += 1) {
      for (let m = range.mMin; m <= range.mMax; m += 1) {
        callback(n * ax + m * bx, n * ay + m * by, n, m);
      }
    }
  };

  const reflectLine = (axis: 'h' | 'v' | 'd' | 'd30', dx = 0, dy = 0) => {
    const length = Math.max(w, h) * 3;
    eachOrigin((x, y) => {
      ctx.save();
      ctx.strokeStyle = 'rgba(5,150,105,0.82)';
      ctx.beginPath();
      if (axis === 'h') {
        ctx.moveTo(x - length, y + dy);
        ctx.lineTo(x + length, y + dy);
      } else if (axis === 'v') {
        ctx.moveTo(x + dx, y - length);
        ctx.lineTo(x + dx, y + length);
      } else if (axis === 'd') {
        ctx.moveTo(x - length + dx, y - length + dy);
        ctx.lineTo(x + length + dx, y + length + dy);
      } else {
        const c = Math.cos(Math.PI / 6);
        const s = Math.sin(Math.PI / 6);
        ctx.moveTo(x - c * length + dx, y - s * length + dy);
        ctx.lineTo(x + c * length + dx, y + s * length + dy);
      }
      ctx.stroke();
      ctx.restore();
    });
  };

  const glideLine = (axis: 'h' | 'v', dx = 0, dy = 0) => {
    eachOrigin((x, y) => {
      ctx.save();
      ctx.strokeStyle = 'rgba(219,39,119,0.82)';
      ctx.setLineDash([14 / ctx.getTransform().a, 8 / ctx.getTransform().a]);
      ctx.beginPath();
      const length = Math.max(w, h) * 2.5;
      if (axis === 'h') {
        ctx.moveTo(x - length, y + dy);
        ctx.lineTo(x + length, y + dy);
      } else {
        ctx.moveTo(x + dx, y - length);
        ctx.lineTo(x + dx, y + length);
      }
      ctx.stroke();
      ctx.restore();
    });
  };

  if (group === 'p2' || group === 'pmm' || group === 'pmg' || group === 'cmm') {
    eachOrigin((x, y) => rotationMarker(ctx, [x, y], Math.PI, '2', '#9333ea'));
    if (group === 'pmm' || group === 'cmm') {
      eachOrigin((x, y) => {
        rotationMarker(ctx, [x + w / 2, y + h / 2], Math.PI, '2', '#9333ea');
      });
    }
  }
  const triangular =
    project.group === 'p3' ||
    project.group === 'p3m1' ||
    project.group === 'p31m' ||
    project.group === 'p6' ||
    project.group === 'p6m';
  if (project.group === 'p4' || project.group === 'p4m' || project.group === 'p4g') {
    eachOrigin((x, y) => rotationMarker(ctx, [x, y], Math.PI / 2, '4', '#dc2626'));
    eachOrigin((x, y) => rotationMarker(ctx, [x + w / 2, y + w / 2], Math.PI, '2', '#9333ea'));
  }
  if (group === 'p3' || group === 'p3m1' || group === 'p31m') {
    eachOrigin((x, y) => {
      rotationMarker(ctx, [x, y], (Math.PI * 2) / 3, '3', '#ea580c');
      rotationMarker(ctx, [x + w / 3, y + h / 3], (Math.PI * 2) / 3, '3', '#ea580c');
      rotationMarker(ctx, [x + (2 * w) / 3, y + (2 * h) / 3], (Math.PI * 2) / 3, '3', '#ea580c');
    });
  }
  if (group === 'p6' || group === 'p6m') {
    eachOrigin((x, y) => {
      rotationMarker(ctx, [x, y], Math.PI / 3, '6', '#dc2626');
      rotationMarker(ctx, [x + w / 3, y + h / 3], (Math.PI * 2) / 3, '3', '#ea580c');
      rotationMarker(ctx, [x + (2 * w) / 3, y + (2 * h) / 3], (Math.PI * 2) / 3, '3', '#ea580c');
      rotationMarker(ctx, [x + w / 2, y], Math.PI, '2', '#9333ea');
    });
  }
  if (group === 'pm' || group === 'pmm') {
    reflectLine('v', 0);
    reflectLine('v', w / 2);
  }
  if (group === 'pmm') {
    reflectLine('h', 0, 0);
    reflectLine('h', 0, h / 2);
  }
  if (group === 'cm' || group === 'cmm') {
    reflectLine('v', 0);
    glideLine('v', w / 2);
  }
  if (group === 'pg') glideLine('h', w / 2, 0);
  if (group === 'pmg') {
    reflectLine('v', 0);
    glideLine('h', w / 2, 0);
  }
  if (group === 'cmm') {
    reflectLine('h', 0, 0);
    reflectLine('d');
  }
  if (group === 'p4m') {
    reflectLine('v', 0);
    reflectLine('h', 0, 0);
    reflectLine('d');
  }
  if (group === 'p4g') {
    reflectLine('d');
    glideLine('v', w / 2);
  }
  if (group === 'p3m1') {
    reflectLine('h', 0, 0);
    reflectLine('d30');
  }
  if (group === 'p31m') {
    reflectLine('d30');
  }
  if (group === 'p6m') {
    reflectLine('d30');
    reflectLine('v', 0);
    glideLine('h', 0, h / 2);
  }
  ctx.restore();
}

function drawChecker(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const size = 24;
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      ctx.fillStyle = ((x / size + y / size) & 1) === 0 ? '#ffffff' : '#edf2f7';
      ctx.fillRect(x, y, size, size);
    }
  }
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  project: Project,
  camera: Camera,
  options: RenderOptions,
  width: number,
  height: number,
  selectedId: string | null = null
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawChecker(ctx, width, height);
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, camera.x, camera.y);
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const spec = GROUP_SPECS[project.group];
  const range = translationRange(project, camera, width, height, 2);

  if (options.showGrid) drawLattice(ctx, project, range);
  if (options.showSymmetry) drawSymmetry(ctx, project, range);

  const domainPolygon = spec.domain(w, h);
  const domainPath = makePath2D(makePolygonPath(domainPolygon));

  for (const item of project.objects) {
    const itemPath = makePath2D(item.path);
    for (let coset = 0; coset < spec.cosets(w, h).length; coset += 1) {
      for (let n = range.nMin; n <= range.nMax; n += 1) {
        for (let m = range.mMin; m <= range.mMax; m += 1) {
          const matrix = instanceMatrix(project, coset, n, m);
          ctx.save();
          applyMat3(ctx, matrix);
          ctx.clip(domainPath);
          paintObject(ctx, item, item.id === selectedId);
          ctx.restore();
        }
      }
    }
  }

  if (options.showDomain) {
    for (let n = range.nMin; n <= range.nMax; n += 1) {
      for (let m = range.mMin; m <= range.mMax; m += 1) {
        ctx.save();
        applyMat3(ctx, translationMatrix(project.group, w, h, n, m));
        drawDomain(ctx, project, false);
        ctx.restore();
      }
    }
  }
}

export function hitTest(
  ctx: CanvasRenderingContext2D,
  project: Project,
  camera: Camera,
  screenX: number,
  screenY: number,
  width: number,
  height: number
): { objectId: string; instance: string; matrix: mat3; point: Point } | null {
  const [worldX, worldY] = screenToWorld(camera, screenX, screenY);
  const range = translationRange(project, camera, width, height, 1);
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const spec = GROUP_SPECS[project.group];
  // The editor tests a deliberately generous band because interactive canvases are usually
  // small relative to the periodic pattern.
  for (let n = range.nMin; n <= range.nMax; n += 1) {
    for (let m = range.mMin; m <= range.mMax; m += 1) {
      for (let coset = spec.cosets(w, h).length - 1; coset >= 0; coset -= 1) {
        for (let objectIndex = project.objects.length - 1; objectIndex >= 0; objectIndex -= 1) {
          const item = project.objects[objectIndex]!;
          const matrix = instanceMatrix(project, coset, n, m);
          const inverse = invert(matrix);
          const [px, py] = transformPoint(inverse, worldX, worldY);
          const sourcePath = makePath2D(item.path);
          const domainPath = makePath2D(makePolygonPath(spec.domain(w, h)));
          if (!ctx.isPointInPath(domainPath, px, py)) continue;
          if (item.fill !== 'transparent' && ctx.isPointInPath(sourcePath, px, py)) {
            return {
              objectId: item.id,
              instance: `${item.id}@${coset}:${n},${m}`,
              matrix,
              point: [worldX, worldY]
            };
          }
          ctx.lineWidth = Math.max(4, item.strokeWidth + 5);
          ctx.lineJoin = 'round';
          if (ctx.isPointInStroke(sourcePath, px, py)) {
            return {
              objectId: item.id,
              instance: `${item.id}@${coset}:${n},${m}`,
              matrix,
              point: [worldX, worldY]
            };
          }
        }
      }
    }
  }
  return null;
}

export function sourcePointFromInstance(matrix: mat3, worldPoint: Point): Point {
  const inverse = invert(matrix);
  return transformPoint(inverse, worldPoint[0], worldPoint[1]);
}

export const testReflectionX = reflectionX;
export const testReflectionY = reflectionY;
