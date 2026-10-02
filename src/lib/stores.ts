import { get, writable } from 'svelte/store';
import type { GroupId, PatternObject, Project, RenderOptions, Tool } from '../types';
import { defaultProject } from './samples';
import { cloneObject, applyMatrixToPath } from './path';
import { getCellSize, GROUP_SPECS, translation } from './groups';
import type { mat3 } from 'gl-matrix';

export interface EditorState {
  project: Project;
  selectedId: string | null;
  /** Identity of the concrete transformed path that was clicked, e.g. objectId@coset:n,m. */
  selectedInstance: string | null;
  tool: Tool;
  canUndo: boolean;
  canRedo: boolean;
  saved: boolean;
}

interface HistoryEntry {
  project: Project;
  selectedId: string | null;
  selectedInstance: string | null;
}

const initialProject = defaultProject();
const editorStore = writable<EditorState>({
  project: initialProject,
  selectedId: initialProject.objects[0]?.id ?? null,
  selectedInstance: null,
  tool: 'select',
  canUndo: false,
  canRedo: false,
  saved: false
});

const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];

function snapshot(state: EditorState): HistoryEntry {
  return {
    project: structuredClone(state.project),
    selectedId: state.selectedId,
    selectedInstance: state.selectedInstance
  };
}

export function pushHistory() {
  const state = get(editorStore);
  undoStack.push(snapshot(state));
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  editorStore.update((s) => ({ ...s, canUndo: true, canRedo: false, saved: false }));
}

export function undo() {
  const entry = undoStack.pop();
  if (!entry) return;
  editorStore.update((state) => {
    redoStack.push(snapshot(state));
    return {
      ...state,
      project: structuredClone(entry.project),
      selectedId: entry.selectedId,
      selectedInstance: entry.selectedInstance,
      canUndo: undoStack.length > 0,
      canRedo: true,
      saved: false
    };
  });
}

export function redo() {
  const entry = redoStack.pop();
  if (!entry) return;
  editorStore.update((state) => {
    undoStack.push(snapshot(state));
    return {
      ...state,
      project: structuredClone(entry.project),
      selectedId: entry.selectedId,
      selectedInstance: entry.selectedInstance,
      canUndo: true,
      canRedo: redoStack.length > 0,
      saved: false
    };
  });
}

export function updateProject(mutator: (project: Project) => Project, record = true) {
  if (record) pushHistory();
  editorStore.update((state) => {
    const project = mutator(structuredClone(state.project));
    return { ...state, project, saved: false };
  });
}

export function setProject(project: Project, clearHistory = true) {
  if (clearHistory) {
    undoStack.length = 0;
    redoStack.length = 0;
  }
  editorStore.set({
    project: structuredClone(project),
    selectedId: project.objects[0]?.id ?? null,
    selectedInstance: null,
    tool: 'select',
    canUndo: false,
    canRedo: false,
    saved: false
  });
}

export function selectObject(id: string | null, instance: string | null = null) {
  editorStore.update((state) => ({ ...state, selectedId: id, selectedInstance: instance }));
}

export function setTool(tool: Tool) {
  editorStore.update((state) => ({ ...state, tool }));
}

export function setGroup(group: GroupId) {
  updateProject((project) => {
    const square = group === 'p4' || group === 'p4m' || group === 'p4g';
    const triangular =
      group === 'p3' ||
      group === 'p3m1' ||
      group === 'p31m' ||
      group === 'p6' ||
      group === 'p6m';
    const cellHeight = square
      ? project.cellWidth
      : triangular
        ? Math.round((Math.sqrt(3) / 2) * project.cellWidth)
        : project.cellHeight;
    return { ...project, group, cellHeight };
  });
  editorStore.update((state) => ({ ...state, selectedInstance: null }));
}

export function setCellSize(width: number, height: number) {
  updateProject((project) => ({
    ...project,
    cellWidth: Math.max(40, Math.round(width)),
    cellHeight: Math.max(40, Math.round(height))
  }));
}

export function addObject(item: PatternObject, select = true) {
  pushHistory();
  editorStore.update((state) => ({
    ...state,
    project: { ...state.project, objects: [...state.project.objects, cloneObject(item)] },
    selectedId: select ? item.id : state.selectedId,
    selectedInstance: select ? null : state.selectedInstance
  }));
}

export function updateSelectedObject(mutator: (item: PatternObject) => PatternObject, record = true) {
  updateProject((project) => {
    const objects = project.objects.map((item) => (item.id === get(editorStore).selectedId ? mutator(item) : item));
    return { ...project, objects };
  }, record);
}

export function updateObjectGeometry(id: string, path: PatternObject['path'], record = false) {
  updateProject((project) => ({
    ...project,
    objects: project.objects.map((item) => (item.id === id ? { ...item, path } : item))
  }), record);
}

export function deleteSelected() {
  updateProject((project) => ({
    ...project,
    objects: project.objects.filter((item) => item.id !== get(editorStore).selectedId)
  }));
  editorStore.update((state) => ({ ...state, selectedId: null, selectedInstance: null }));
}

export function markSaved() {
  editorStore.update((state) => ({ ...state, saved: true }));
}

export const renderOptions = writable<RenderOptions>({
  showDomain: true,
  showGrid: true,
  showSymmetry: true,
  showHandles: true
});

export const editor = editorStore;
