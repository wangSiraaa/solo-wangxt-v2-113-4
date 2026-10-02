import { mat3 } from 'gl-matrix';
import type { GroupId, Point } from '../types';

export interface GeneratorSpec {
  name: string;
  symbol: string;
  description: string;
  matrix: (w: number, h: number) => mat3;
}

export interface GroupSpec {
  id: GroupId;
  name: string;
  crystalName: string;
  order: number;
  lattice: 'rect' | 'centered' | 'tri';
  generators: GeneratorSpec[];
  cosets: (w: number, h: number) => mat3[];
  domain: (w: number, h: number) => Point[];
  relations: string[];
}

/**
 * All transformations are stored as gl-matrix mat3 values in column-major order.
 * Canvas consumes the same affine entries as ctx.transform(a,b,c,d,e,f).
 */
export const identity = (): mat3 => mat3.identity(mat3.create());

export const translation = (x: number, y: number): mat3 => mat3.fromTranslation(mat3.create(), [x, y]);

export const linear = (a: number, b: number, c: number, d: number): mat3 => {
  const m = identity();
  m[0] = a;
  m[1] = b;
  m[3] = c;
  m[4] = d;
  return m;
};

export const rotation = (cx: number, cy: number, angle: number): mat3 => {
  const turn = mat3.fromRotation(mat3.create(), angle);
  const move = translation(cx, cy);
  const back = translation(-cx, -cy);
  return mat3.multiply(mat3.create(), move, mat3.multiply(mat3.create(), turn, back));
};

export const reflectionX = (y = 0): mat3 => {
  const m = linear(1, 0, 0, -1);
  m[7] = 2 * y;
  return m;
};

export const reflectionY = (x = 0): mat3 => {
  const m = linear(-1, 0, 0, 1);
  m[6] = 2 * x;
  return m;
};

export const reflectionLine = (angle: number, cx = 0, cy = 0): mat3 => {
  const c = Math.cos(angle * 2);
  const s = Math.sin(angle * 2);
  const move = translation(cx, cy);
  const back = translation(-cx, -cy);
  const reflected = linear(c, s, s, -c);
  return mat3.multiply(
    mat3.create(),
    move,
    mat3.multiply(mat3.create(), reflected, back)
  );
};

export const clone = (m: mat3): mat3 => mat3.clone(m);

/** gl-matrix product A B: B is applied first to a column vector. */
export const multiply = (a: mat3, b: mat3): mat3 => mat3.multiply(mat3.create(), a, b);

/** Apply matrices in mathematical left-to-right notation: compose(A, B) = A ∘ B. */
export const compose = (...matrices: mat3[]) =>
  matrices.reduce((result, m) => multiply(result, m), identity());

export function invert(m: mat3): mat3 {
  return mat3.invert(mat3.create(), m) ?? identity();
}

export const transformPoint = (m: mat3, x: number, y: number): Point => [
  m[0] * x + m[3] * y + m[6],
  m[1] * x + m[4] * y + m[7]
];

const rot90 = rotation(0, 0, Math.PI / 2);
const rot120 = rotation(0, 0, (Math.PI * 2) / 3);
const rot60 = rotation(0, 0, Math.PI / 3);

/** Reflection across y = x. */
const reflectDiagonal = linear(0, 1, 1, 0);
/** Reflection across the 30-degree line of a triangular lattice. */
const reflect30 = reflectionLine(Math.PI / 6);
/** Reflection across the x-axis (0°), used by p3m1/p31m chambers. */
const reflectHorizontal = reflectionX(0);

const powers = (m: mat3, count: number): mat3[] => {
  const result: mat3[] = [identity()];
  for (let i = 1; i < count; i += 1) {
    result.push(multiply(result[i - 1]!, m));
  }
  return result;
};

const dihedral = (r: mat3, s: mat3, n: number): mat3[] => {
  const rotations = powers(r, n);
  const reflected = rotations.map((rr) => multiply(rr, s));
  return [...rotations, ...reflected];
};

const rectDomain = (w: number, h: number): Point[] => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h]
];

const rectTranslations = (): GeneratorSpec[] => [
  {
    name: '水平平移 t₁',
    symbol: 't₁',
    description: '(w, 0)',
    matrix: (w) => translation(w, 0)
  },
  {
    name: '竖直平移 t₂',
    symbol: 't₂',
    description: '(0, h)',
    matrix: (_w, h) => translation(0, h)
  }
];

export const GROUP_SPECS: Record<GroupId, GroupSpec> = {
  p1: {
    id: 'p1',
    name: 'p1 · 斜交/原始平移',
    crystalName: 'o',
    order: 1,
    lattice: 'rect',
    generators: [...rectTranslations()],
    cosets: () => [identity()],
    domain: rectDomain,
    relations: ['t₂t₁ = t₁t₂']
  },
  p2: {
    id: 'p2',
    name: 'p2 · 180° 旋转',
    crystalName: '2222',
    order: 2,
    lattice: 'rect',
    generators: [
      ...rectTranslations(),
      {
        name: '半转 r',
        symbol: 'r',
        description: '绕原点旋转 180°',
        matrix: () => rotation(0, 0, Math.PI)
      }
    ],
    cosets: () => [identity(), rotation(0, 0, Math.PI)],
    domain: (w, h) => [
      [0, 0],
      [w, 0],
      [w, h / 2],
      [0, h / 2]
    ],
    relations: ['r² = 1', 'rt₁r = t₁⁻¹', 'rt₂r = t₂⁻¹']
  },
  pm: {
    id: 'pm',
    name: 'pm · 平行反射',
    crystalName: '**',
    order: 2,
    lattice: 'rect',
    generators: [
      ...rectTranslations(),
      {
        name: '竖直镜面 m',
        symbol: 'm',
        description: '反射轴 x = 0',
        matrix: () => reflectionY(0)
      }
    ],
    cosets: () => [identity(), reflectionY(0)],
    domain: (w, h) => [
      [-w / 2, 0],
      [0, 0],
      [0, h],
      [-w / 2, h]
    ],
    relations: ['m² = 1', 'mt₁m = t₁⁻¹', 'mt₂ = t₂m']
  },
  pg: {
    id: 'pg',
    name: 'pg · 滑移反射',
    crystalName: 'xx',
    order: 2,
    lattice: 'rect',
    generators: [
      ...rectTranslations(),
      {
        name: '滑移反射 g',
        symbol: 'g',
        description: '(x + w/2, -y)',
        matrix: (w) => {
          const m = reflectionX(0);
          m[6] = w / 2;
          return m;
        }
      }
    ],
    cosets: (w) => {
      const g = reflectionX(0);
      g[6] = w / 2;
      return [identity(), g];
    },
    domain: (w, h) => [
      [0, 0],
      [0, h / 2],
      [w, h / 2],
      [w, 0]
    ],
    relations: ['g² = t₁', 'g t₂ g = t₂']
  },
  cm: {
    id: 'cm',
    name: 'cm · 居中反射/滑移',
    crystalName: '*x',
    order: 2,
    lattice: 'centered',
    generators: [
      {
        name: '居中平移 t₁',
        symbol: 't₁',
        description: '(w/2, h/2)',
        matrix: (w, h) => translation(w / 2, h / 2)
      },
      {
        name: '居中平移 t₂',
        symbol: 't₂',
        description: '(-w/2, h/2)',
        matrix: (w, h) => translation(-w / 2, h / 2)
      },
      {
        name: '镜面 m',
        symbol: 'm',
        description: '反射轴 x = 0',
        matrix: () => reflectionY(0)
      }
    ],
    cosets: () => [identity(), reflectionY(0)],
    domain: (w, h) => [
      [0, 0],
      [w / 2, h / 2],
      [0, h]
    ],
    relations: ['m² = 1', 'mt₁ = t₂m']
  },
  pmm: {
    id: 'pmm',
    name: 'pmm · 正交双反射',
    crystalName: '*2222',
    order: 4,
    lattice: 'rect',
    generators: [
      ...rectTranslations(),
      { name: '水平镜面 mₓ', symbol: 'mₓ', description: 'y = 0', matrix: () => reflectionX(0) },
      { name: '竖直镜面 m_y', symbol: 'm_y', description: 'x = 0', matrix: () => reflectionY(0) }
    ],
    cosets: () => [identity(), reflectionX(0), reflectionY(0), multiply(reflectionX(0), reflectionY(0))],
    domain: (w, h) => [
      [0, 0],
      [w / 2, 0],
      [w / 2, h / 2],
      [0, h / 2]
    ],
    relations: ['mₓ² = m_y² = 1', 'mₓm_y = r₁₈₀', 'r₁₈₀² = 1']
  },
  pmg: {
    id: 'pmg',
    name: 'pmg · 镜面与滑移',
    crystalName: '22*',
    order: 4,
    lattice: 'rect',
    generators: [
      ...rectTranslations(),
      { name: '竖直镜面 m_y', symbol: 'm_y', description: 'x = 0', matrix: () => reflectionY(0) },
      {
        name: '水平滑移 gₓ',
        symbol: 'g',
        description: '(x + w/2, -y)',
        matrix: (w) => {
          const m = reflectionX(0);
          m[6] = w / 2;
          return m;
        }
      }
    ],
    cosets: (w) => {
      const my = reflectionY(0);
      const g = reflectionX(0);
      g[6] = w / 2;
      return [identity(), my, g, multiply(my, g)];
    },
    domain: (w, h) => [
      [0, 0],
      [w / 2, 0],
      [w / 2, h / 2],
      [0, h / 2]
    ],
    relations: ['m_y² = 1', 'g² = t₁', 'm_y g m_y = g⁻¹']
  },
  cmm: {
    id: 'cmm',
    name: 'cmm · 居中菱形反射',
    crystalName: '2*22',
    order: 4,
    lattice: 'centered',
    generators: [
      {
        name: '居中平移 t₁',
        symbol: 't₁',
        description: '(w/2, h/2)',
        matrix: (w, h) => translation(w / 2, h / 2)
      },
      {
        name: '居中平移 t₂',
        symbol: 't₂',
        description: '(-w/2, h/2)',
        matrix: (w, h) => translation(-w / 2, h / 2)
      },
      { name: '水平镜面 mₓ', symbol: 'mₓ', description: 'y = 0', matrix: () => reflectionX(0) },
      { name: '竖直镜面 m_y', symbol: 'm_y', description: 'x = 0', matrix: () => reflectionY(0) }
    ],
    cosets: () => [identity(), reflectionX(0), reflectionY(0), multiply(reflectionX(0), reflectionY(0))],
    domain: (w, h) => [
      [0, 0],
      [w / 2, 0],
      [w / 2, h / 2]
    ],
    relations: ['mₓ² = m_y² = 1', 'mₓt₁mₓ = t₂']
  },
  p4: {
    id: 'p4',
    name: 'p4 · 90° 旋转',
    crystalName: '442',
    order: 4,
    lattice: 'rect',
    generators: [
      ...rectTranslations(),
      { name: '四分之一转 r₄', symbol: 'r₄', description: '绕原点旋转 90°', matrix: () => rot90 }
    ],
    cosets: () => powers(rot90, 4),
    domain: (w) => [
      [0, 0],
      [w / 2, 0],
      [w / 2, w / 2],
      [0, w / 2]
    ],
    relations: ['r₄⁴ = 1', 'r₄t₁r₄⁻¹ = t₂', 'r₄t₂r₄⁻¹ = t₁⁻¹']
  },
  p4m: {
    id: 'p4m',
    name: 'p4m · 四重旋转与镜面',
    crystalName: '*442',
    order: 8,
    lattice: 'rect',
    generators: [
      ...rectTranslations(),
      { name: '四分之一转 r₄', symbol: 'r₄', description: '绕原点旋转 90°', matrix: () => rot90 },
      { name: '对角镜面 s', symbol: 's', description: 'y = x', matrix: () => reflectDiagonal }
    ],
    cosets: () => dihedral(rot90, reflectDiagonal, 4),
    domain: (w) => [
      [0, 0],
      [w / 2, 0],
      [w / 2, w / 2]
    ],
    relations: ['r₄⁴ = s² = 1', 'sr₄s = r₄⁻¹']
  },
  p4g: {
    id: 'p4g',
    name: 'p4g · 四重旋转与对角镜面/滑移',
    crystalName: '4*2',
    order: 8,
    lattice: 'rect',
    generators: [
      ...rectTranslations(),
      {
        name: '四分之一转 r₄',
        symbol: 'r₄',
        description: '绕 (w/2,w/2) 旋转 90°',
        matrix: (w) => rotation(w / 2, w / 2, Math.PI / 2)
      },
      {
        name: '对角镜面 s',
        symbol: 's',
        description: '过原点的 y=x 镜面',
        matrix: () => reflectDiagonal
      }
    ],
    cosets: (w) => dihedral(rotation(w / 2, w / 2, Math.PI / 2), reflectDiagonal, 4),
    domain: (w) => [
      [0, 0],
      [w / 2, 0],
      [w / 2, w / 2]
    ],
    relations: ['r₄⁴ = s² = 1', '(r₄s)² = 1', 's r₄ s = r₄⁻¹']
  },
  p3: {
    id: 'p3',
    name: 'p3 · 120° 旋转',
    crystalName: '333',
    order: 3,
    lattice: 'tri',
    generators: [
      { name: '三角平移 t₁', symbol: 't₁', description: '(w, 0)', matrix: (w) => translation(w, 0) },
      {
        name: '三角平移 t₂',
        symbol: 't₂',
        description: '(w/2, h)',
        matrix: (w, h) => translation(w / 2, h)
      },
      { name: '三分之一转 r₃', symbol: 'r₃', description: '绕原点旋转 120°', matrix: () => rot120 }
    ],
    cosets: () => powers(rot120, 3),
    domain: (_w, h) => [
      [0, 0],
      [h / Math.sqrt(3), h / 3],
      [0, (2 * h) / 3],
      [-h / Math.sqrt(3), h / 3]
    ],
    relations: ['r₃³ = 1', 'r₃t₁r₃⁻¹ = t₂', 'r₃t₂r₃⁻¹ = t₂t₁⁻¹']
  },
  p3m1: {
    id: 'p3m1',
    name: 'p3m1 · 三重中心位于镜面',
    crystalName: '*333',
    order: 6,
    lattice: 'tri',
    generators: [
      { name: '三角平移 t₁', symbol: 't₁', description: '(w, 0)', matrix: (w) => translation(w, 0) },
      {
        name: '三角平移 t₂',
        symbol: 't₂',
        description: '(w/2, h)',
        matrix: (w, h) => translation(w / 2, h)
      },
      { name: '三分之一转 r₃', symbol: 'r₃', description: '绕原点旋转 120°', matrix: () => rot120 },
      { name: '水平镜面 s', symbol: 's', description: 'x 轴镜面', matrix: () => reflectHorizontal }
    ],
    cosets: () => dihedral(rot120, reflectHorizontal, 3),
    domain: (w, h) => [
      [0, 0],
      [w / 2, 0],
      [w / 2, h / 3],
      [w / 4, h / 2]
    ],
    relations: ['r₃³ = s² = 1', 'sr₃s = r₃⁻¹']
  },
  p31m: {
    id: 'p31m',
    name: 'p31m · 交错三重中心与镜面',
    crystalName: '3*3',
    order: 6,
    lattice: 'tri',
    generators: [
      { name: '三角平移 t₁', symbol: 't₁', description: '(w, 0)', matrix: (w) => translation(w, 0) },
      {
        name: '三角平移 t₂',
        symbol: 't₂',
        description: '(w/2, h)',
        matrix: (w, h) => translation(w / 2, h)
      },
      { name: '三分之一转 r₃', symbol: 'r₃', description: '绕原点旋转 120°', matrix: () => rot120 },
      { name: '30° 镜面 s', symbol: 's', description: '过原点的 30° 镜面', matrix: () => reflect30 }
    ],
    cosets: () => dihedral(rot120, reflect30, 3),
    domain: (w, h) => [
      [0, 0],
      [w / 2, -h / 3],
      [w / 2, h / 3]
    ],
    relations: ['r₃³ = s² = 1', 'sr₃s = r₃⁻¹']
  },
  p6: {
    id: 'p6',
    name: 'p6 · 60° 旋转',
    crystalName: '632',
    order: 6,
    lattice: 'tri',
    generators: [
      { name: '三角平移 t₁', symbol: 't₁', description: '(w, 0)', matrix: (w) => translation(w, 0) },
      {
        name: '三角平移 t₂',
        symbol: 't₂',
        description: '(w/2, h)',
        matrix: (w, h) => translation(w / 2, h)
      },
      { name: '六分之一转 r₆', symbol: 'r₆', description: '绕原点旋转 60°', matrix: () => rot60 }
    ],
    cosets: () => powers(rot60, 6),
    domain: (_w, h) => [
      [0, 0],
      [h / Math.sqrt(3), h / 3],
      [0, (2 * h) / 3]
    ],
    relations: ['r₆⁶ = 1', 'r₆t₁r₆⁻¹ = t₂', 'r₆t₂r₆⁻¹ = t₂t₁⁻¹']
  },
  p6m: {
    id: 'p6m',
    name: 'p6m · 六重旋转与镜面',
    crystalName: '*632',
    order: 12,
    lattice: 'tri',
    generators: [
      { name: '三角平移 t₁', symbol: 't₁', description: '(w, 0)', matrix: (w) => translation(w, 0) },
      {
        name: '三角平移 t₂',
        symbol: 't₂',
        description: '(w/2, h)',
        matrix: (w, h) => translation(w / 2, h)
      },
      { name: '六分之一转 r₆', symbol: 'r₆', description: '绕原点旋转 60°', matrix: () => rot60 },
      { name: '30° 镜面 s', symbol: 's', description: '过原点的三角晶格镜面', matrix: () => reflect30 }
    ],
    cosets: () => dihedral(rot60, reflect30, 6),
    domain: (w, h) => [
      [0, 0],
      [w / 2, 0],
      [w / 2, h / 3]
    ],
    relations: ['r₆⁶ = s² = 1', 'sr₆s = r₆⁻¹']
  }
};

export const GROUP_LIST = Object.values(GROUP_SPECS);

export function getCellSize(group: GroupId, w: number, h: number): Point {
  if (group === 'p4' || group === 'p4m' || group === 'p4g') return [w, w];
  if (group === 'p3' || group === 'p3m1' || group === 'p31m' || group === 'p6' || group === 'p6m') {
    return [w, (Math.sqrt(3) / 2) * w];
  }
  return [w, h];
}

export function latticeVectors(group: GroupId, w: number, h: number): [Point, Point] {
  const [cw, ch] = getCellSize(group, w, h);
  if (group === 'cm' || group === 'cmm') {
    return [
      [cw / 2, ch / 2],
      [-cw / 2, ch / 2]
    ];
  }
  if (group === 'p3' || group === 'p3m1' || group === 'p31m' || group === 'p6' || group === 'p6m') {
    return [
      [cw, 0],
      [cw / 2, ch]
    ];
  }
  return [
    [cw, 0],
    [0, ch]
  ];
}

export function translationMatrix(group: GroupId, w: number, h: number, n: number, m: number): mat3 {
  const [[a, b], [c, d]] = latticeVectors(group, w, h);
  return translation(n * a + m * c, n * b + m * d);
}

export function matrixRows(m: mat3): string[] {
  // Display the upper two affine rows in conventional mathematical order.
  return [
    `${m[0].toFixed(3)}  ${m[3].toFixed(3)}  ${m[6].toFixed(3)}`,
    `${m[1].toFixed(3)}  ${m[4].toFixed(3)}  ${m[7].toFixed(3)}`
  ];
}
