import type { Project } from '../types';

const DB_NAME = 'wallpaper-symmetry-editor';
const DB_VERSION = 1;
const STORE = 'projects';

/**
 * 懒读取全局 indexedDB：浏览器中始终可用；脚本测试可在导入本模块后注入内存假实现。
 */
function idbFactory(): IDBFactory {
  return (globalThis as { indexedDB?: IDBFactory }).indexedDB!;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idbFactory().open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务已中止'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
  });
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await requestToPromise(tx.objectStore(STORE).put({ ...project, updatedAt: Date.now() }));
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    return await requestToPromise(tx.objectStore(STORE).get(id));
  } finally {
    db.close();
  }
}

export async function listProjects(): Promise<Project[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const projects = await requestToPromise(tx.objectStore(STORE).getAll());
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await requestToPromise(tx.objectStore(STORE).delete(id));
    await txDone(tx);
  } finally {
    db.close();
  }
}

/**
 * 独立工程导入：整条记录在同一个 readwrite 事务中创建。
 * 若主键已存在（理论上新 uid 不会碰撞），事务整体中止，绝不覆盖本地工程。
 */
export async function createProjectAtomic(project: Project): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const existing = await requestToPromise(store.get(project.id));
    if (existing !== undefined) {
      tx.abort();
      throw new Error(`工程 ID ${project.id} 已存在，导入已整体取消`);
    }
    store.add({ ...project });
    await txDone(tx);
  } finally {
    db.close();
  }
}

export interface MergeCommitResult {
  id: string;
  objectCount: number;
  mergedAt: number;
}

/**
 * 合并导入：在同一个事务内读取本地工程 → 复核群一致且每个本地对象原样保留 →
 * 写入合并后的整条记录。任一步失败都 abort，刷新页面也只会看到完整原工程
 * 或完整合并工程，不存在半条记录。
 */
export async function commitMergeAtomic(
  expectedId: string,
  expectedGroup: Project['group'],
  merged: Project
): Promise<MergeCommitResult> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const current = (await requestToPromise(store.get(merged.id))) as Project | undefined;
    if (!current) {
      tx.abort();
      throw new Error(`本地工程 ${merged.id} 不存在，无法合并`);
    }
    if (current.id !== expectedId || current.group !== expectedGroup || merged.group !== current.group) {
      tx.abort();
      throw new Error('本地工程在导入过程中发生了变化（群或 ID 不一致），合并已取消');
    }
    const mergedById = new Map(merged.objects.map((obj) => [obj.id, obj]));
    // 每个本地对象必须以完全相同的 id/路径/样式出现在合并结果中，绝不允许被替换。
    for (const local of current.objects) {
      const kept = mergedById.get(local.id);
      if (!kept || JSON.stringify(kept) !== JSON.stringify(local)) {
        tx.abort();
        throw new Error(`本地对象 ${local.id} 在合并结果中缺失或被改写，事务已中止`);
      }
    }
    const stamp = { ...merged, updatedAt: Date.now() };
    store.put(stamp);
    await txDone(tx);
    return { id: stamp.id, objectCount: stamp.objects.length, mergedAt: stamp.updatedAt };
  } finally {
    db.close();
  }
}
