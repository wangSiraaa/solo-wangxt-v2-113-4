<script lang="ts">
  import { editor, markSaved, setProject } from '../lib/stores';
  import { autoSaveEnabled } from '../lib/autosave';
  import {
    buildProjectPackage,
    PackageError,
    parseProjectPackage,
    PACKAGE_FORMAT_VERSION,
    type ParsedProjectPackage
  } from '../lib/package';
  import {
    applySelection,
    planImport,
    type ConflictEntry,
    type ImportMode,
    type ImportPlan
  } from '../lib/importPlan';
  import { commitMergeAtomic, createProjectAtomic } from '../lib/db';
  import { cloneObject } from '../lib/path';
  import type { Project } from '../types';

  type Phase = 'idle' | 'reading' | 'review' | 'committing' | 'done' | 'error';

  /** 父组件注入：导入暂停自动保存后，先把当前工作副本强制落库。 */
  export let saveCurrent: (() => Promise<void>) | null = null;

  let phase: Phase = 'idle';
  let mode: ImportMode = 'create';
  let parsed: ParsedProjectPackage | null = null;
  let plan: ImportPlan | null = null;
  let selected: Record<string, boolean> = {};
  let conflicts: ConflictEntry[] = [];
  let errorTitle = '';
  let errorDetail = '';
  let errorIssues: string[] = [];
  let doneMessage = '';
  let fileInput: HTMLInputElement;
  let exporting = false;
  let exportError = '';

  let onCommitted: (() => void) | null = null;

  export function bindCommit(cb: () => void) {
    onCommitted = cb;
  }

  function reset() {
    phase = 'idle';
    parsed = null;
    plan = null;
    selected = {};
    conflicts = [];
    errorTitle = '';
    errorDetail = '';
    errorIssues = [];
    doneMessage = '';
    if (fileInput) fileInput.value = '';
  }

  function fail(title: string, err: unknown) {
    phase = 'error';
    errorTitle = title;
    if (err instanceof PackageError) {
      errorDetail = err.message;
      errorIssues = err.issues;
    } else {
      errorDetail = err instanceof Error ? err.message : String(err);
      errorIssues = [];
    }
    // 失败时绝不切换画布；恢复自动保存，但不主动触发写入。
    autoSaveEnabled.set(true);
  }

  async function onFileChosen(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    exportError = '';
    phase = 'reading';
    // 导入第一步：停掉自动保存并取消挂起计时器（由 App 订阅该 store 完成），
    // 然后把当前工作副本落库，避免审查期间旧副本迟到覆盖任何记录。
    autoSaveEnabled.set(false);
    try {
      if (saveCurrent) await saveCurrent();
      const text = await file.text();
      parsed = await parseProjectPackage(text);
      const initial = planImport(parsed, $editor.project, 'create');
      mode = initial.compatible ? 'merge' : 'create';
      plan = planImport(parsed, $editor.project, mode);
      selected = { ...plan.selected };
      conflicts = plan.conflicts;
      phase = 'review';
    } catch (err) {
      fail('工程包解析或校验失败，当前画布与工程库均未改变', err);
    }
  }

  function switchMode(next: ImportMode) {
    if (!parsed || !plan) return;
    if (next === 'merge' && !plan.compatible) return;
    mode = next;
    plan = planImport(parsed, $editor.project, mode);
    selected = { ...plan.selected };
    conflicts = plan.conflicts;
  }

  function toggleAll(value: boolean) {
    if (!plan) return;
    for (const obj of plan.target.objects) {
      const isIncoming = plan.trace.objects.some((entry) => entry.finalId === obj.id);
      if (isIncoming) selected[obj.id] = value;
    }
    selected = selected;
  }

  async function commit() {
    if (!parsed || !plan) return;
    const reviewPlan = plan;
    phase = 'committing';
    try {
      const finalProject = applySelection(reviewPlan, selected);
      if (reviewPlan.mode === 'create') {
        await createProjectAtomic(cloneProject(finalProject));
      } else {
        await commitMergeAtomic($editor.project.id, $editor.project.group, cloneProject(finalProject));
      }
      // 事务成功后才允许切换画布与工程列表。
      autoSaveEnabled.set(false);
      setProject(cloneProject(finalProject));
      markSaved();
      const importedCount = finalProject.importTrace?.objects.length ?? 0;
      const remapped = finalProject.importTrace?.objects.filter((o) => o.remapped).length ?? 0;
      doneMessage =
        reviewPlan.mode === 'create'
          ? `已作为独立工程导入：${finalProject.name}（${importedCount} 个对象，格式 v${parsed.formatVersion}${parsed.formatVersion === 0 ? ' 已迁移' : ''}）`
          : `已合并到当前工程：新增 ${importedCount} 个导入对象，其中 ${remapped} 个 ID 冲突已确定性重映射，本地对象全部原样保留。`;
      // 审查计划保留原始冲突全表用于结果展示（包括用户取消勾选的条目）。
      conflicts = reviewPlan.conflicts;
      plan = reviewPlan;
      phase = 'done';
      // 恢复自动保存：setProject 已产生订阅通知，但 gate 是在提交成功后才打开，
      // 因此下一次防抖保存只会写入这个已提交的新副本。
      autoSaveEnabled.set(true);
      if (onCommitted) onCommitted();
    } catch (err) {
      fail('导入提交失败，事务已整体回滚，没有写入任何 IndexedDB 记录', err);
    }
  }

  function cloneProject(project: Project): Project {
    return {
      ...project,
      objects: project.objects.map((obj) => cloneObject(obj)),
      importTrace: project.importTrace
        ? { ...project.importTrace, objects: project.importTrace.objects.map((o) => ({ ...o })) }
        : undefined
    };
  }

  function cancel() {
    autoSaveEnabled.set(true);
    reset();
  }

  async function exportPackage() {
    exporting = true;
    exportError = '';
    try {
      const pkg = await buildProjectPackage($editor.project);
      const blob = new Blob([JSON.stringify(pkg, null, 2)], {
        type: 'application/json;charset=utf-8'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = $editor.project.name.replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'project';
      a.href = url;
      a.download = `${safeName}-${$editor.project.group}.wsp.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      exportError = err instanceof Error ? err.message : String(err);
    } finally {
      exporting = false;
    }
  }

  function isIncoming(id: string): boolean {
    return !!plan?.trace.objects.some((entry) => entry.finalId === id);
  }
</script>

<section class="transfer">
  <div class="block">
    <h4>导出工程包</h4>
    <p class="hint">
      生成 .wsp.json：含格式版本 v{PACKAGE_FORMAT_VERSION}、群、单元尺寸、路径、样式、对象 ID 与 SHA-256 校验和，可离线交换。
    </p>
    <button on:click={exportPackage} disabled={exporting}>
      {exporting ? '正在生成…' : '导出当前工程 (.wsp.json)'}
    </button>
    {#if exportError}<p class="error-line">{exportError}</p>{/if}
  </div>

  <div class="block">
    <h4>导入工程包</h4>
    <p class="hint">先在内存中校验结构、群参数与内容完整性，通过后才会写库；旧格式可迁移，未来格式与篡改内容一律拒绝。</p>
    <input
      bind:this={fileInput}
      type="file"
      accept=".json,.wsp.json,application/json"
      on:change={onFileChosen}
      disabled={phase === 'reading' || phase === 'committing'}
    />
    {#if phase !== 'idle'}
      <button class="ghost" on:click={cancel} disabled={phase === 'reading' || phase === 'committing'}>
        {phase === 'done' || phase === 'error' ? '关闭面板' : '取消'}
      </button>
    {/if}
  </div>

  {#if phase === 'reading'}
    <p class="hint">正在读取并校验文件…</p>
  {:else if phase === 'review' && parsed && plan}
    <div class="review">
      <h4>导入审查（尚未写入任何数据）</h4>
      {#each parsed.warnings as warning}
        <p class="warning">{warning}</p>
      {/each}
      <dl class="meta-grid">
        <dt>源工程</dt><dd>{parsed.project.name}</dd>
        <dt>群 / 晶格</dt>
        <dd>{parsed.project.group} · {Math.round(parsed.project.cellWidth)}×{Math.round(parsed.project.cellHeight)}</dd>
        <dt>对象数</dt><dd>{parsed.project.objects.length}</dd>
        <dt>格式版本</dt><dd>v{parsed.formatVersion}{parsed.formatVersion === 0 ? '（迁移为当前模型）' : ''}</dd>
      </dl>

      <div class="modes">
        <label class:chosen={mode === 'merge'} class:disabled={!plan.compatible}>
          <input
            type="radio"
            name="import-mode"
            value="merge"
            checked={mode === 'merge'}
            disabled={!plan.compatible}
            on:change={() => switchMode('merge')}
          />
          合并到当前工程
        </label>
        <label class:chosen={mode === 'create'}>
          <input type="radio" name="import-mode" value="create" checked={mode === 'create'} on:change={() => switchMode('create')} />
          作为独立工程打开（生成新工程 ID）
        </label>
      </div>

      {#if !plan.compatible}
        <div class="warning box">
          <strong>群或晶格不兼容，不能合并，必须作为独立工程打开：</strong>
          <ul>
            {#each plan.incompatibilities as reason}
              <li>{reason}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if plan.conflicts.length > 0}
        <div class="conflicts">
          <h5>对象 ID 冲突映射（{plan.conflicts.length}）</h5>
          <p class="hint">本地同名对象不会被替换；下列导入对象已获得确定性新 ID，映射永久记录在工程导入轨迹中。</p>
          <ul>
            {#each plan.conflicts as entry}
              <li>
                <code>{entry.incoming.id}</code>
                <span class="arrow">→</span>
                <code class="new-id">{entry.finalId}</code>
                <small>（{entry.incoming.name}）</small>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if mode === 'merge'}
        <div class="object-pick">
          <div class="pick-head">
            <h5>选择要导入的对象（{plan.trace.objects.filter((o) => selected[o.finalId] !== false).length}/{plan.trace.objects.length}）</h5>
            <span class="pick-actions">
              <button class="ghost" on:click={() => toggleAll(true)}>全选导入</button>
              <button class="ghost" on:click={() => toggleAll(false)}>全部不选</button>
            </span>
          </div>
          <ul>
            {#each plan.target.objects as obj (obj.id)}
              {@const incoming = isIncoming(obj.id)}
              <li class:incoming={incoming} class:local={!incoming}>
                {#if incoming}
                  <input type="checkbox" bind:checked={selected[obj.id]} />
                {:else}
                  <span class="lock" title="本地对象不可取消">🔒</span>
                {/if}
                <i style={`background:${obj.fill === 'transparent' ? 'transparent' : obj.fill};opacity:${obj.opacity}`}></i>
                <span>{obj.name}</span>
                <code>{obj.id}</code>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="commit-row">
        <button class="primary" on:click={commit}>
          {mode === 'merge' ? '确认合并（单事务写入）' : '确认创建独立工程（单事务写入）'}
        </button>
      </div>
    </div>
  {:else if phase === 'committing'}
    <p class="hint">正在单个 IndexedDB 事务中提交；中途刷新只会保留完整原工程…</p>
  {:else if phase === 'done' && plan}
    <div class="done box">
      <strong>✓ {doneMessage}</strong>
      {#if plan.conflicts.length > 0}
        <ul class="trace">
          {#each plan.conflicts as entry}
            <li><code>{entry.incoming.id}</code> → <code>{entry.finalId}</code></li>
          {/each}
        </ul>
      {/if}
      <button class="ghost" on:click={reset}>继续</button>
    </div>
  {:else if phase === 'error'}
    <div class="error-box box">
      <strong>✗ {errorTitle}</strong>
      <p>{errorDetail}</p>
      {#if errorIssues.length > 0}
        <ul>{#each errorIssues as issue}<li>{issue}</li>{/each}</ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .transfer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .block {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  h4 {
    margin: 0;
    font-size: 13px;
  }
  h5 {
    margin: 6px 0 4px;
    font-size: 12px;
  }
  .hint {
    margin: 0;
    color: #64748b;
    font-size: 12px;
    line-height: 1.4;
  }
  .warning {
    color: #92400e;
    font-size: 12px;
    margin: 4px 0;
  }
  .box {
    border-radius: 8px;
    padding: 9px 11px;
    font-size: 12px;
  }
  .warning.box {
    background: #fffbeb;
    border: 1px solid #fcd34d;
  }
  .warning ul,
  .error-box ul {
    margin: 5px 0 0;
    padding-left: 18px;
  }
  .error-box {
    background: #fef2f2;
    border: 1px solid #fca5a5;
    color: #991b1b;
  }
  .error-line {
    margin: 0;
    color: #b91c1c;
    font-size: 12px;
  }
  .done {
    background: #f0fdf4;
    border: 1px solid #86efac;
    color: #166534;
  }
  .review {
    border: 1px solid #bfdbfe;
    background: #f8fbff;
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: 84px 1fr;
    gap: 3px 8px;
    margin: 0;
    font-size: 12px;
  }
  .meta-grid dt {
    color: #64748b;
  }
  .meta-grid dd {
    margin: 0;
  }
  .modes {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
  }
  .modes label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: white;
  }
  .modes label.chosen {
    border-color: #2563eb;
    background: #eff6ff;
  }
  .modes label.disabled {
    opacity: 0.55;
  }
  .conflicts {
    background: white;
    border: 1px solid #fcd34d;
    border-radius: 6px;
    padding: 8px;
  }
  .conflicts ul,
  .trace {
    margin: 5px 0 0;
    padding-left: 0;
    list-style: none;
    display: grid;
    gap: 3px;
    font-size: 12px;
  }
  .arrow {
    color: #b45309;
  }
  .new-id {
    color: #1d4ed8;
    font-weight: 600;
  }
  .object-pick ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    max-height: 220px;
    overflow: auto;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
  }
  .object-pick li {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 4px 7px;
    font-size: 12px;
    border-bottom: 1px solid #f1f5f9;
  }
  .object-pick li.incoming {
    background: #f8fbff;
  }
  .object-pick li.local {
    color: #64748b;
    background: #f8fafc;
  }
  .object-pick i {
    width: 12px;
    height: 12px;
    border: 1px solid #0f172a;
    border-radius: 50%;
    display: inline-block;
    flex: none;
  }
  .object-pick code {
    margin-left: auto;
    font-size: 10px;
    color: #94a3b8;
  }
  .pick-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .pick-actions {
    display: flex;
    gap: 4px;
  }
  .commit-row {
    display: flex;
  }
  .primary {
    flex: 1;
    background: #1d4ed8;
    border-color: #1d4ed8;
    color: white;
    font-weight: 600;
  }
  .ghost {
    font-size: 11px;
    padding: 3px 7px;
  }
  input[type='file'] {
    font-size: 12px;
  }
</style>
