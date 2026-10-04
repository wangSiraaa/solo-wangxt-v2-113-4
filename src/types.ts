export type Point = [number, number];

export type PathSegment =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'Q'; cx: number; cy: number; x: number; y: number }
  | { type: 'C'; cx1: number; cy1: number; cx2: number; cy2: number; x: number; y: number }
  | { type: 'Z' };

export type GroupId =
  | 'p1'
  | 'p2'
  | 'pm'
  | 'pg'
  | 'cm'
  | 'pmm'
  | 'pmg'
  | 'cmm'
  | 'p4'
  | 'p4m'
  | 'p4g'
  | 'p3'
  | 'p3m1'
  | 'p31m'
  | 'p6'
  | 'p6m';

export interface StyleSpec {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

export interface PatternObject extends StyleSpec {
  id: string;
  name: string;
  path: PathSegment[];
}

/** 单个对象在导入时的身份重写记录，保证合并结果可追溯。 */
export interface ObjectImportTrace {
  /** 导入包内携带的原始对象 ID。 */
  originalId: string;
  /** 落库后的最终对象 ID；无冲突时与 originalId 相同。 */
  finalId: string;
  remapped: boolean;
}

/** 工程上记录的导入来源，独立工程与合并工程都保留。 */
export interface ImportTrace {
  /** 包内的源工程 ID，不参与本机工程主键。 */
  sourceProjectId: string;
  /** 导入时使用的包格式版本。 */
  packageFormat: number;
  /** 导入时间戳。 */
  importedAt: number;
  mode: 'create' | 'merge';
  objects: ObjectImportTrace[];
}

export interface Project {
  id: string;
  name: string;
  group: GroupId;
  cellWidth: number;
  cellHeight: number;
  objects: PatternObject[];
  updatedAt: number;
  /** 仅当该工程由导入创建或合并而来时存在。 */
  importTrace?: ImportTrace;
}

export type Tool = 'select' | 'node' | 'pen' | 'rectangle' | 'ellipse';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderOptions {
  showDomain: boolean;
  showGrid: boolean;
  showSymmetry: boolean;
  showHandles: boolean;
}
