import type { GroupId, PathSegment, PatternObject, Project } from '../types';
import { GROUP_SPECS, getCellSize } from './groups';
import { checkRelations } from './verifier';

/**
 * 离线交换工程包（.wsp.json）
 *
 * 包是自描述的单文件 JSON：
 *   { kind, format, version, exportedAt, payload, checksum }
 * - payload 是唯一参与校验和的部分，完整包含群、单元尺寸、路径、样式与对象 ID；
 * - checksum = SHA-256(规范 JSON(payload))，任何字节篡改都会在写库/切画布前失败；
 * - format 是格式代际：当前为 1；更老的无格式字段工程按旧格式迁移；
 *   更大的版本号属于未知未来格式，一律拒绝。
 */
export const PACKAGE_KIND = 'wallpaper-symmetry-project';
export const PACKAGE_FORMAT_VERSION = 1;

export interface ProjectPackage {
  kind: typeof PACKAGE_KIND;
  format: 'package';
  version: number;
  exportedAt: number;
  payload: ProjectPayload;
  checksum: string;
}

/** 校验和覆盖的完整工程内容。 */
export interface ProjectPayload {
  id: string;
  name: string;
  group: GroupId;
  cellWidth: number;
  cellHeight: number;
  objects: PatternObject[];
  updatedAt: number;
}

export interface ParsedProjectPackage {
  /** 解析时识别到的格式版本；旧格式迁移记为 0。 */
  formatVersion: number;
  sourceProjectId: string;
  exportedAt: number;
  /** 已经过完整校验与归一化、驻留在内存中的工程，尚未写入任何存储。 */
  project: Project;
  warnings: string[];
}

export type PackageErrorCode =
  | 'parse'
  | 'future-version'
  | 'unsupported-version'
  | 'checksum'
  | 'structure'
  | 'content'
  | 'legacy'
  | 'crypto';

export class PackageError extends Error {
  code: PackageErrorCode;
  issues: string[];

  constructor(code: PackageErrorCode, message: string, issues: string[] = []) {
    super(message);
    this.name = 'PackageError';
    this.code = code;
    this.issues = issues;
  }
}

const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 200;
const MAX_COORDINATE = 1e7;
const MAX_CELL_SIZE = 100_000;
const MAX_PATH_SEGMENTS = 5000;
const MAX_OBJECTS = 2000;
const GROUP_RELATION_EPS = 1e-6;
const LATTICE_EPS = 1;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0(?:\.\d+)?)\s*)?\)$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[^\p{C}\s]+$/u.test(value)
  );
}

function validColor(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return false;
  if (value === 'transparent' || value === 'none') return true;
  return HEX_COLOR.test(value) || RGB_COLOR.test(value);
}

/** 递归按字典序排列键的规范 JSON，数组顺序保留。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new PackageError(
      'crypto',
      '当前环境不支持 SHA-256（需要安全上下文），无法生成或校验工程包'
    );
  }
  const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// 内容校验
// ---------------------------------------------------------------------------

function validatePath(raw: unknown, issues: string[]): PathSegment[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.push('路径必须是非空数组');
    return null;
  }
  if (raw.length > MAX_PATH_SEGMENTS) {
    issues.push(`路径段数超过上限 ${MAX_PATH_SEGMENTS}`);
    return null;
  }
  const path: PathSegment[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const seg = raw[i];
    const where = `路径段[${i}]`;
    if (!isPlainObject(seg) || typeof seg.type !== 'string') {
      issues.push(`${where} 不是合法的路径段`);
      return null;
    }
    const nums = (keys: string[]): number[] | null => {
      const out: number[] = [];
      for (const key of keys) {
        if (!isFiniteNumber(seg[key])) {
          issues.push(`${where}(${seg.type}) 缺少数值字段 ${key}`);
          return null;
        }
        if (Math.abs(seg[key] as number) > MAX_COORDINATE) {
          issues.push(`${where}(${seg.type}) 坐标 ${key} 超出允许范围`);
          return null;
        }
        out.push(seg[key] as number);
      }
      return out;
    };
    switch (seg.type) {
      case 'M':
      case 'L': {
        const v = nums(['x', 'y']);
        if (!v) return null;
        path.push({ type: seg.type, x: v[0]!, y: v[1]! });
        break;
      }
      case 'Q': {
        const v = nums(['cx', 'cy', 'x', 'y']);
        if (!v) return null;
        path.push({ type: 'Q', cx: v[0]!, cy: v[1]!, x: v[2]!, y: v[3]! });
        break;
      }
      case 'C': {
        const v = nums(['cx1', 'cy1', 'cx2', 'cy2', 'x', 'y']);
        if (!v) return null;
        path.push({
          type: 'C',
          cx1: v[0]!,
          cy1: v[1]!,
          cx2: v[2]!,
          cy2: v[3]!,
          x: v[4]!,
          y: v[5]!
        });
        break;
      }
      case 'Z': {
        path.push({ type: 'Z' });
        break;
      }
      default:
        issues.push(`${where} 类型 "${seg.type}" 无法识别`);
        return null;
    }
  }
  if (path[0]!.type !== 'M') {
    issues.push('路径必须以 M 段开始');
    return null;
  }
  return path;
}

function validateStyle(raw: Record<string, unknown>, issues: string[], where: string) {
  if (!validColor(raw.fill)) issues.push(`${where} 的 fill 不是合法颜色`);
  if (!validColor(raw.stroke)) issues.push(`${where} 的 stroke 不是合法颜色`);
  if (
    !isFiniteNumber(raw.strokeWidth) ||
    raw.strokeWidth < 0 ||
    raw.strokeWidth > MAX_COORDINATE
  ) {
    issues.push(`${where} 的 strokeWidth 必须是 0..${MAX_COORDINATE} 的数值`);
  }
  if (!isFiniteNumber(raw.opacity) || raw.opacity < 0 || raw.opacity > 1) {
    issues.push(`${where} 的 opacity 必须在 0..1 之间`);
  }
}

function validateObject(raw: unknown, index: number, issues: string[], seenIds: Set<string>): PatternObject | null {
  const where = `对象[${index}]`;
  if (!isPlainObject(raw)) {
    issues.push(`${where} 不是对象`);
    return null;
  }
  if (!validIdentifier(raw.id)) {
    issues.push(`${where} 的 id 缺失或含空白/控制字符`);
    return null;
  }
  if (seenIds.has(raw.id)) issues.push(`${where} 的 id "${raw.id}" 在包内重复`);
  if (typeof raw.name !== 'string' || raw.name.length === 0 || raw.name.length > MAX_NAME_LENGTH) {
    issues.push(`${where} 的 name 必须是非空字符串`);
  }
  validateStyle(raw, issues, where);
  const path = validatePath(raw.path, issues);
  if (issues.some((msg) => msg.startsWith(where))) return null;
  if (!path) return null;
  seenIds.add(raw.id);
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : raw.id,
    path,
    fill: raw.fill as string,
    stroke: raw.stroke as string,
    strokeWidth: raw.strokeWidth as number,
    opacity: raw.opacity as number
  };
}

/**
 * 校验群参数：群标识必须是 17 个墙纸群之一，单元尺寸为正且与该群晶格相容
 * （正方/三角晶格的高度由宽度唯一确定），并复核群生成元关系残差。
 * 返回归一化后的单元尺寸；任何不符都收集到 issues。
 */
export function normalizeCell(
  group: unknown,
  width: unknown,
  height: unknown,
  issues: string[]
): { group: GroupId; cellWidth: number; cellHeight: number } | null {
  if (typeof group !== 'string' || !(group in GROUP_SPECS)) {
    issues.push(`群标识 "${String(group)}" 不是受支持的 17 个墙纸群之一`);
    return null;
  }
  const g = group as GroupId;
  if (!isFiniteNumber(width) || width <= 0 || width > MAX_CELL_SIZE) {
    issues.push('cellWidth 必须是正数且不超过 100000');
    return null;
  }
  if (!isFiniteNumber(height) || height <= 0 || height > MAX_CELL_SIZE) {
    issues.push('cellHeight 必须是正数且不超过 100000');
    return null;
  }
  const [canonicalW, canonicalH] = getCellSize(g, width, height);
  if (Math.abs(canonicalW - width) > LATTICE_EPS) {
    issues.push(`群 ${g} 的单元宽度与晶格定义不一致`);
    return null;
  }
  if (Math.abs(canonicalH - height) > LATTICE_EPS) {
    issues.push(`群 ${g} 的单元高度 ${height} 与晶格要求 ${canonicalH.toFixed(3)} 不兼容`);
    return null;
  }
  for (const check of checkRelations(g, canonicalW, canonicalH)) {
    if (check.residual > GROUP_RELATION_EPS) {
      issues.push(`群 ${g} 参数关系 ${check.label} 残差 ${check.residual.toExponential(2)} 超限`);
      return null;
    }
  }
  return { group: g, cellWidth: canonicalW, cellHeight: canonicalH };
}

function validateProjectFields(
  raw: Record<string, unknown>,
  issues: string[]
): Omit<Project, 'importTrace'> | null {
  let id: string;
  if (validIdentifier(raw.id)) {
    id = raw.id;
  } else {
    issues.push('工程 id 缺失或不合法');
    return null;
  }
  if (typeof raw.name !== 'string' || raw.name.length === 0 || raw.name.length > MAX_NAME_LENGTH) {
    issues.push('工程 name 必须是非空字符串');
  }
  if (!Array.isArray(raw.objects)) {
    issues.push('objects 必须是数组');
    return null;
  }
  if (raw.objects.length > MAX_OBJECTS) {
    issues.push(`对象数量超过上限 ${MAX_OBJECTS}`);
    return null;
  }
  const cell = normalizeCell(raw.group, raw.cellWidth, raw.cellHeight, issues);
  if (!cell) return null;

  const seenIds = new Set<string>();
  const objects: PatternObject[] = [];
  for (let i = 0; i < raw.objects.length; i += 1) {
    const obj = validateObject(raw.objects[i], i, issues, seenIds);
    if (obj) objects.push(obj);
  }
  if (issues.length > 0) return null;
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : '未命名工程',
    group: cell.group,
    cellWidth: cell.cellWidth,
    cellHeight: cell.cellHeight,
    objects,
    updatedAt: isFiniteNumber(raw.updatedAt) ? (raw.updatedAt as number) : Date.now()
  };
}

// ---------------------------------------------------------------------------
// 旧格式迁移
// ---------------------------------------------------------------------------

/** 旧格式 = 早期直接存进 IndexedDB、没有任何包封套的工程对象。 */
function migrateLegacy(raw: Record<string, unknown>): Project {
  const issues: string[] = [];
  // 旧版本可能缺样式字段，这里补默认值后再走同一条校验管线。
  const objects = Array.isArray(raw.objects)
    ? raw.objects.map((obj) =>
        isPlainObject(obj)
          ? {
              fill: '#2d7ff9',
              stroke: '#12376d',
              strokeWidth: 3,
              opacity: 1,
              ...obj
            }
          : obj
      )
    : raw.objects;
  const withDefaults: Record<string, unknown> = {
    name: '迁移工程',
    updatedAt: Date.now(),
    ...raw,
    objects
  };
  const project = validateProjectFields(withDefaults, issues);
  if (!project) {
    throw new PackageError(
      'legacy',
      '旧格式工程无法迁移为当前模型',
      issues.map((msg) => `· ${msg}`)
    );
  }
  return project;
}

// ---------------------------------------------------------------------------
// 解析 / 生成
// ---------------------------------------------------------------------------

export async function parseProjectPackage(text: string): Promise<ParsedProjectPackage> {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (err) {
    throw new PackageError('parse', `工程包不是合法 JSON：${(err as Error).message}`);
  }
  if (!isPlainObject(root)) {
    throw new PackageError('structure', '工程包根节点必须是 JSON 对象');
  }

  // 无 version 字段：唯一允许的情形是旧格式裸工程；带封套痕迹却缺版本一律拒绝。
  if (!('version' in root)) {
    if ('checksum' in root || 'payload' in root || typeof root.kind === 'string') {
      throw new PackageError('structure', '工程包缺少格式版本字段，无法识别');
    }
    const project = migrateLegacy(root);
    return {
      formatVersion: 0,
      sourceProjectId: project.id,
      exportedAt: project.updatedAt,
      project,
      warnings: ['该文件为旧版格式，已迁移为当前模型；建议重新导出为 v1 工程包。']
    };
  }

  const version = root.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new PackageError('structure', '格式版本必须是整数');
  }
  if (version > PACKAGE_FORMAT_VERSION) {
    throw new PackageError(
      'future-version',
      `工程包来自更新的未来格式 v${version}，当前编辑器只支持 v${PACKAGE_FORMAT_VERSION}，已拒绝打开`
    );
  }
  if (version < PACKAGE_FORMAT_VERSION) {
    throw new PackageError(
      'unsupported-version',
      `工程包格式 v${version} 已不受支持`
    );
  }
  if (root.kind !== PACKAGE_KIND || root.format !== 'package') {
    throw new PackageError('structure', '工程包类型标识不正确');
  }
  if (typeof root.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(root.checksum)) {
    throw new PackageError('structure', '工程包缺少 64 位十六进制校验和');
  }
  if (!isPlainObject(root.payload)) {
    throw new PackageError('structure', '工程包 payload 缺失或不是对象');
  }

  // 先验内容完整性（防篡改），再做结构校验；任一步失败都不会写库或切换画布。
  const actual = await sha256Hex(canonicalJson(root.payload));
  let mismatch = actual.length !== root.checksum.length;
  for (let i = 0; !mismatch && i < actual.length; i += 1) {
    if (actual[i] !== root.checksum[i]) mismatch = true;
  }
  if (mismatch) {
    throw new PackageError(
      'checksum',
      '工程包校验和与内容不一致：文件可能被篡改或传输不完整，已拒绝导入'
    );
  }

  const issues: string[] = [];
  const project = validateProjectFields(root.payload, issues);
  if (!project) {
    throw new PackageError('content', '工程包内容校验未通过', issues.map((msg) => `· ${msg}`));
  }
  const exportedAt = isFiniteNumber(root.exportedAt) ? (root.exportedAt as number) : project.updatedAt;
  return {
    formatVersion: version,
    sourceProjectId: project.id,
    exportedAt,
    project,
    warnings: []
  };
}

export async function buildProjectPackage(project: Project): Promise<ProjectPackage> {
  const issues: string[] = [];
  const validated = validateProjectFields(
    {
      id: project.id,
      name: project.name,
      group: project.group,
      cellWidth: project.cellWidth,
      cellHeight: project.cellHeight,
      objects: project.objects,
      updatedAt: project.updatedAt
    },
    issues
  );
  if (!validated) {
    throw new PackageError(
      'content',
      '当前工程未通过导出前校验，无法生成工程包',
      issues.map((msg) => `· ${msg}`)
    );
  }
  const payload: ProjectPayload = {
    id: validated.id,
    name: validated.name,
    group: validated.group,
    cellWidth: validated.cellWidth,
    cellHeight: validated.cellHeight,
    objects: validated.objects,
    updatedAt: validated.updatedAt
  };
  const checksum = await sha256Hex(canonicalJson(payload));
  return {
    kind: PACKAGE_KIND,
    format: 'package',
    version: PACKAGE_FORMAT_VERSION,
    exportedAt: Date.now(),
    payload,
    checksum
  };
}
