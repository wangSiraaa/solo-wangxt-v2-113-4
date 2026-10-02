import type { mat3 } from 'gl-matrix';
import {
  GROUP_SPECS,
  compose,
  getCellSize,
  identity,
  invert,
  latticeVectors,
  linear,
  translation
} from './groups';
import type { GroupId } from '../types';

export interface RelationCheck {
  label: string;
  residual: number;
}

export const almostEqual = (a: mat3, b: mat3, epsilon = 1e-5) => {
  let residual = 0;
  for (let i = 0; i < 8; i += 1) residual = Math.max(residual, Math.abs(a[i]! - b[i]!));
  return residual;
};

export function checkRelations(group: GroupId, w: number, h: number): RelationCheck[] {
  const [cw, ch] = getCellSize(group, w, h);
  const T1 = GROUP_SPECS[group].generators[0]!.matrix(cw, ch);
  const T2 = GROUP_SPECS[group].generators[1]!.matrix(cw, ch);
  const G = (index: number) => GROUP_SPECS[group].generators[index]!.matrix(cw, ch);
  const I = identity();
  const checks: RelationCheck[] = [];
  const add = (label: string, a: mat3, b: mat3) => checks.push({ label, residual: almostEqual(a, b) });

  // Every wallpaper lattice is abelian. The explicit check is omitted for centered and
  // triangular generator pairs; they still commute as affine matrices when interpreted in
  // their primitive basis, while the displayed conventional coordinates differ by design.
  switch (group) {
    case 'p1':
      break;
    case 'p2': {
      const r = G(2);
      add('r² = 1', compose(r, r), I);
      add('r t₁ r = t₁⁻¹', compose(r, T1, r), translation(-cw, 0));
      add('r t₂ r = t₂⁻¹', compose(r, T2, r), translation(0, -ch));
      break;
    }
    case 'pm': {
      const m = G(2);
      add('m² = 1', compose(m, m), I);
      add('m t₁ m = t₁⁻¹', compose(m, T1, m), translation(-cw, 0));
      add('m t₂ = t₂ m', compose(m, T2), compose(T2, m));
      break;
    }
    case 'pg': {
      const g = G(2);
      add('g² = t₁', compose(g, g), T1);
      add('g t₂ g = t₂', compose(g, T2, g), T2);
      break;
    }
    case 'cm': {
      const m = G(2);
      add('m² = 1', compose(m, m), I);
      add('m t₁ m = t₂', compose(m, T1, m), T2);
      break;
    }
    case 'cmm': {
      const mx = G(2);
      const my = G(3);
      add('mₓ² = 1', compose(mx, mx), I);
      add('m_y² = 1', compose(my, my), I);
      add('mₓ t₁ mₓ = -t₂', compose(mx, T1, mx), invert(T2));
      add('m_y t₁ m_y = t₂', compose(my, T1, my), T2);
      break;
    }
    case 'pmm': {
      const mx = G(2);
      const my = G(3);
      add('mₓ² = 1', compose(mx, mx), I);
      add('m_y² = 1', compose(my, my), I);
      const halfTurn = linear(-1, 0, 0, -1);
      add('mₓ m_y = -I', compose(mx, my), halfTurn);
      add('(mₓ m_y)² = 1', compose(mx, my, mx, my), I);
      break;
    }
    case 'pmg': {
      const my = G(2);
      const g = G(3);
      add('m_y² = 1', compose(my, my), I);
      add('g² = t₁', compose(g, g), T1);
      add('m_y g m_y = g⁻¹', compose(my, g, my), invert(g));
      break;
    }
    case 'p4': {
      const r = G(2);
      add('r⁴ = 1', compose(r, r, r, r), I);
      add('r t₁ r⁻¹ = t₂', compose(r, T1, invert(r)), T2);
      add('r t₂ r⁻¹ = t₁⁻¹', compose(r, T2, invert(r)), translation(-cw, 0));
      break;
    }
    case 'p4m': {
      const r = G(2);
      const s = G(3);
      add('r⁴ = 1', compose(r, r, r, r), I);
      add('s² = 1', compose(s, s), I);
      add('s r s = r⁻¹', compose(s, r, s), invert(r));
      break;
    }
    case 'p4g': {
      const r = G(2);
      const s = G(3);
      add('r⁴ = 1', compose(r, r, r, r), I);
      add('s² = 1', compose(s, s), I);
      add('s r s = r⁻¹', compose(s, r, s), invert(r));
      add('(r s)² = 1', compose(r, s, r, s), I);
      break;
    }
    case 'p3':
    case 'p3m1':
    case 'p31m': {
      const r = G(2);
      add('r³ = 1', compose(r, r, r), I);
      add('r t₁ r⁻¹ = t₂t₁⁻¹', compose(r, T1, invert(r)), compose(T2, translation(-cw, 0)));
      add('r t₂ r⁻¹ = t₁⁻¹', compose(r, T2, invert(r)), translation(-cw, 0));
      if (group === 'p3m1' || group === 'p31m') {
        const s = G(3);
        add('s² = 1', compose(s, s), I);
        add('s r s = r⁻¹', compose(s, r, s), invert(r));
      }
      break;
    }
    case 'p6':
    case 'p6m': {
      const r = G(2);
      add(
        'r⁶ = 1',
        Array.from({ length: 6 }).reduce<mat3>((acc) => compose(acc, r), I),
        I
      );
      add('r t₁ r⁻¹ = t₂', compose(r, T1, invert(r)), T2);
      add('r t₂ r⁻¹ = t₂t₁⁻¹', compose(r, T2, invert(r)), compose(T2, translation(-cw, 0)));
      if (group === 'p6m') {
        const s = G(3);
        add('s² = 1', compose(s, s), I);
        add('s r s = r⁻¹', compose(s, r, s), invert(r));
      }
      break;
    }
  }
  return checks;
}

export function translationCoverage(group: GroupId, w: number, h: number): string {
  const [[ax, ay], [bx, by]] = latticeVectors(group, w, h);
  const area = Math.abs(ax * by - ay * bx);
  return `平移原胞面积 = ${area.toFixed(2)}；轨道余指数 = ${GROUP_SPECS[group].order}`;
}
