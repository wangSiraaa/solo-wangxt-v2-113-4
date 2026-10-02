import type { GroupId, PathSegment, PatternObject, Project } from '../types';
import { ellipsePath, rectanglePath, uid } from './path';

function object(id: string, name: string, path: PathSegment[], style: Partial<PatternObject> = {}): PatternObject {
  return {
    id,
    name,
    path,
    fill: '#2d7ff9',
    stroke: '#12376d',
    strokeWidth: 3,
    opacity: 1,
    ...style
  };
}

function baseProject(group: GroupId, name: string, width: number, height: number, objects: PatternObject[]): Project {
  return {
    id: uid('project'),
    name,
    group,
    cellWidth: width,
    cellHeight: height,
    objects,
    updatedAt: Date.now()
  };
}

export function p6mSample(): Project {
  const w = 280;
  const h = (Math.sqrt(3) / 2) * w;
  // The p6m fundamental chamber is the triangle (0,0)-(w/6,0)-(w/2,h/3).
  const ribbon = rectanglePath(24, 8, 110, 20);
  const arcDot = ellipsePath(38, 47, 14, 9);
  const transparentLeaf = ellipsePath(73, 17, 10, 31);
  return baseProject(
    'p6m',
    '六重旋转 + 镜面 / 滑移',
    w,
    h,
    [
      object(uid('object'), '跨边界蓝带', ribbon, {
        fill: '#2563eb',
        stroke: '#0f172a',
        strokeWidth: 3,
        opacity: 0.88
      }),
      object(uid('object'), '旋转中心圆点', arcDot, {
        fill: '#f59e0b',
        stroke: '#78350f',
        strokeWidth: 2,
        opacity: 1
      }),
      object(uid('object'), '透明边缘叶片', transparentLeaf, {
        fill: '#14b8a6',
        stroke: '#134e4a',
        strokeWidth: 2,
        opacity: 0.42
      })
    ]
  );
}

export function glideSample(): Project {
  const w = 260;
  const h = 200;
  // pg fundamental half is y: 0..h/2. A long feather crosses the top; the glide carries
  // it to a mirrored shape displaced by half a vertical period.
  const feather = [
    { type: 'M' as const, x: 18, y: 22 },
    { type: 'Q' as const, cx: 76, cy: -18, x: 132, y: 28 },
    { type: 'C' as const, cx1: 170, cy1: 58, cx2: 214, cy2: 48, x: 247, y: 78 },
    { type: 'L' as const, x: 240, y: 97 },
    { type: 'C' as const, cx1: 185, cy1: 68, cx2: 116, cy2: 74, x: 74, y: 61 },
    { type: 'Q' as const, cx: 42, cy: 52, x: 18, y: 22 },
    { type: 'Z' as const }
  ];
  const dot = ellipsePath(205, 24, 13, 13);
  return baseProject(
    'pg',
    '滑移反射羽毛',
    w,
    h,
    [
      object(uid('object'), '滑移羽毛（越过边界）', feather, {
        fill: '#dc2626',
        stroke: '#450a0a',
        strokeWidth: 3,
        opacity: 0.9
      }),
      object(uid('object'), '滑移点', dot, {
        fill: '#fde047',
        stroke: '#713f12',
        strokeWidth: 2,
        opacity: 0.78
      })
    ]
  );
}

export function rotationSample(): Project {
  const w = 240;
  // p4 ignores height and uses a square conventional cell.
  const wedge = [
    { type: 'M' as const, x: 10, y: 8 },
    { type: 'L' as const, x: 104, y: 0 },
    { type: 'Q' as const, cx: 76, cy: 38, x: 22, y: 58 },
    { type: 'C' as const, cx1: 5, cy1: 40, cx2: 7, cy2: 20, x: 10, y: 8 },
    { type: 'Z' as const }
  ];
  const glassTile = rectanglePath(24, 74, 72, 34);
  return baseProject(
    'p4m',
    '90° 旋转与对角反射',
    w,
    w,
    [
      object(uid('object'), '四向楔形', wedge, {
        fill: '#7c3aed',
        stroke: '#2e1065',
        strokeWidth: 3,
        opacity: 0.86
      }),
      object(uid('object'), '半透明方片', glassTile, {
        fill: '#06b6d4',
        stroke: '#083344',
        strokeWidth: 2,
        opacity: 0.38
      })
    ]
  );
}

export function defaultProject(): Project {
  return p6mSample();
}
