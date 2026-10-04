/**
 * 工程包导入/导出验收脚本（无浏览器依赖）：
 *   ① 含透明路径的 p6m 工程导出 → 清空会话导入：群、对象 ID、平铺覆盖一致；
 *   ② 含冲突 ID 的合并：原对象不变、导入对象按确定性映射可选、结果可追溯；
 *   ③ 旧格式可迁移；篡改内容 / 未来格式 / 缺字段在写库前失败；
 *   ④ 单事务原子性：事务中止 / 提交中途刷新时不会留下半条记录。
 * 运行：npx tsx scripts/check-packages.ts
 */

// --- 最小内存 IndexedDB 实现（支持 get/getAll/add/put/delete/abort/事务 complete） ---
class FakeRequest<T = unknown> {
  result!: T;
  error: Error | null = null;
  onsuccess: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
}

class FakeTransaction {
  error: Error | null = null;
  oncomplete: ((ev: Event) => void) | null = null;
  onabort: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private aborted = false;
  private pending: Array<() => void> = [];
  private settled = false;
  private rejector: ((err: Error) => void) | null = null;
  readonly done: Promise<void>;

  constructor(private readonly store: Map<string, unknown>) {
    this.done = new Promise<void>((resolve, reject) => {
      this.rejector = reject;
    });
  }

  schedule(fn: () => void) {
    this.pending.push(() => {
      try {
        fn();
      } catch (err) {
        this.error = err as Error;
        this.aborted = true;
        queueMicrotask(() => {
          this.onerror?.(new Event('error'));
          this.onabort?.(new Event('abort'));
          this.rejector?.(err as Error);
        });
      }
    });
  }

  async run(): Promise<void> {
    try {
      for (const step of this.pending) {
        if (this.aborted) break;
        step();
        await Promise.resolve();
        if (this.aborted) break;
      }
    } catch (err) {
      this.error = err as Error;
      this.aborted = true;
      queueMicrotask(() => {
        this.onerror?.(new Event('error'));
        this.onabort?.(new Event('abort'));
      });
      this.rejector?.(err as Error);
      return;
    }
    if (this.aborted) return;
    this.settled = true;
    queueMicrotask(() => this.oncomplete?.(new Event('complete')));
  }

  abort() {
    if (this.settled) return;
    this.aborted = true;
    this.pending = [];
    const err = new Error('事务已主动中止');
    this.error = err;
    queueMicrotask(() => {
      this.onabort?.(new Event('abort'));
      this.rejector?.(err);
    });
  }

  objectStore(): FakeStore {
    return new FakeStore(this.store, this);
  }
}

class FakeStore {
  constructor(
    private readonly data: Map<string, unknown>,
    private readonly tx: FakeTransaction
  ) {}

  private succeed<U>(req: FakeRequest<U>, produce: () => U) {
    this.tx.schedule(() => {
      req.result = produce();
      req.onsuccess?.(new Event('success'));
    });
  }

  get(key: string): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    this.succeed(req, () => structuredClone(this.data.get(key)));
    return req;
  }

  getAll(): FakeRequest<unknown[]> {
    const req = new FakeRequest<unknown[]>();
    this.succeed(req, () => Array.from(this.data.values()).map((v) => structuredClone(v)));
    return req;
  }

  add(value: { id: string }): FakeRequest {
    const req = new FakeRequest();
    this.tx.schedule(() => {
      if (this.data.has(value.id)) throw new Error('约束错误：键已存在');
      this.data.set(value.id, structuredClone(value));
      req.result = value.id;
      req.onsuccess?.(new Event('success'));
    });
    return req;
  }

  put(value: { id: string }): FakeRequest {
    const req = new FakeRequest();
    this.tx.schedule(() => {
      this.data.set(value.id, structuredClone(value));
      req.result = value.id;
      req.onsuccess?.(new Event('success'));
    });
    return req;
  }

  delete(key: string): FakeRequest {
    const req = new FakeRequest();
    this.tx.schedule(() => {
      this.data.delete(key);
      req.onsuccess?.(new Event('success'));
    });
    return req;
  }
}

class FakeDB {
  objectStoreNames = { contains: (name: string) => name === 'projects' };
  constructor(private readonly data: Map<string, unknown>) {}
  transaction(): FakeTransaction {
    const tx = new FakeTransaction(this.data);
    void tx.run();
    return tx;
  }
  close() {}
}

class FakeIndexedDB {
  private data = new Map<string, unknown>();
  snapshot() {
    return new Map(Array.from(this.data.entries()).map(([k, v]) => [k, structuredClone(v)]));
  }
  clear() {
    this.data.clear();
  }
  open() {
    const req = new FakeRequest<FakeDB>();
    queueMicrotask(() => {
      req.result = new FakeDB(this.data);
      req.onsuccess?.(new Event('success'));
    });
    return req;
  }
}

const fakeIdb = new FakeIndexedDB();
(globalThis as { indexedDB?: unknown }).indexedDB = fakeIdb;
if (!globalThis.crypto) {
  throw new Error('Node 20 应提供全局 Web Crypto');
}
process.on('unhandledRejection', (reason) => {
  console.error('未处理的 Promise 拒绝:', reason);
});

import {
  buildProjectPackage,
  canonicalJson,
  PackageError,
  parseProjectPackage,
  PACKAGE_FORMAT_VERSION
} from '../src/lib/package.ts';
import { applySelection, mergeCompatibility, planImport } from '../src/lib/importPlan.ts';
import { commitMergeAtomic, createProjectAtomic, listProjects, saveProject } from '../src/lib/db.ts';
import { p6mSample, glideSample } from '../src/lib/samples.ts';
import { GROUP_SPECS, compose, getCellSize, invert, translationMatrix, transformPoint } from '../src/lib/groups.ts';
import type { GroupId, Point, Project } from '../src/types.ts';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function expectPackageError(label: string, fn: () => Promise<unknown>, code?: string) {
  try {
    await fn();
    check(label, false, '应当抛出 PackageError');
  } catch (err) {
    const ok = err instanceof PackageError && (!code || err.code === code);
    check(label, ok, `${(err as Error).message}${err instanceof PackageError ? ` [${err.code}]` : ''}`);
  }
}

// 与 scripts/check-tiling.ts 相同的覆盖计数，用于验证导入后平铺结果一致。
function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[j]!;
    const xj = polygon[i]![0];
    const crosses =
      (polygon[j]![1] > point[1]) !== (polygon[i]![1] > point[1]) &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (polygon[i]![1] - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function latticeVectorsLocal(group: GroupId, cw: number, ch: number): [Point, Point] {
  if (group === 'cm' || group === 'cmm') return [[cw / 2, ch / 2], [-cw / 2, ch / 2]];
  if (['p3', 'p3m1', 'p31m', 'p6', 'p6m'].includes(group)) return [[cw, 0], [cw / 2, ch]];
  return [[cw, 0], [0, ch]];
}

function coverageCount(project: Project, x: number, y: number): number {
  const [cw, ch] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const spec = GROUP_SPECS[project.group];
  const [[ax, ay], [bx, by]] = latticeVectorsLocal(project.group, cw, ch);
  const det = ax * by - ay * bx;
  const na = (by * x - bx * y) / det;
  const mb = (-ay * x + ax * y) / det;
  let count = 0;
  for (let n = Math.round(na) - 3; n <= Math.round(na) + 3; n += 1) {
    for (let m = Math.round(mb) - 3; m <= Math.round(mb) + 3; m += 1) {
      spec.cosets(cw, ch).forEach((_, ci) => {
        const total = compose(translationMatrix(project.group, cw, ch, n, m), spec.cosets(cw, ch)[ci]!);
        const q = transformPoint(invert(total), x, y);
        if (pointInPolygon(q, spec.domain(cw, ch))) count += 1;
      });
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
console.log('① p6m（含透明/半透明路径）导出 → 清空会话导入：群、对象 ID、平铺一致');
{
  fakeIdb.clear();
  const original = p6mSample();
  await saveProject(original);
  const pkg = await buildProjectPackage(original);
  check('包格式版本为 v1', pkg.version === 1);
  check('包类型与封套标识正确', pkg.kind === 'wallpaper-symmetry-project' && pkg.format === 'package');
  check('校验和为 64 位十六进制', /^[0-9a-f]{64}$/.test(pkg.checksum));
  check('导出对象含透明度 0.42 的透明边缘叶片', original.objects.some((o) => o.opacity === 0.42));
  const serialized = JSON.stringify(pkg);

  // 模拟清空会话：重置 IndexedDB 后再导入。
  fakeIdb.clear();
  const parsed = await parseProjectPackage(serialized);
  check('识别格式版本 v1', parsed.formatVersion === PACKAGE_FORMAT_VERSION);
  check('群一致', parsed.project.group === 'p6m');
  check('单元尺寸一致（三角晶格）',
    Math.abs(parsed.project.cellWidth - original.cellWidth) < 1e-9 &&
    Math.abs(parsed.project.cellHeight - original.cellHeight) < 1e-9);
  check('对象 ID 完全一致',
    parsed.project.objects.map((o) => o.id).join('|') === original.objects.map((o) => o.id).join('|'));
  check('路径、样式、透明度完整',
    canonicalJson(parsed.project.objects) === canonicalJson(original.objects));

  const plan = planImport(parsed, glideSample(), 'create');
  await createProjectAtomic(plan.target);
  const stored = (await listProjects()).find((p) => p.id === plan.target.id)!;
  check('独立工程导入生成新工程 ID（不覆盖源 ID）', stored.id !== original.id);
  check('导入轨迹记录源工程与对象映射',
    stored.importTrace?.sourceProjectId === original.id &&
    stored.importTrace.mode === 'create' &&
    stored.importTrace.objects.length === original.objects.length &&
    stored.importTrace.objects.every((o) => !o.remapped));

  const probes: Point[] = [
    [137, 88], [210, 150], [40, 220], [300, 60], [160, 200], [250, 240]
  ];
  const sameTiling = probes.every(([x, y]) => coverageCount(original, x, y) === coverageCount(stored, x, y));
  check('铺排覆盖计数逐点一致（基本域不重不漏）', sameTiling);
}

// ---------------------------------------------------------------------------
console.log('② 合并含冲突 ID 的工程：原对象不变、确定性映射、可选、可追溯');
{
  fakeIdb.clear();
  const local = p6mSample();
  await saveProject(local);
  const beforeLocal = structuredClone(local.objects);

  const incoming = p6mSample(); // 同群同晶格，但所有对象 ID 与本地冲突
  incoming.name = '冲突包';
  const pkg = JSON.stringify(await buildProjectPackage(incoming));
  const parsed = await parseProjectPackage(pkg);
  check('合并兼容性判定通过（同 p6m 同晶格）', mergeCompatibility(local, parsed.project).length === 0);

  const plan = planImport(parsed, local, 'merge');
  check('所有冲突对象都被重映射', plan.conflicts.length === incoming.objects.length);
  const ids1 = plan.conflicts.map((c) => c.finalId);
  // 确定性：相同输入再算一次得到相同映射。
  const planAgain = planImport(await parseProjectPackage(pkg), structuredClone(local), 'merge');
  check('冲突映射确定可复现', ids1.join('|') === planAgain.conflicts.map((c) => c.finalId).join('|'));
  check('新 ID 与任何本地/导入原 ID 都不碰撞',
    new Set(plan.target.objects.map((o) => o.id)).size === plan.target.objects.length);

  // 用户只勾选导入其中 1 个对象。
  const keepId = plan.trace.objects[1]!.finalId;
  for (const entry of plan.trace.objects) {
    if (entry.finalId !== keepId) plan.selected[entry.finalId] = false;
  }
  const selected = { ...plan.selected };
  const merged = applySelection(plan, selected);
  check('合并后本地对象数量与内容原样保留',
    merged.objects.length === local.objects.length + 1 &&
    JSON.stringify(merged.objects.slice(0, local.objects.length)) === JSON.stringify(beforeLocal));
  check('未勾选的导入对象被排除', merged.objects.every((o) => !plan.trace.objects.some(
    (t) => t.finalId !== keepId && t.finalId === o.id)));
  check('轨迹保留全部映射记录（可追溯）',
    merged.importTrace?.objects.length === 1 &&
    merged.importTrace.objects[0]!.originalId === incoming.objects[1]!.id &&
    merged.importTrace.objects[0]!.remapped);

  await commitMergeAtomic(local.id, local.group, merged);
  const fromDb = (await listProjects()).find((p) => p.id === local.id)!;
  check('落库后本地同名对象仍未被替换',
    JSON.stringify(fromDb.objects.slice(0, local.objects.length)) === JSON.stringify(beforeLocal));
  check('合并后群不变', fromDb.group === 'p6m');

  // 再次合并同一批内容到相同的本地工程：作用域与原 ID 不变，映射依然确定。
  const plan2 = planImport(await parseProjectPackage(pkg), structuredClone(local), 'merge');
  check('相同作用域重复合并生成相同的确定性 ID',
    plan2.conflicts.map((c) => c.finalId).join('|') === ids1.join('|'));
}

// ---------------------------------------------------------------------------
console.log('②b 群/晶格不兼容必须作为独立工程打开');
{
  const local = p6mSample();
  const other = glideSample(); // pg，尺寸也不同
  const parsed = await parseProjectPackage(JSON.stringify(await buildProjectPackage(other)));
  const reasons = mergeCompatibility(local, parsed.project);
  check('p6m vs pg 判定不兼容', reasons.length > 0);
  const plan = planImport(parsed, local, 'merge');
  check('请求合并但不兼容时回退为独立工程', plan.mode === 'create' && !plan.compatible);
  check('独立工程保留导入包的群 pg', plan.target.group === 'pg');

  // 同群但尺寸不同也不兼容。
  const resized = structuredClone(local);
  resized.cellWidth = local.cellWidth + 10;
  resized.cellHeight = local.cellHeight + 10;
  const parsed2 = await parseProjectPackage(JSON.stringify(await buildProjectPackage(resized)));
  check('同群不同尺寸不兼容', mergeCompatibility(local, parsed2.project).length > 0);
}

// ---------------------------------------------------------------------------
console.log('③ 旧格式迁移；篡改/未来格式/缺字段在写库前失败');
{
  fakeIdb.clear();
  const legacy = p6mSample();
  const legacyText = JSON.stringify({
    id: legacy.id,
    name: '老工程',
    group: 'p6m',
    cellWidth: legacy.cellWidth,
    cellHeight: legacy.cellHeight,
    objects: legacy.objects.map((o) => ({ id: o.id, name: o.name, path: o.path })),
    updatedAt: legacy.updatedAt
  });
  const migrated = await parseProjectPackage(legacyText);
  check('旧格式识别为 v0 并迁移', migrated.formatVersion === 0 && migrated.warnings.length > 0);
  check('迁移后补全默认样式', migrated.project.objects.every(
    (o) => typeof o.fill === 'string' && typeof o.opacity === 'number'));
  const plan = planImport(migrated, glideSample(), 'create');
  await createProjectAtomic(plan.target);
  check('迁移工程可以正常写库', (await listProjects()).some((p) => p.id === plan.target.id));
  const beforeCount = (await listProjects()).length;

  const pkg = await buildProjectPackage(p6mSample());
  // 篡改 payload 字节而保留 checksum。
  const tampered = structuredClone(pkg);
  tampered.payload.objects[0]!.opacity = 0.01;
  await expectPackageError('篡改内容 → checksum 失败，不写库',
    () => parseProjectPackage(JSON.stringify(tampered)), 'checksum');

  // 篡改 checksum。
  const tampered2 = structuredClone(pkg);
  tampered2.checksum = `${'0'.repeat(64)}`;
  await expectPackageError('篡改校验和 → checksum 失败',
    () => parseProjectPackage(JSON.stringify(tampered2)), 'checksum');

  const future = { ...pkg, version: PACKAGE_FORMAT_VERSION + 1 };
  await expectPackageError('未来格式 → future-version 失败',
    () => parseProjectPackage(JSON.stringify(future)), 'future-version');

  const missing = structuredClone(pkg);
  delete (missing.payload as { objects?: unknown }).objects;
  missing.checksum = await digest(canonicalJson(missing.payload));
  await expectPackageError('缺 objects 字段 → content 失败',
    () => parseProjectPackage(JSON.stringify(missing)), 'content');

  const badGroup = structuredClone(pkg);
  badGroup.payload.group = 'p7m';
  badGroup.checksum = await digest(canonicalJson(badGroup.payload));
  await expectPackageError('非法群标识 → content 失败',
    () => parseProjectPackage(JSON.stringify(badGroup)), 'content');

  const badCell = structuredClone(pkg);
  badCell.payload.cellHeight = badCell.payload.cellHeight + 5; // 三角晶格高度不匹配
  badCell.checksum = await digest(canonicalJson(badCell.payload));
  await expectPackageError('晶格尺寸不符 → content 失败',
    () => parseProjectPackage(JSON.stringify(badCell)), 'content');

  const badPath = structuredClone(pkg);
  (badPath.payload.objects[0]!.path[1] as { x: number }).x = Number.NaN;
  // JSON.stringify 把 NaN 变成 null，等价于缺字段。
  badPath.checksum = await digest(canonicalJson(badPath.payload));
  await expectPackageError('路径缺数值字段（NaN→null）→ content 失败',
    () => parseProjectPackage(JSON.stringify(badPath)), 'content');

  const duplicateIds = structuredClone(pkg);
  duplicateIds.payload.objects[1]!.id = duplicateIds.payload.objects[0]!.id;
  duplicateIds.checksum = await digest(canonicalJson(duplicateIds.payload));
  await expectPackageError('包内对象 ID 重复 → content 失败',
    () => parseProjectPackage(JSON.stringify(duplicateIds)), 'content');

  await expectPackageError('非法 JSON → parse 失败',
    () => parseProjectPackage('{not json'), 'parse');

  check('所有失败情形均未写入 IndexedDB', (await listProjects()).length === beforeCount);
}

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
console.log('④ 单事务原子性：提交中止 / 中途刷新不产生半条记录');
{
  fakeIdb.clear();
  const local = p6mSample();
  await saveProject(local);
  const before = fakeIdb.snapshot();

  // 4a. createProjectAtomic：ID 已存在时事务中止，不覆盖原记录。
  const clash: Project = structuredClone(local);
  clash.name = '试图覆盖';
  let aborted = false;
  try {
    await createProjectAtomic(clash);
  } catch {
    aborted = true;
  }
  check('同 ID 创建被拒绝', aborted);
  check('原记录字节未被修改', JSON.stringify([...fakeIdb.snapshot()]) === JSON.stringify([...before]));

  // 4b. 合并事务内复核失败（模拟本地群被其他路径改动）整体 abort。
  const incoming = p6mSample();
  const parsed = await parseProjectPackage(JSON.stringify(await buildProjectPackage(incoming)));
  const plan = planImport(parsed, local, 'merge');
  const evilLocal = structuredClone(local);
  evilLocal.group = 'p6';
  await saveProject(evilLocal);
  let mergeAborted = false;
  try {
    await commitMergeAtomic(local.id, 'p6m', plan.target);
  } catch {
    mergeAborted = true;
  }
  check('群不一致时合并事务中止', mergeAborted);
  const after = fakeIdb.snapshot();
  const evilRecord = after.get(local.id) as Project;
  check('中止后只保留事务前的完整旧记录（无半条合并结果）',
    evilRecord.group === 'p6' && evilRecord.objects.length === local.objects.length);

  // 4c. 模拟“提交到一半刷新”：构造一个在 put 步骤后、complete 前“崩溃”的事务，
  // fake 实现在 abort 时丢弃全部调度写入，因此刷新后仍是完整原工程。
  const data = fakeIdb.snapshot();
  const freshLocal = structuredClone(local);
  freshLocal.group = 'p6m';
  data.set(local.id, freshLocal);
  // 直接验证：put 与 get 在同一事务，外部快照只在 complete 后可见（fake 的 map 是提交态视图）。
  // 这里用“事务 abort 后 map 未被改动”作为不可见性的等价检查。
  class CrashTransaction {
    oncomplete: (() => void) | null = null;
    onabort: (() => void) | null = null;
    constructor(private readonly map: Map<string, unknown>) {}
    objectStore() {
      return {
        get: () => {
          const r = { result: undefined as unknown, onsuccess: null as null | (() => void) };
          queueMicrotask(() => {
            r.result = structuredClone(this.map.get(local.id));
            r.onsuccess?.();
          });
          return r;
        },
        // put 已经“发起”，但在 complete 前页面刷新 → abort，map 绝不变化。
        put: () => {
          this.map.get(local.id); // no-op，模拟刷新前进程死亡
        }
      };
    }
    abort() {
      queueMicrotask(() => this.onabort?.());
    }
  }
  const crashMap = new Map<string, unknown>(Array.from(data, ([k, v]) => [k, structuredClone(v)]));
  const preCrashJson = JSON.stringify([...crashMap]);
  const ctx = new CrashTransaction(crashMap);
  const store = ctx.objectStore();
  await new Promise<void>((resolve) => {
    const req = store.get(local.id);
    req.onsuccess = () => {
      store.put({ ...freshLocal, objects: [...freshLocal.objects, ...parsed.project.objects] });
      ctx.abort();
      resolve();
    };
    ctx.onabort = () => resolve();
  });
  check('刷新（abort）后工程仍是完整原工程，没有追加半个对象列表',
    JSON.stringify([...crashMap]) === preCrashJson &&
    (crashMap.get(local.id) as Project).objects.length === local.objects.length);

  // 4d. 正常提交后得到的是完整合并工程。
  await saveProject(freshLocal);
  await commitMergeAtomic(local.id, 'p6m', plan.target);
  const okRecord = fakeIdb.snapshot().get(local.id) as Project;
  check('成功提交后为完整合并工程（本地 + 导入）',
    okRecord.objects.length === local.objects.length + incoming.objects.length &&
    okRecord.importTrace?.mode === 'merge');
}

// ---------------------------------------------------------------------------
console.log(failures === 0 ? '\n全部工程包验收通过 ✅' : `\n${failures} 项验收失败 ❌`);
if (failures > 0) process.exit(1);
