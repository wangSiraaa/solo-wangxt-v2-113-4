import type { Project } from '../types';
import { GROUP_SPECS, getCellSize, translationMatrix } from './groups';
import { applyMat3, instanceMatrix } from './render';
import { makePath2D, makePolygonPath, tracePath } from './path';

export interface TileResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  repeats: [number, number];
  primitive: [number, number];
}

/**
 * Render a true periodic image. Rectangular groups use one conventional cell.
 * Triangular groups export a rectangular supercell formed by 2×2 primitive vectors,
 * which still repeats under the wallpaper group's translation lattice. Fundamental
 * domains are clipped as matrix images, including on transparent pixels.
 */
export function exportPeriodicTile(project: Project, scale = 2): TileResult {
  const [cellW, cellH] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const spec = GROUP_SPECS[project.group];
  const triangular =
    project.group === 'p3' ||
    project.group === 'p3m1' ||
    project.group === 'p31m' ||
    project.group === 'p6' ||
    project.group === 'p6m';
  const repeatN = triangular ? 2 : 1;
  const repeatM = triangular ? 2 : 1;
  const width = cellW * repeatN;
  const height = cellH * repeatM;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  // Keep the exported tile transparent: deliberately do not paint a background.
  ctx.clearRect(0, 0, width, height);

  const cosetMatrices = spec.cosets(cellW, cellH);
  const domainPath = makePath2D(makePolygonPath(spec.domain(cellW, cellH)));

  // A few extra neighboring primitive copies are needed only because some fundamental
  // domain coordinates (pm/pmg/cm) extend across the conventional rectangle's border.
  const range = triangular
    ? { nMin: -1, nMax: 2, mMin: -1, mMax: 2 }
    : { nMin: -1, nMax: 1, mMin: -1, mMax: 1 };

  for (const item of project.objects) {
    const path = makePath2D(item.path);
    for (let coset = 0; coset < cosetMatrices.length; coset += 1) {
      for (let n = range.nMin; n <= range.nMax; n += 1) {
        for (let m = range.mMin; m <= range.mMax; m += 1) {
          ctx.save();
          // Translate into the positive rectangular supercell before clipping.
          const shift = translationMatrix(project.group, cellW, cellH, triangular ? 1 : 0, triangular ? 1 : 0);
          const matrix = shift;
          void matrix;
          applyMat3(ctx, instanceMatrix(project, coset, n + (triangular ? 1 : 0), m + (triangular ? 1 : 0)));
          ctx.beginPath();
          ctx.rect(0, 0, width, height);
          ctx.clip();
          ctx.clip(domainPath);
          ctx.globalAlpha = item.opacity;
          if (item.fill !== 'transparent') {
            ctx.fillStyle = item.fill;
            ctx.fill(path);
          }
          if (item.strokeWidth > 0) {
            ctx.strokeStyle = item.stroke;
            ctx.lineWidth = item.strokeWidth;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke(path);
          }
          ctx.restore();
        }
      }
    }
  }
  void tracePath;
  return {
    canvas,
    width,
    height,
    repeats: [repeatN, repeatM],
    primitive: [cellW, cellH]
  };
}

export function downloadTile(project: Project, scale = 2) {
  const tile = exportPeriodicTile(project, scale);
  tile.canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^\p{L}\p{N}._-]+/gu, '-')}-${project.group}-tile.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
