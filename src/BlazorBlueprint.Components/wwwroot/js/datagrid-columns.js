// DataGrid column resize and reorder handler
// Resize: pure JS pointer-capture drag on resize handles (no Blazor round-trip)
// Reorder: HTML5 Drag and Drop API with event delegation on the table

// ─── Shared state ───────────────────────────────────────────────────────────

const gridStates = new Map();

function getOrCreateState(gridId) {
  if (!gridStates.has(gridId)) {
    gridStates.set(gridId, {
      gridId,
      containerElement: null,
      dotNetRef: null,
      // Resize state
      resizeEnabled: false,
      isDragging: false,
      resizeCleanup: null,
      minWidth: 50,
      // Reorder state
      reorderEnabled: false,
      reorderDelegationSetup: false,
      reorderTable: null,
      reorderHandlers: null,
      reorderableIds: new Set(),
      dragColumnId: null,
      dragTh: null,
      dropIndicator: null,
      dropTargetTh: null,
      // Content-based sizing state
      autoSizeIds: new Set(),
      autoSizeObserver: null,
      autoSizeFrame: 0
    });
  }
  return gridStates.get(gridId);
}

function getManagedTable(state) {
  if (!state.containerElement) return null;

  return Array.from(state.containerElement.children).find(element =>
    element.tagName === 'TABLE' &&
    element.getAttribute('data-bb-datagrid-id') === state.gridId) || null;
}

function getManagedHeaderCells(table) {
  if (!table?.tHead) return [];

  for (const row of table.tHead.rows) {
    const cells = Array.from(row.cells).filter(cell => cell.hasAttribute('data-column-id'));
    if (cells.length) return cells;
  }

  return [];
}

function getManagedColumns(table) {
  const colgroup = Array.from(table.children).find(element => element.tagName === 'COLGROUP');
  return colgroup ? Array.from(colgroup.children).filter(element => element.tagName === 'COL') : [];
}

function getManagedColumnCells(table, columnId) {
  const cells = [];
  for (const section of [table.tHead, ...table.tBodies, table.tFoot]) {
    if (!section) continue;

    for (const row of section.rows) {
      for (const cell of row.cells) {
        if (cell.getAttribute('data-column-id') === columnId) {
          cells.push(cell);
        }
      }
    }
  }

  return cells;
}

function getManagedHeaderCellFromEvent(target, table) {
  const th = target instanceof Element ? target.closest('th[data-column-id]') : null;
  return th?.closest('table') === table ? th : null;
}

function applyPinnedOffsets(table, headerCells, widths) {
  let leftOffset = 0;
  for (let index = 0; index < headerCells.length; index++) {
    const header = headerCells[index];
    if (header.getAttribute('data-pinned-side') !== 'left') continue;

    const columnId = header.getAttribute('data-column-id');
    for (const cell of getManagedColumnCells(table, columnId)) {
      cell.style.left = `${Math.round(leftOffset)}px`;
      cell.style.right = '';
    }
    leftOffset += widths[index] || header.getBoundingClientRect().width;
  }

  let rightOffset = 0;
  for (let index = headerCells.length - 1; index >= 0; index--) {
    const header = headerCells[index];
    if (header.getAttribute('data-pinned-side') !== 'right') continue;

    const columnId = header.getAttribute('data-column-id');
    for (const cell of getManagedColumnCells(table, columnId)) {
      cell.style.right = `${Math.round(rightOffset)}px`;
      cell.style.left = '';
    }
    rightOffset += widths[index] || header.getBoundingClientRect().width;
  }
}

/**
 * Calculates the table and flexible-column widths for a resize gesture. Shrinking a column
 * transfers the released space to another flexible data column until the table reaches its
 * viewport width. Growing a column expands the table and enables horizontal scrolling.
 */
export function calculateResizeLayout(
  totalWidth,
  startWidth,
  newWidth,
  minimumTableWidth,
  initialFillWidth
) {
  const resizedTotal = totalWidth - startWidth + newWidth;
  const tableWidth = Math.max(minimumTableWidth, resizedTotal);
  return {
    tableWidth,
    fillWidth: initialFillWidth + tableWidth - resizedTotal
  };
}

// ─── Column Resize ──────────────────────────────────────────────────────────

/**
 * Initialize column resize for a DataGrid.
 * @param {HTMLElement} containerElement - The grid root container
 * @param {DotNetObject} dotNetRef - Blazor component reference
 * @param {string} gridId - Unique grid identifier
 * @param {number} minWidth - Minimum column width in pixels
 */
export function initColumnResize(containerElement, dotNetRef, gridId, minWidth) {
  if (!containerElement || !dotNetRef) return;

  const state = getOrCreateState(gridId);
  state.containerElement = containerElement;
  state.dotNetRef = dotNetRef;
  state.resizeEnabled = true;
  state.minWidth = minWidth || 50;
}

/**
 * Configure resize and reorder on every render so features can be enabled or disabled after
 * the module has already been initialized.
 */
export function configureColumnInteractions(
  containerElement,
  dotNetRef,
  gridId,
  resizeEnabled,
  minWidth,
  reorderEnabled
) {
  if (!containerElement || !dotNetRef) return;

  const state = getOrCreateState(gridId);
  state.containerElement = containerElement;
  state.dotNetRef = dotNetRef;
  const nextResizeEnabled = Boolean(resizeEnabled);
  if (!nextResizeEnabled) state.resizeCleanup?.();
  state.resizeEnabled = nextResizeEnabled;
  state.minWidth = minWidth || 50;
  state.reorderEnabled = Boolean(reorderEnabled);

  if (state.reorderEnabled) {
    ensureDropIndicator(state);
  } else {
    state.reorderableIds.clear();
    clearDragState(state);
    detachReorderHandlers(state);
  }
}

/**
 * Setup resize handles for resizable columns.
 * Finds elements with [data-resize-handle] and attaches pointer event listeners.
 * Resize is handled entirely in JS for instant feedback — no Blazor round-trip.
 * @param {string} gridId - Grid identifier
 */
export function setupResizeHandles(gridId) {
  const state = gridStates.get(gridId);
  if (!state || !state.containerElement || !state.resizeEnabled) return;

  const table = getManagedTable(state);
  if (!table) return;

  const headerCells = getManagedHeaderCells(table);
  const handles = headerCells
    .map(header => header.querySelector('[data-resize-handle]'))
    .filter(Boolean);
  for (const handle of handles) {
    if (handle._resizeSetup) continue;
    handle._resizeSetup = true;

    const columnId = handle.getAttribute('data-resize-handle');

    // Prevent click from reaching the th (which triggers sort)
    handle.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (!state.resizeEnabled || state.isDragging) return;

      // Snapshot all column widths and freeze them on <col> elements
      const ths = getManagedHeaderCells(table);
      const cols = getManagedColumns(table);

      let totalWidth = 0;
      const initialWidths = [];
      ths.forEach((th, i) => {
        const w = Math.round(th.getBoundingClientRect().width);
        if (cols[i]) {
          cols[i].style.width = w + 'px';
        }
        totalWidth += w;
        initialWidths.push(w);
      });

      // Find the active column index
      const thIndex = ths.findIndex(th => th.getAttribute('data-column-id') === columnId);
      const startWidth = thIndex >= 0 && ths[thIndex]
        ? ths[thIndex].getBoundingClientRect().width
        : 150;
      const activeCol = thIndex >= 0 ? cols[thIndex] : null;
      const startX = e.clientX;
      const tableViewport = table.parentElement?.clientWidth ||
        state.containerElement.clientWidth || totalWidth;
      const minimumTableWidth = Math.min(totalWidth, tableViewport);
      const fillColumnIndex = ths.findLastIndex((th, i) =>
        i !== thIndex &&
        th.getAttribute('data-pinned') !== 'true' &&
        th.getAttribute('data-auto-size') !== 'true' &&
        th.querySelector('[data-resize-handle]'));

      const applyWidths = (newWidth) => {
        const layout = calculateResizeLayout(
          totalWidth,
          startWidth,
          newWidth,
          fillColumnIndex >= 0 ? minimumTableWidth : 0,
          fillColumnIndex >= 0 ? initialWidths[fillColumnIndex] : 0);

        if (fillColumnIndex >= 0 && cols[fillColumnIndex]) {
          cols[fillColumnIndex].style.width = Math.round(layout.fillWidth) + 'px';
        }
        if (activeCol) {
          activeCol.style.width = newWidth + 'px';
        }
        table.style.width = Math.round(layout.tableWidth) + 'px';

        const currentWidths = initialWidths.slice();
        if (fillColumnIndex >= 0) currentWidths[fillColumnIndex] = layout.fillWidth;
        if (thIndex >= 0) currentWidths[thIndex] = newWidth;
        applyPinnedOffsets(table, ths, currentWidths);
      };

      // Freeze the measured layout before dragging. Non-resizable, pinned, and auto-sized
      // columns are never selected as the flexible recipient, so their widths remain exact.
      applyWidths(startWidth);

      state.isDragging = true;

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMove = (moveEvt) => {
        if (moveEvt.pointerId !== e.pointerId) return;
        if (!state.resizeEnabled) return;
        moveEvt.preventDefault();
        const delta = moveEvt.clientX - startX;
        const newWidth = Math.max(state.minWidth, Math.round(startWidth + delta));
        applyWidths(newWidth);
      };

      const onEnd = (endEvt) => {
        if (endEvt.pointerId !== e.pointerId) return;

        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onEnd);
        document.removeEventListener('pointercancel', onEnd);

        try { handle.releasePointerCapture(endEvt.pointerId); } catch {}

        state.isDragging = false;
        state.resizeCleanup = null;

        // Commit all column widths to Blazor
        const widths = {};
        ths.forEach((th, i) => {
          const id = th.getAttribute('data-column-id');
          if (id && cols[i] && th.getAttribute('data-auto-size') !== 'true') {
            widths[id] = parseFloat(cols[i].style.width) || th.getBoundingClientRect().width;
          }
        });

        state.dotNetRef.invokeMethodAsync('OnResizeCompleted', columnId, widths)
          .catch(() => { /* component may be disposed */ });
        scheduleAutoSize(state);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onEnd);
      document.addEventListener('pointercancel', onEnd);
      state.resizeCleanup = () => onEnd({ pointerId: e.pointerId });

      try { handle.setPointerCapture(e.pointerId); } catch {}
    });
  }
}

// ─── Column Reorder ─────────────────────────────────────────────────────────

/**
 * Initialize column reorder for a DataGrid.
 * @param {HTMLElement} containerElement - The grid root container
 * @param {DotNetObject} dotNetRef - Blazor component reference
 * @param {string} gridId - Unique grid identifier
 */
export function initColumnReorder(containerElement, dotNetRef, gridId) {
  if (!containerElement || !dotNetRef) return;

  const state = getOrCreateState(gridId);
  state.containerElement = containerElement;
  state.dotNetRef = dotNetRef;
  state.reorderEnabled = true;

  ensureDropIndicator(state);
}

function ensureDropIndicator(state) {
  // Create drop indicator element
  if (!state.dropIndicator) {
    const indicator = document.createElement('div');
    indicator.style.cssText =
      'position:absolute;width:4px;background:var(--ring);' +
      'box-shadow:0 0 0 1px var(--background);border-radius:9999px;' +
      'top:0;bottom:0;pointer-events:none;z-index:50;display:none;';
    state.containerElement.appendChild(indicator);
    state.dropIndicator = indicator;
  }
}

function clearDropIndicator(state) {
  if (state.dropTargetTh) {
    state.dropTargetTh.removeAttribute('data-drop-position');
    state.dropTargetTh = null;
  }
  if (state.dropIndicator) {
    state.dropIndicator.style.display = 'none';
  }
}

function clearDragState(state) {
  if (state.dragTh) {
    state.dragTh.style.opacity = '';
  }
  state.dragColumnId = null;
  state.dragTh = null;
  clearDropIndicator(state);
}

function detachReorderHandlers(state) {
  if (!state.reorderTable || !state.reorderHandlers) return;

  for (const [eventName, handler] of Object.entries(state.reorderHandlers)) {
    state.reorderTable.removeEventListener(eventName, handler);
  }
  state.reorderTable = null;
  state.reorderHandlers = null;
  state.reorderDelegationSetup = false;
}

/**
 * Setup drag handlers for reorderable header cells using event delegation.
 * Uses a single set of listeners on the <table> element rather than per-cell
 * listeners, so it works correctly even when Blazor patches/replaces th elements.
 * The draggable="true" attribute must be set by Blazor on the th elements.
 * @param {string} gridId - Grid identifier
 * @param {string[]} reorderableColumnIds - Column IDs that can be reordered
 */
export function setupDraggableHeaders(gridId, reorderableColumnIds) {
  const state = gridStates.get(gridId);
  if (!state || !state.containerElement) return;

  // Always update the set of reorderable column IDs
  state.reorderableIds = new Set(reorderableColumnIds || []);

  if (!state.reorderEnabled || state.reorderableIds.size === 0) {
    clearDragState(state);
    detachReorderHandlers(state);
    return;
  }

  const table = getManagedTable(state);
  if (!table) return;

  // Blazor can replace the table while retaining the component instance. Rebind event
  // delegation whenever that happens instead of leaving listeners on a detached table.
  if (state.reorderTable === table && state.reorderDelegationSetup) return;
  detachReorderHandlers(state);

  state.reorderDelegationSetup = true;
  state.reorderTable = table;

  const onDragStart = (e) => {
    const th = getManagedHeaderCellFromEvent(e.target, table);
    if (!th) return;

    const columnId = th.getAttribute('data-column-id');
    if (!state.reorderableIds.has(columnId)) return;

    // Don't start drag if a resize is in progress
    if (!state.reorderEnabled || state.isDragging ||
      e.target.closest('[data-resize-handle],button,a,input,select,textarea')) {
      e.preventDefault();
      return;
    }

    state.dragColumnId = columnId;
    state.dragTh = th;

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', columnId);

      // Create ghost drag image — positioned at the header cell location
      // so the browser can capture it correctly
      const rect = th.getBoundingClientRect();
      const ghost = document.createElement('div');
      ghost.textContent = th.textContent.trim();
      ghost.style.cssText =
        `position:fixed;` +
        `left:${rect.left}px;top:${rect.top}px;` +
        `width:${rect.width}px;height:${rect.height}px;` +
        `display:flex;align-items:center;padding:0 16px;` +
        `background:var(--background);` +
        `border:1px solid var(--border);border-radius:6px;` +
        `box-shadow:0 4px 12px rgba(0,0,0,0.15);` +
        `font-size:14px;font-weight:500;color:var(--foreground);` +
        `opacity:0.9;pointer-events:none;z-index:9999;`;
      document.body.appendChild(ghost);

      // Offset so the ghost aligns with where the user clicked
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      e.dataTransfer.setDragImage(ghost, offsetX, offsetY);

      // Clean up ghost element after browser has captured it
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (ghost.parentNode) {
            ghost.parentNode.removeChild(ghost);
          }
        });
      });
    }

    th.style.opacity = '0.4';
  };

  const onDragEnd = () => clearDragState(state);

  const onDragOver = (e) => {
    if (!state.reorderEnabled || !state.dragColumnId) return;

    const th = getManagedHeaderCellFromEvent(e.target, table);
    if (!th) return;

    const columnId = th.getAttribute('data-column-id');
    if (state.dragColumnId === columnId) return;

    // Do not show drop indicator over pinned columns
    if (th.getAttribute('data-pinned') === 'true') return;

    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }

    // Position drop indicator
    const rect = th.getBoundingClientRect();
    const containerRect = state.containerElement.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const indicatorX = e.clientX < midX
      ? rect.left - containerRect.left + state.containerElement.scrollLeft
      : rect.right - containerRect.left + state.containerElement.scrollLeft;

    if (state.dropTargetTh && state.dropTargetTh !== th) {
      state.dropTargetTh.removeAttribute('data-drop-position');
    }
    state.dropTargetTh = th;
    th.setAttribute('data-drop-position', e.clientX < midX ? 'before' : 'after');

    if (state.dropIndicator) {
      state.dropIndicator.style.display = 'block';
      state.dropIndicator.style.left = indicatorX + 'px';
      state.dropIndicator.style.top =
        (rect.top - containerRect.top + state.containerElement.scrollTop) + 'px';
      state.dropIndicator.style.height = rect.height + 'px';
    }
  };

  const onDragLeave = (e) => {
    // Only hide indicator when leaving the table entirely
    if (!e.relatedTarget || !table.contains(e.relatedTarget)) {
      clearDropIndicator(state);
    }
  };

  const onDrop = (e) => {
    if (!state.reorderEnabled || !state.dragColumnId) return;

    e.preventDefault();
    clearDropIndicator(state);

    const th = getManagedHeaderCellFromEvent(e.target, table);
    if (!th) return;

    // Do not allow dropping onto a pinned column
    if (th.getAttribute('data-pinned') === 'true') return;

    const targetColumnId = th.getAttribute('data-column-id');
    if (!targetColumnId || targetColumnId === state.dragColumnId) return;

    // Report the drop as a *gesture* — "put the dragged column before / after
    // this column" — and let Blazor resolve it to a position in the column
    // state. Deliberately do NOT send a header-cell index: the header row is
    // not a 1:1 view of the column order (hidden columns are absent from the
    // DOM, pinned columns are re-partitioned to the edges of the row), and the
    // dragged column is still in the DOM here while the .NET side removes it
    // before re-inserting. Sending a raw index is what made rightward drags
    // overshoot by one. See BbDataGrid.OnColumnReordered for the resolution.
    const rect = th.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const placeAfter = e.clientX >= midX;

    state.dotNetRef.invokeMethodAsync('OnColumnReordered',
      state.dragColumnId, targetColumnId, placeAfter).catch(() => { });

    // Don't null dragColumnId/dragTh here — dragend always fires after drop
    // and handles cleanup + opacity reset.
  };

  state.reorderHandlers = {
    dragstart: onDragStart,
    dragend: onDragEnd,
    dragover: onDragOver,
    dragleave: onDragLeave,
    drop: onDrop
  };
  for (const [eventName, handler] of Object.entries(state.reorderHandlers)) {
    table.addEventListener(eventName, handler);
  }
}

// ─── Content-based Column Sizing ───────────────────────────────────────────

export function initColumnAutoSize(containerElement, gridId) {
  if (!containerElement) return;

  const state = getOrCreateState(gridId);
  state.containerElement = containerElement;

  if (!state.autoSizeObserver) {
    state.autoSizeObserver = new ResizeObserver(() => scheduleAutoSize(state));
    state.autoSizeObserver.observe(containerElement);
  }
}

export function setupAutoSizeColumns(gridId, columnIds) {
  const state = gridStates.get(gridId);
  if (!state || !state.containerElement) return;

  state.autoSizeIds = new Set(columnIds || []);
  scheduleAutoSize(state);
}

function scheduleAutoSize(state) {
  if (state.autoSizeFrame) cancelAnimationFrame(state.autoSizeFrame);
  state.autoSizeFrame = requestAnimationFrame(() => {
    state.autoSizeFrame = 0;
    applyAutoSize(state);
  });
}

function measureRenderedContentWidth(cell) {
  const cellStyle = getComputedStyle(cell);
  const chromeWidth =
    (parseFloat(cellStyle.paddingLeft) || 0) +
    (parseFloat(cellStyle.paddingRight) || 0) +
    (parseFloat(cellStyle.borderLeftWidth) || 0) +
    (parseFloat(cellStyle.borderRightWidth) || 0);
  const root = cell.children.length === 1 ? cell.children[0] : cell;
  const children = Array.from(root.children).filter(child => {
    const style = getComputedStyle(child);
    return style.display !== 'none' && style.position !== 'absolute';
  });

  if (!children.length) {
    const range = document.createRange();
    range.selectNodeContents(root);
    const textWidth = range.getBoundingClientRect().width;
    range.detach();
    return Math.ceil(Math.max(textWidth, 1) + chromeWidth);
  }

  const rects = children.map(child => child.getBoundingClientRect());
  const left = Math.min(...rects.map(rect => rect.left));
  const right = Math.max(...rects.map(rect => rect.right));
  return Math.ceil(right - left + chromeWidth);
}

function applyAutoSize(state) {
  if (state.isDragging) return;

  const table = getManagedTable(state);
  if (!table) return;

  const ths = getManagedHeaderCells(table);
  const cols = getManagedColumns(table);
  if (!ths.length || ths.length !== cols.length) return;

  const widths = ths.map((th) => Math.ceil(th.getBoundingClientRect().width));
  for (const columnId of state.autoSizeIds) {
    const index = ths.findIndex(th => th.getAttribute('data-column-id') === columnId);
    if (index < 0) continue;

    const cells = getManagedColumnCells(table, columnId);
    let contentWidth = 0;
    for (const cell of cells) {
      contentWidth = Math.max(contentWidth, measureRenderedContentWidth(cell));
    }
    widths[index] = Math.max(1, contentWidth);
  }

  const viewportWidth = table.parentElement?.clientWidth || state.containerElement.clientWidth || 0;
  let totalWidth = widths.reduce((sum, width) => sum + width, 0);
  if (totalWidth < viewportWidth) {
    const fillIndex = ths.findLastIndex(th =>
      th.getAttribute('data-pinned') !== 'true' &&
      th.getAttribute('data-auto-size') !== 'true' &&
      th.querySelector('[data-resize-handle]'));
    if (fillIndex >= 0) {
      widths[fillIndex] += viewportWidth - totalWidth;
      totalWidth = viewportWidth;
    }
  }

  widths.forEach((width, index) => {
    const pixelWidth = `${Math.ceil(width)}px`;
    if (cols[index].style.width !== pixelWidth) {
      cols[index].style.width = pixelWidth;
    }
  });
  const tableWidth = `${Math.ceil(Math.max(totalWidth, viewportWidth))}px`;
  if (table.style.width !== tableWidth) {
    table.style.width = tableWidth;
  }
  applyPinnedOffsets(table, ths, widths);
}

// ─── Disposal ───────────────────────────────────────────────────────────────

/**
 * Dispose all column management state for a grid.
 * @param {string} gridId - Grid identifier
 */
export function dispose(gridId) {
  const state = gridStates.get(gridId);
  if (!state) return;

  detachReorderHandlers(state);
  clearDragState(state);
  state.resizeCleanup?.();

  if (state.autoSizeFrame) {
    cancelAnimationFrame(state.autoSizeFrame);
  }
  state.autoSizeObserver?.disconnect();

  // Cleanup reorder indicator
  if (state.dropIndicator && state.dropIndicator.parentNode) {
    state.dropIndicator.parentNode.removeChild(state.dropIndicator);
  }

  gridStates.delete(gridId);
}
