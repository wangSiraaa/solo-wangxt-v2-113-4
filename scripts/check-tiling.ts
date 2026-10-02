import { GROUP_SPECS, compose, getCellSize, invert, latticeVectors, translationMatrix, transformPoint } from '../src/lib/groups.ts';
import type { GroupId, Point } from '../src/types.ts';

const w = 300;
const h = 240;

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[j]![0];
    const yi = polygon[j]![1];
    const xj = polygon[i]![0];
    const yj = polygon[i]![1];
    const crosses =
      (yi > point[1]) !== (yj > point[1]) &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function solveBasis(group: GroupId, cw: number, ch: number, x: number, y: number): Point {
  const [[a, b], [c, d]] = latticeVectors(group, cw, ch);
  const determinant = a * d - b * c;
  return [(d * x - c * y) / determinant, (-b * x + a * y) / determinant];
}

function coverageCount(group: GroupId, x: number, y: number): number {
  const [cw, ch] = getCellSize(group, w, h);
  const spec = GROUP_SPECS[group];
  const cosets = spec.cosets(cw, ch);
  const [na, mb] = solveBasis(group, cw, ch, x, y);
  const nCenter = Math.round(na);
  const mCenter = Math.round(mb);
  let count = 0;
  for (let n = nCenter - 3; n <= nCenter + 3; n++) {
    for (let m = mCenter - 3; m <= mCenter + 3; m++) {
      const cosetMatrix = spec.cosets(cw, ch);
      for (let cosetIndex = 0; cosetIndex < cosetMatrix.length; cosetIndex++) {
        const total = compose(
          translationMatrix(group, cw, ch, n, m),
          cosetMatrix[cosetIndex]!
        );
        const q = transformPoint(invert(total), x, y);
        if (pointInPolygon(q, spec.domain(cw, ch))) count++;
      }
    }
  }
  return count;
}

let failures = 0;
const groups = Object.keys(GROUP_SPECS) as GroupId[];
for (const group of groups) {
  const [cw, ch] = getCellSize(group, w, h);
  const tri = group === 'p3' || group === 'p3m1' || group === 'p31m' || group === 'p6' || group === 'p6m';
  const centered = group === 'cm' || group === 'cmm';
  const xMin = centered ? -cw / 2 : 0;
  const xMax = centered ? cw / 2 : tri ? 2 * cw : cw;
  const yMin = group === 'pmg' ? -ch / 2 : 0;
  const yMax = tri ? 2 * ch : ch;
  let bad = 0;
  const samples = 30000;
  for (let i = 0; i < samples; i++) {
    const x = xMin + Math.random() * (xMax - xMin);
    const y = yMin + Math.random() * (yMax - yMin);
    if (coverageCount(group, x, y) !== 1) bad++;
  }
  const rate = bad / samples;
  console.log(group, `non-single-cover rate ${(rate * 100).toFixed(2)}%`);
  // Boundary overlaps account for polygon edges; interior Monte Carlo must be near zero.
  if (rate > 0.002) failures++;
}
process.exit(failures ? 1 : 0);
