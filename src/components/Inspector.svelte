<script lang="ts">
  import { editor, deleteSelected, updateSelectedObject } from '../lib/stores';
  import { requestLocateOriginal } from '../lib/ui';

  const styleFields = [
    { key: 'fill', label: '填充', type: 'color' },
    { key: 'stroke', label: '描边', type: 'color' },
    { key: 'strokeWidth', label: '线宽', type: 'number' },
    { key: 'opacity', label: '不透明度', type: 'range' }
  ] as const;

  function patch(key: string, value: string | number) {
    updateSelectedObject((item) => ({ ...item, [key]: value }) as typeof item);
  }
</script>

<aside class="inspector">
  <h3>对象 / 实例身份</h3>
  {#if $editor.selectedId}
    {@const item = $editor.project.objects.find((object) => object.id === $editor.selectedId)}
    {#if item}
      <p class="id">原始对象 ID<br /><code>{item.id}</code></p>
      <input class="name" value={item.name} on:change={(event) => patch('name', event.currentTarget.value)} />
      <p class="instance">当前选中实例：<code>{$editor.selectedInstance ?? '原始基本单元'}</code></p>
      <button on:click={requestLocateOriginal}>定位到原始对象</button>

      <div class="styles">
        {#each styleFields as field}
          <label>
            {field.label}
            {#if field.type === 'color'}
              <input type="color" value={item[field.key]} on:input={(e) => patch(field.key, e.currentTarget.value)} />
            {:else if field.type === 'number'}
              <input
                type="number"
                min="0"
                max="20"
                step="0.5"
                value={item[field.key]}
                on:input={(e) => patch(field.key, Number(e.currentTarget.value))}
              />
            {:else}
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={item[field.key]}
                on:input={(e) => patch(field.key, Number(e.currentTarget.value))}
              />
            {/if}
          </label>
        {/each}
      </div>
      <button class="danger" on:click={deleteSelected}>删除原始对象（所有实例同步）</button>
    {/if}
  {:else}
    <p class="empty">点选任意图案实例。双击实例可把镜头移回它唯一的原始基本单元。编辑原始路径或样式时，全部由矩阵生成的实例立即同步。</p>
  {/if}
</aside>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h3 {
    margin: 0;
    font-size: 14px;
  }
  .id,
  .instance {
    margin: 0;
    color: #475569;
    font-size: 12px;
    word-break: break-all;
  }
  code {
    color: #0f172a;
  }
  .name {
    width: 100%;
  }
  .styles {
    display: grid;
    gap: 8px;
  }
  label {
    display: grid;
    grid-template-columns: 70px 1fr;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  input[type='color'] {
    height: 30px;
    padding: 0;
  }
  .empty {
    color: #64748b;
    font-size: 13px;
    line-height: 1.5;
  }
  .danger {
    background: #fee2e2;
    color: #991b1b;
    border-color: #fecaca;
  }
</style>
