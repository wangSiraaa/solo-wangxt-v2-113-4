<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '../lib/stores';
  import { downloadTile, exportPeriodicTile, type TileResult } from '../lib/export';

  let preview: HTMLCanvasElement;
  let repeatLayer: HTMLDivElement;
  let tile: TileResult | null = null;
  let dataUrl = '';
  let scale = 2;
  let repeats = 3;

  function rebuild() {
    tile = exportPeriodicTile($editor.project, scale);
    dataUrl = tile.canvas.toDataURL('image/png');
    const ctx = preview.getContext('2d')!;
    ctx.clearRect(0, 0, preview.width, preview.height);
    for (let y = 0; y < repeats; y += 1) {
      for (let x = 0; x < repeats; x += 1) {
        ctx.drawImage(tile.canvas, x * tile.width, y * tile.height, tile.width, tile.height);
      }
    }
    repeatLayer.style.backgroundImage = `url(${dataUrl})`;
    repeatLayer.style.backgroundSize = `${tile.width}px ${tile.height}px`;
    repeatLayer.style.backgroundRepeat = 'repeat';
  }

  function download() {
    downloadTile($editor.project, scale);
  }

  let unsubscribe: () => void;
  onMount(() => {
    rebuild();
    unsubscribe = editor.subscribe(() => requestAnimationFrame(rebuild));
  });

  export { rebuild as refreshTile };
</script>

<section class="seam">
  <div class="row">
    <label>导出倍率 <input type="number" min="1" max="4" bind:value={scale} on:change={rebuild} /></label>
    <button on:click={download}>导出周期单元 PNG</button>
  </div>
  {#if tile}
    <p class="meta">
      单元 {Math.round(tile.width)}×{Math.round(tile.height)}；三角晶格使用 {tile.repeats[0]}×{tile.repeats[1]}
      原胞形成可矩形重复的超级周期；背景保持透明。
    </p>
  {/if}
  <div class="layer" bind:this={repeatLayer}></div>
  <canvas
    bind:this={preview}
    width={1200}
    height={1000}
    title="同一个周期单元 drawImage 重复 3×3，观察水平、竖直及对角接缝"
  ></canvas>
</section>

<style>
  .seam {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  input {
    width: 58px;
  }
  button {
    flex: 1;
  }
  .meta {
    margin: 0;
    color: #475569;
    font-size: 12px;
    line-height: 1.35;
  }
  .layer {
    width: 100%;
    height: 90px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    background-color: #f8fafc;
    background-image:
      linear-gradient(45deg, #e2e8f0 25%, transparent 25%),
      linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #e2e8f0 75%),
      linear-gradient(-45deg, transparent 75%, #e2e8f0 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }
  canvas {
    max-width: 100%;
    max-height: 360px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    background:
      linear-gradient(45deg, #e2e8f0 25%, transparent 25%),
      linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #e2e8f0 75%),
      linear-gradient(-45deg, transparent 75%, #e2e8f0 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }
</style>
