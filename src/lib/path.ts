import type { mat3 } from 'gl-matrix';
import type { PathSegment, PatternObject, Point } from '../types';
import { invert, transformPoint } from './groups';

let idCounter = 0;

export function uid(prefix = 'id'): string {
  idCounter += 1;
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}_${idCounter}`;
}

export function clonePath(path: PathSegment[]): PathSegment[] {
  return path.map((segment) => ({ ...segment }));
}

export function cloneObject(item: PatternObject): PatternObject {
  return { ...item, path: clonePath(item.path) };
}

export function tracePath(ctx: CanvasRenderingContext2D | Path2D, path: PathSegment[]): void {
  for (const segment of path) {
    if (segment.type === 'M') ctx.moveTo(segment.x, segment.y);
    else if (segment.type === 'L') ctx.lineTo(segment.x, segment.y);
    else if (segment.type === 'Q') ctx.quadraticCurveTo(segment.cx, segment.cy, segment.x, segment.y);
    else if (segment.type === 'C') {
      ctx.bezierCurveTo(segment.cx1, segment.cy1, segment.cx2, segment.cy2, segment.x, segment.y);
    } else if (segment.type === 'Z') ctx.closePath();
  }
}

export function makePath2D(path: PathSegment[]): Path2D {
  const p = new Path2D();
  tracePath(p, path);
  return p;
}

export function makePolygonPath(points: Point[]): PathSegment[] {
  if (points.length === 0) return [];
  const [start, ...rest] = points;
  if (!start) return [];
  return [
    { type: 'M', x: start[0], y: start[1] },
    ...rest.map(([x, y]) => ({ type: 'L' as const, x, y })),
    { type: 'Z' as const }
  ];
}

export function rectanglePath(x: number, y: number, w: number, h: number): PathSegment[] {
  const width = Math.abs(w);
  const height = Math.abs(h);
  const x0 = width === w ? x : x + w;
  const y0 = height === h ? y : y + h;
  return makePolygonPath([
    [x0, y0],
    [x0 + width, y0],
    [x0 + width, y0 + height],
    [x0, y0 + height]
  ]);
}

/** Cubic Bezier approximation of a full ellipse, with points stored in absolute object coordinates. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): PathSegment[] {
  const k = 0.5522847498307936;
  const path: PathSegment[] = [{ type: 'M', x: cx + rx, y: cy }];
  const corners: Array<[number, number, number, number, number, number]> = [
    [cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry],
    [cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy],
    [cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry],
    [cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy]
  ];
  for (const [cx1, cy1, cx2, cy2, x, y] of corners) {
    path.push({ type: 'C', cx1, cy1, cx2, cy2, x, y });
  }
  path.push({ type: 'Z' });
  return path;
}

export function applyMatrixToPath(path: PathSegment[], m: mat3): PathSegment[] {
  const point = (x: number, y: number): Point => transformPoint(m, x, y);
  return path.map((segment) => {
    if (segment.type === 'M' || segment.type === 'L') {
      const [x, y] = point(segment.x, segment.y);
      return { ...segment, x, y };
    }
    if (segment.type === 'Q') {
      const [x, y] = point(segment.x, segment.y);
      const [cx, cy] = point(segment.cx, segment.cy);
      return { ...segment, x, y, cx, cy };
    }
    if (segment.type === 'C') {
      const [x, y] = point(segment.x, segment.y);
      const [cx1, cy1] = point(segment.cx1, segment.cy1);
      const [cx2, cy2] = point(segment.cx2, segment.cy2);
      return { ...segment, x, y, cx1, cy1, cx2, cy2 };
    }
    return { ...segment };
  });
}

export interface PathPoint {
  segmentIndex: number;
  role: 'end' | 'qControl' | 'c1' | 'c2';
  x: number;
  y: number;
}

export function editablePoints(path: PathSegment[]): PathPoint[] {
  const points: PathPoint[] = [];
  path.forEach((segment, segmentIndex) => {
    if (segment.type === 'M' || segment.type === 'L') {
      points.push({ segmentIndex, role: 'end', x: segment.x, y: segment.y });
    } else if (segment.type === 'Q') {
      points.push({ segmentIndex, role: 'qControl', x: segment.cx, y: segment.cy });
      points.push({ segmentIndex, role: 'end', x: segment.x, y: segment.y });
    } else if (segment.type === 'C') {
      points.push({ segmentIndex, role: 'c1', x: segment.cx1, y: segment.cy1 });
      points.push({ segmentIndex, role: 'c2', x: segment.cx2, y: segment.cy2 });
      points.push({ segmentIndex, role: 'end', x: segment.x, y: segment.y });
    }
  });
  return points;
}

export function setEditablePoint(path: PathSegment[], target: PathPoint, x: number, y: number): PathSegment[] {
  return path.map((segment, index) => {
    if (index !== target.segmentIndex) return segment;
    const next = { ...segment };
    if (target.role === 'end' && 'x' in next && 'y' in next) {
      next.x = x;
      next.y = y;
    } else if (target.role === 'qControl' && next.type === 'Q') {
      next.cx = x;
      next.cy = y;
    } else if (target.role === 'c1' && next.type === 'C') {
      next.cx1 = x;
      next.cy1 = y;
    } else if (target.role === 'c2' && next.type === 'C') {
      next.cx2 = x;
      next.cy2 = y;
    }
    return next;
  });
}

export function pathBounds(path: PathSegment[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of editablePoints(path)) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function inverseTransformPoint(m: mat3, x: number, y: number): Point {
  return transformPoint(invert(m), x, y);
}
