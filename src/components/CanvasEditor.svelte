<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { mat3 } from 'gl-matrix';
  import { addObject, editor, pushHistory, renderOptions, selectObject, updateObjectGeometry } from '../lib/stores';
  import { locateRequest } from '../lib/ui';
  import type { Camera, PathSegment, PatternObject, Point } from '../types';
  import { drawScene, hitTest, screenToWorld } from '../lib/render';
  import {
    applyMatrixToPath,
    editablePoints,
    ellipsePath,
    rectanglePath,
    setEditablePoint,
    tracePath,
    uid
  } from '../lib/path';
  import { GROUP_SPECS, compose, getCellSize, invert, translation } from '../lib/groups';

  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let width = 800;
  let height = 600;
  let dpr = 1;
  let camera: Camera = { x: 80, y: 110, zoom: 1.35 };
  let panStart: { x: number; y: number; cameraX: number; cameraY: number } | null = null;
  let drag:
    | {
        kind: 'object' | 'node';
        objectId: string;
        matrix: mat3 | null;
        startWorld: Point;
        original: PatternObject;
        nodeIndex?: number;
        moved?: boolean;
      }
    | null = null;
  let drawing: PathSegment[] | null = null;
  let shapeStart: Point | null = null;
  let currentWorld: Point = [0, 0];
  let hoverInstance: string | null = null;
  let resizeObserver: ResizeObserver;
  let frame = 0;

  function requestDraw() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  }

  function render() {
    if (!ctx) return;
    const current = $editor;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, current.project, camera, $renderOptions, width, height, current.selectedId);
    drawOverlay();
  }

  function drawOverlay() {
    const current = $editor;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if ($renderOptions.showDomain) {
      const [w, h] = getCellSize(current.project.group, current.project.cellWidth, current.project.cellHeight);
      const domain = GROUP_SPECS[current.project.group].domain(w, h);
      ctx.save();
      ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.x, dpr * camera.y);
      ctx.beginPath();
      domain.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(249,115,22,0.13)';
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 3 / camera.zoom;
      ctx.setLineDash([]);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    const selected = current.project.objects.find((item) => item.id === current.selectedId);
    if (selected) {
      ctx.save();
      ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.x, dpr * camera.y);
      const points = editablePoints(selected.path);
      for (const point of points) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, (point.role === 'end' ? 5 : 3.4) / camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = point.role === 'end' ? '#ffffff' : '#fed7aa';
        ctx.strokeStyle = '#ea580c';
        ctx.lineWidth = 1.5 / camera.zoom;
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    if (drawing || shapeStart) {
      ctx.save();
      ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.x, dpr * camera.y);
    }
    if (drawing && drawing.length > 1) {
      ctx.beginPath();
      drawing.forEach((segment, index) => {
        if ('x' in segment && 'y' in segment) {
          if (index === 0) ctx.moveTo(segment.x, segment.y);
          else ctx.lineTo(segment.x, segment.y);
        }
      });
      ctx.lineTo(currentWorld[0], currentWorld[1]);
      ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 2 / camera.zoom;
      ctx.stroke();
    }
    if (shapeStart && ($editor.tool === 'rectangle' || $editor.tool === 'ellipse')) {
      const path =
        $editor.tool === 'rectangle'
          ? rectanglePath(shapeStart[0], shapeStart[1], currentWorld[0] - shapeStart[0], currentWorld[1] - shapeStart[1])
          : ellipsePath(
              (shapeStart[0] + currentWorld[0]) / 2,
              (shapeStart[1] + currentWorld[1]) / 2,
              Math.abs(currentWorld[0] - shapeStart[0]) / 2,
              Math.abs(currentWorld[1] - shapeStart[1]) / 2
            );
      tracePath(ctx, path);
      ctx.fillStyle = 'rgba(249,115,22,0.18)';
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 2 / camera.zoom;
      ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
      ctx.fill();
      ctx.stroke();
    }
    if (drawing || shapeStart) ctx.restore();
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    width = Math.max(100, rect.width);
    height = Math.max(100, rect.height);
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    requestDraw();
  }

  function locateOriginal() {
    const selected = $editor.project.objects.find((item) => item.id === $editor.selectedId);
    if (!selected) return;
    const [w, h] = getCellSize($editor.project.group, $editor.project.cellWidth, $editor.project.cellHeight);
    const domain = GROUP_SPECS[$editor.project.group].domain(w, h);
    const cx = domain.reduce((sum, p) => sum + p[0], 0) / domain.length;
    const cy = domain.reduce((sum, p) => sum + p[1], 0) / domain.length;
    camera.zoom = Math.max(camera.zoom, 1.2);
    camera.x = width / 2 - cx * camera.zoom;
    camera.y = height / 2 - cy * camera.zoom;
    requestDraw();
  }

  function onPointerDown(event: PointerEvent) {
    canvas.setPointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const world = screenToWorld(camera, x, y);
    currentWorld = world;

    if (event.button === 1 || event.altKey || ($editor.tool === 'select' && event.shiftKey)) {
      panStart = { x, y, cameraX: camera.x, cameraY: camera.y };
      return;
    }

    const selected = $editor.project.objects.find((item) => item.id === $editor.selectedId);
    if ($editor.tool === 'node' && selected) {
      const points = editablePoints(selected.path);
      const threshold = 9 / camera.zoom;
      const hit = points
        .map((point, nodeIndex) => ({ point, nodeIndex, distance: Math.hypot(point.x - world[0], point.y - world[1]) }))
        .filter((candidate) => candidate.distance <= threshold)
        .sort((a, b) => a.distance - b.distance)[0];
      if (hit) {
        drag = {
          kind: 'node',
          objectId: selected.id,
          matrix: null,
          startWorld: world,
          original: structuredClone(selected),
          nodeIndex: hit.nodeIndex
        };
        return;
      }
    }

    const hit = hitTest(ctx, $editor.project, camera, x, y, width, height);
    if ($editor.tool === 'select' || $editor.tool === 'node') {
      if (hit) {
        selectObject(hit.objectId, hit.instance);
        hoverInstance = hit.instance;
        const source = $editor.project.objects.find((item) => item.id === hit.objectId);
        if (source && $editor.tool === 'select') {
          drag = {
            kind: 'object',
            objectId: hit.objectId,
            matrix: hit.matrix,
            startWorld: world,
            original: structuredClone(source)
          };
        }
      } else if ($editor.tool === 'select') {
        selectObject(null, null);
      }
      requestDraw();
      return;
    }

    if ($editor.tool === 'pen') {
      drawing = [{ type: 'M', x: world[0], y: world[1] }];
    } else if ($editor.tool === 'rectangle' || $editor.tool === 'ellipse') {
      shapeStart = world;
    }
  }

  function onPointerMove(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    currentWorld = screenToWorld(camera, x, y);

    if (panStart) {
      camera.x = panStart.cameraX + (x - panStart.x);
      camera.y = panStart.cameraY + (y - panStart.y);
      requestDraw();
      return;
    }

    if (drag?.kind === 'object') {
      if (!drag.moved) {
        pushHistory();
        drag.moved = true;
      }
      const dx = currentWorld[0] - drag.startWorld[0];
      const dy = currentWorld[1] - drag.startWorld[1];
      // Dragging a transformed instance maps the movement back through that instance
      // matrix. Every orbit image then updates because only the source object changes.
      const sourceDelta: mat3 = drag.matrix
        ? compose(invert(drag.matrix), translation(dx, dy))
        : translation(dx, dy);
      const nextPath = applyMatrixToPath(drag.original.path, sourceDelta);
      updateObjectGeometry(drag.objectId, nextPath, false);
      requestDraw();
      return;
    }

    if (drawing && $editor.tool === 'pen') {
      const last = drawing[drawing.length - 1];
      if (last && 'x' in last && Math.hypot(currentWorld[0] - last.x, currentWorld[1] - last.y) > 3 / camera.zoom) {
        drawing = [...drawing, { type: 'L', x: currentWorld[0], y: currentWorld[1] }];
      }
      requestDraw();
      return;
    }

    if (drag?.kind === 'node' && drag.nodeIndex !== undefined) {
      if (!drag.moved) {
        pushHistory();
        drag.moved = true;
      }
      const points = editablePoints(drag.original.path);
      const target = points[drag.nodeIndex];
      if (target) {
        updateObjectGeometry(drag.objectId, setEditablePoint(drag.original.path, target, currentWorld[0], currentWorld[1]), false);
        requestDraw();
      }
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (panStart) panStart = null;
    if (drag) drag = null;
    if (shapeStart && ($editor.tool === 'rectangle' || $editor.tool === 'ellipse')) {
      const [x0, y0] = shapeStart;
      const [x1, y1] = currentWorld;
      const path =
        $editor.tool === 'rectangle'
          ? rectanglePath(x0, y0, x1 - x0, y1 - y0)
          : ellipsePath((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2);
      const item: PatternObject = {
        id: uid('object'),
        name: $editor.tool === 'rectangle' ? '矩形单元' : '椭圆单元',
        path,
        fill: $editor.tool === 'rectangle' ? '#2563eb' : '#14b8a6',
        stroke: '#0f172a',
        strokeWidth: 2,
        opacity: 0.82
      };
      addObject(item);
      shapeStart = null;
    }
    if (drawing && $editor.tool === 'pen') {
      const path = drawing.length > 2 ? [...drawing, { type: 'Z' as const }] : drawing;
      const item: PatternObject = {
        id: uid('object'),
        name: '手绘路径',
        path,
        fill: '#f97316',
        stroke: '#431407',
        strokeWidth: 2,
        opacity: 0.84
      };
      addObject(item);
      drawing = null;
    }
    canvas.releasePointerCapture(event.pointerId);
    requestDraw();
  }

  function onDoubleClick(event: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(
      ctx,
      $editor.project,
      camera,
      event.clientX - rect.left,
      event.clientY - rect.top,
      width,
      height
    );
    if (hit) {
      selectObject(hit.objectId, hit.instance);
      locateOriginal();
    }
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const oldZoom = camera.zoom;
    const nextZoom = Math.min(6, Math.max(0.25, oldZoom * Math.exp(-event.deltaY * 0.001)));
    camera.zoom = nextZoom;
    camera.x = x - ((x - camera.x) / oldZoom) * nextZoom;
    camera.y = y - ((y - camera.y) / oldZoom) * nextZoom;
    requestDraw();
  }

  editor.subscribe(requestDraw);
  renderOptions.subscribe(requestDraw);
  const unsubscribeLocate = locateRequest.subscribe(locateOriginal);

  onMount(() => {
    ctx = canvas.getContext('2d')!;
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    cancelAnimationFrame(frame);
    unsubscribeLocate();
  });
</script>

<div class="canvas-wrap" bind:this={container}>
  <canvas
    bind:this={canvas}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    on:dblclick={onDoubleClick}
    on:wheel|preventDefault={onWheel}
    class:crosshair={$editor.tool !== 'select'}
  />
  <div class="hint">
    左键操作；Shift/Alt/中键拖动画布；滚轮缩放；双击任意实例定位原始基本单元
  </div>
</div>

<style>
  .canvas-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #e5e7eb;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
  .crosshair {
    cursor: crosshair;
  }
  .hint {
    position: absolute;
    left: 12px;
    bottom: 10px;
    padding: 6px 10px;
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.72);
    color: white;
    font-size: 12px;
    pointer-events: none;
  }
</style>
