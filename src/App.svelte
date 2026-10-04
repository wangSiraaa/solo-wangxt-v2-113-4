<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import CanvasEditor from './components/CanvasEditor.svelte';
  import GroupPanel from './components/GroupPanel.svelte';
  import Inspector from './components/Inspector.svelte';
  import SeamCheck from './components/SeamCheck.svelte';
  import ImportExport from './components/ImportExport.svelte';
  import {
    editor,
    markSaved,
    redo,
    selectObject,
    setProject,
    setTool,
    undo,
    updateProject,
    renderOptions
  } from './lib/stores';
  import { autoSaveEnabled } from './lib/autosave';
  import { deleteProject, listProjects, saveProject } from './lib/db';
  import { defaultProject, glideSample, p6mSample, rotationSample } from './lib/samples';
  import type { Project, Tool } from './types';

  let savedProjects: Project[] = [];
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let activeTab: 'group' | 'inspector' | 'seam' | 'projects' = 'group';
  let transferPanel: ImportExport;

  const tools: Array<{ id: Tool; label: string; title: string }> = [
    { id: 'select', label: '选择/拖动', title: '选择实例并拖动；拖动映射回原始路径' },
    { id: 'node', label: '节点', title: '编辑原始路径的贝塞尔节点和控制点' },
    { id: 'pen', label: '画笔', title: '拖拽或按下移动后松开，创建多边形路径' },
    { id: 'rectangle', label: '矩形', title: '创建矩形' },
    { id: 'ellipse', label: '椭圆', title: '创建椭圆贝塞尔路径' }
  ];

  /**
   * 每次编辑器切换工程（含导入提交）时自增；挂起的防抖计时器回调会核对
   * 自己被调度时的工程 ID，防止旧工作副本在导入后迟到覆盖新记录。
   */
  let projectEpoch = 0;

  function clearPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  function scheduleSave() {
    if (!$autoSaveEnabled) return;
    clearPendingSave();
    const epoch = projectEpoch;
    const projectId = $editor.project.id;
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      if (!$autoSaveEnabled || epoch !== projectEpoch || $editor.project.id !== projectId) return;
      await saveProject($editor.project);
      // 等待期间用户可能已导入并切换工程，落库后再核对一次。
      if (!$autoSaveEnabled || epoch !== projectEpoch || $editor.project.id !== projectId) return;
      markSaved();
      await refreshProjects();
    }, 700);
  }

  async function refreshProjects() {
    savedProjects = await listProjects();
  }

  async function saveNow() {
    if (!$autoSaveEnabled) return;
    clearPendingSave();
    const snapshot = $editor.project;
    await saveProject(snapshot);
    if ($editor.project.id !== snapshot.id) return;
    markSaved();
    await refreshProjects();
  }

  /** 导入流程调用：先暂停自动保存（取消挂起计时器），再强制把当前工作副本落库。 */
  async function flushBeforeImport() {
    clearPendingSave();
    await saveProject($editor.project);
    await refreshProjects();
  }

  function loadProject(project: Project) {
    projectEpoch += 1;
    setProject(project);
    scheduleSave();
  }

  async function removeProject(project: Project) {
    await deleteProject(project.id);
    await refreshProjects();
  }

  function newProject() {
    projectEpoch += 1;
    setProject(defaultProject());
  }

  function keyboard(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if ((event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault();
      redo();
    } else if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault();
      void saveNow();
    }
  }

  const unsubscribe = editor.subscribe(scheduleSave);

  // 导入期间禁用自动保存：立即取消任何挂起计时器，杜绝旧工作副本迟到写入。
  const unsubscribeGate = autoSaveEnabled.subscribe((enabled) => {
    if (!enabled) clearPendingSave();
  });

  async function onTransferCommitted() {
    projectEpoch += 1;
    await refreshProjects();
    // 导入后切换到工程库，展示新增/合并结果与冲突映射。
    activeTab = 'projects';
  }

  onMount(async () => {
    await refreshProjects();
    window.addEventListener('keydown', keyboard);
  });

  onDestroy(() => {
    unsubscribe();
    unsubscribeGate();
    window.removeEventListener('keydown', keyboard);
    clearPendingSave();
  });
</script>

<main>
  <header>
    <div>
      <h1>墙纸群无缝图案编辑器</h1>
      <p>矩阵复合生成平移、旋转、反射与滑移；IndexedDB 本地保存，无服务端。</p>
    </div>
    <div class="project-meta">
      <input
        value={$editor.project.name}
        on:change={(e) =>
          updateProject((project) => ({ ...project, name: e.currentTarget.value }))}
      />
      <span class:ok={$editor.saved}>{$editor.saved ? '已保存' : '待保存'}</span>
      <button on:click={saveNow}>保存</button>
    </div>
  </header>

  <section class="toolbar">
    <div class="tools">
      {#each tools as tool}
        <button class:active={$editor.tool === tool.id} title={tool.title} on:click={() => setTool(tool.id)}>
          {tool.label}
        </button>
      {/each}
    </div>
    <div class="history">
      <button disabled={!$editor.canUndo} on:click={undo}>撤销</button>
      <button disabled={!$editor.canRedo} on:click={redo}>重做</button>
    </div>
    <div class="samples">
      <button on:click={() => { projectEpoch += 1; setProject(glideSample()); }}>滑移样例</button>
      <button on:click={() => { projectEpoch += 1; setProject(rotationSample()); }}>旋转样例</button>
      <button on:click={() => { projectEpoch += 1; setProject(p6mSample()); }}>完整样例</button>
      <button on:click={newProject}>重置</button>
      <button on:click={() => (activeTab = 'projects')} title="导入/导出离线工程包">导入/导出包</button>
    </div>
    <label class="toggle"><input type="checkbox" bind:checked={$renderOptions.showDomain} />基本域</label>
    <label class="toggle"><input type="checkbox" bind:checked={$renderOptions.showGrid} />晶格</label>
    <label class="toggle"><input type="checkbox" bind:checked={$renderOptions.showSymmetry} />对称元素</label>
  </section>

  <section class="workspace">
    <aside class="left">
      <nav>
        <button class:active={activeTab === 'group'} on:click={() => (activeTab = 'group')}>群/矩阵</button>
        <button class:active={activeTab === 'inspector'} on:click={() => (activeTab = 'inspector')}>对象</button>
        <button class:active={activeTab === 'seam'} on:click={() => (activeTab = 'seam')}>接缝/导出</button>
        <button class:active={activeTab === 'projects'} on:click={() => (activeTab = 'projects')}>工程库</button>
      </nav>
      <div class="panel-scroll">
        {#if activeTab === 'group'}
          <GroupPanel />
        {:else if activeTab === 'inspector'}
          <Inspector />
        {:else if activeTab === 'seam'}
          <SeamCheck>
            <div class="seam-transfer">
              <button on:click={() => transferPanel.exportPackage()} title="导出含群、路径、样式、对象 ID 与格式版本的离线工程包">
                导出工程包 (.wsp.json)
              </button>
            </div>
          </SeamCheck>
        {:else}
          <section class="projects">
            <h3>工程库 / 离线交换</h3>
            <ImportExport
              bind:this={transferPanel}
              saveCurrent={flushBeforeImport}
              bindCommit={onTransferCommitted}
            />
            <div class="saved-head">
              <h4>IndexedDB 工程</h4>
              <button on:click={refreshProjects}>刷新</button>
            </div>
            {#if savedProjects.length === 0}
              <p>暂无已保存工程。编辑会自动保存。</p>
            {:else}
              <ul>
                {#each savedProjects as project (project.id)}
                  <li>
                    <div>
                      <strong>{project.name}</strong>
                      <small>{project.group} · {new Date(project.updatedAt).toLocaleString()}</small>
                      {#if project.importTrace}
                        <small class="trace-line">
                          {project.importTrace.mode === 'merge' ? '合并导入' : '导入创建'} · 格式 v{project.importTrace.packageFormat}
                          · {project.importTrace.objects.length} 个对象
                          ({project.importTrace.objects.filter((o) => o.remapped).length} 个 ID 重映射)
                        </small>
                      {/if}
                    </div>
                    <button on:click={() => loadProject(project)}>打开</button>
                    <button class="danger" on:click={() => removeProject(project)}>删除</button>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}
      </div>
    </aside>
    <CanvasEditor />
    <aside class="right">
      <h3>原始对象</h3>
      <p class="note">点击列表直接选择唯一原始对象；画布上所有实例共享同一身份 ID。</p>
      <ul class="object-list">
        {#each $editor.project.objects as object (object.id)}
          <li class:active={object.id === $editor.selectedId}>
            <button on:click={() => selectObject(object.id, null)}>
              <i style={`background:${object.fill};opacity:${object.opacity}`}></i>
              <span>{object.name}</span>
            </button>
          </li>
        {/each}
      </ul>
    </aside>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #0f172a;
    background: #f1f5f9;
  }
  :global(button) {
    border: 1px solid #cbd5e1;
    background: white;
    color: #0f172a;
    border-radius: 7px;
    padding: 6px 9px;
    cursor: pointer;
    font-size: 12px;
  }
  :global(button:hover) {
    background: #f8fafc;
  }
  :global(button:disabled) {
    cursor: not-allowed;
    opacity: 0.45;
  }
  :global(button.active) {
    background: #1d4ed8;
    border-color: #1d4ed8;
    color: white;
  }
  :global(input),
  :global(select) {
    box-sizing: border-box;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 5px 7px;
    font: inherit;
  }
  main {
    height: 100vh;
    display: grid;
    grid-template-rows: auto auto 1fr;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 16px;
    background: #0f172a;
    color: white;
  }
  h1 {
    margin: 0;
    font-size: 18px;
  }
  p {
    margin: 3px 0 0;
    font-size: 12px;
    color: #cbd5e1;
  }
  .project-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .project-meta input {
    width: 220px;
  }
  .ok {
    color: #86efac;
  }
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 12px;
    background: white;
    border-bottom: 1px solid #cbd5e1;
  }
  .tools,
  .history,
  .samples {
    display: flex;
    gap: 6px;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
  }
  .workspace {
    min-height: 0;
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr) 240px;
  }
  .left,
  .right {
    min-height: 0;
    background: white;
    border-right: 1px solid #cbd5e1;
    display: flex;
    flex-direction: column;
  }
  .right {
    border-right: 0;
    border-left: 1px solid #cbd5e1;
    padding: 12px;
  }
  nav {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-bottom: 1px solid #e2e8f0;
  }
  nav button {
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
  }
  nav button.active {
    background: #eff6ff;
    color: #1d4ed8;
    border-bottom-color: #1d4ed8;
  }
  .panel-scroll {
    overflow: auto;
    padding: 12px;
  }
  .projects ul,
  .object-list {
    list-style: none;
    padding: 0;
    margin: 10px 0;
    display: grid;
    gap: 7px;
  }
  .projects li {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 6px;
    padding: 7px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
  }
  .projects small {
    display: block;
    color: #64748b;
  }
  .projects .trace-line {
    color: #1d4ed8;
  }
  .saved-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 14px 0 0;
  }
  .saved-head h4 {
    margin: 0;
  }
  .seam-transfer {
    display: flex;
    width: 100%;
  }
  .seam-transfer button {
    flex: 1;
  }
  .danger {
    background: #fff1f2;
    color: #be123c;
    border-color: #fecdd3;
  }
  .object-list button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
  }
  .object-list li.active button {
    border-color: #f97316;
    background: #fff7ed;
  }
  .object-list i {
    width: 16px;
    height: 16px;
    border: 1px solid #0f172a;
    border-radius: 50%;
    display: inline-block;
  }
  .note {
    color: #64748b;
    line-height: 1.45;
  }
</style>
