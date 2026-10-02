<script lang="ts">
  import { GROUP_LIST, GROUP_SPECS, getCellSize, matrixRows } from '../lib/groups';
  import { checkRelations, translationCoverage } from '../lib/verifier';
  import { editor, setCellSize, setGroup } from '../lib/stores';
  import type { GroupId } from '../types';

  let showMatrices = false;

  $: project = $editor.project;
  $: [cellW, cellH] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  $: spec = GROUP_SPECS[project.group as GroupId];
  $: checks = checkRelations(project.group, cellW, cellH);
  $: coverage = translationCoverage(project.group, cellW, cellH);
  function chooseGroup(event: Event) {
    const target = event.currentTarget as HTMLSelectElement;
    setGroup(target.value as GroupId);
  }
  $: square = project.group === 'p4' || project.group === 'p4m' || project.group === 'p4g';
  $: triangular =
    project.group === 'p3' ||
    project.group === 'p3m1' ||
    project.group === 'p31m' ||
    project.group === 'p6' ||
    project.group === 'p6m';
</script>

<section class="panel">
  <h3>墙纸群与生成元</h3>
  <label class="group-select">
    群
    <select value={project.group} on:change={chooseGroup}>
      {#each GROUP_LIST as group}
        <option value={group.id}>{group.name}</option>
      {/each}
    </select>
  </label>
  <p class="description">
    {spec.crystalName} · 常规单元 {Math.round(cellW)} × {Math.round(cellH)} · 每原胞 {spec.order} 个轨道像
  </p>

  <div class="sizes">
    <label>
      宽
      <input
        type="number"
        min="60"
        value={project.cellWidth}
        on:change={(e) => setCellSize(Number(e.currentTarget.value), project.cellHeight)}
      />
    </label>
    <label>
      高
      <input
        type="number"
        min="60"
        value={project.cellHeight}
        disabled={square || triangular}
        on:change={(e) => setCellSize(project.cellWidth, Number(e.currentTarget.value))}
      />
    </label>
  </div>
  {#if triangular}
    <p class="note">三角晶格高度锁定为 √3/2 × 宽度。</p>
  {/if}
  {#if square}
    <p class="note">正方形晶格高度锁定为宽度。</p>
  {/if}

  <ul class="generators">
    {#each spec.generators as generator}
      {@const m = generator.matrix(cellW, cellH)}
      <li>
        <strong>{generator.symbol}</strong>
        <span>{generator.name}：{generator.description}</span>
        {#if showMatrices}
          <pre>{matrixRows(m).join('\n')}</pre>
        {/if}
      </li>
    {/each}
  </ul>
  <p class="coverage">{coverage}</p>

  <h4>矩阵群关系验证</h4>
  <ul class="checks">
    {#each checks as check}
      <li class={check.residual < 1e-8 ? 'ok' : 'bad'}>
        <span>{check.residual < 1e-8 ? '✓' : '×'}</span>
        <code>{check.label}</code>
        <em>{check.residual.toExponential(1)}</em>
      </li>
    {/each}
  </ul>
  <ul class="relations">
    {#each spec.relations as relation}
      <li>{relation}</li>
    {/each}
  </ul>
  <button on:click={() => (showMatrices = !showMatrices)}>
    {showMatrices ? '隐藏矩阵数值' : '显示 gl-matrix 矩阵数值'}
  </button>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  h3,
  h4 {
    margin: 0;
  }
  select,
  input {
    width: 100%;
  }
  .group-select {
    display: grid;
    gap: 4px;
  }
  .description,
  .note,
  .coverage {
    margin: 0;
    color: #475569;
    font-size: 12px;
    line-height: 1.4;
  }
  .sizes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .generators,
  .checks,
  .relations {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 6px;
    font-size: 12px;
  }
  .generators li,
  .checks li {
    display: grid;
    gap: 2px;
  }
  pre {
    margin: 4px 0 0;
    padding: 6px;
    background: #0f172a;
    color: #bfdbfe;
    border-radius: 6px;
    overflow-x: auto;
  }
  .checks li {
    grid-template-columns: 20px 1fr auto;
    align-items: center;
  }
  .checks .ok {
    color: #166534;
  }
  .checks .bad {
    color: #991b1b;
  }
  .checks em {
    font-style: normal;
    color: #64748b;
  }
  .relations {
    color: #475569;
  }
</style>
