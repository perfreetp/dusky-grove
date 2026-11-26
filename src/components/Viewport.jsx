/* 三维视口：挂载 PlayCanvas 引擎、承接设备库拖放、显示吸附/落值提示 */
import { onCleanup, onMount, createSignal, createEffect } from 'solid-js';
import {
  store, select, beginDrag, patchDrag, commitDrag, addSilo, addSegment,
  undo, redo, removeSelected
} from '../store.js';

export default function Viewport() {
  let canvasRef;
  let engine = null;
  const [ready, setReady] = createSignal(false);
  const [toast, setToast] = createSignal(null);
  const [dropActive, setDropActive] = createSignal(false);
  let toastTimer;

  const showToast = (text, ms = 2200) => {
    setToast(text);
    clearTimeout(toastTimer);
    if (text) toastTimer = setTimeout(() => setToast(null), ms);
  };

  onMount(async () => {
    // PlayCanvas 体积大，进入主界面后才动态加载（向导阶段不下载引擎）
    const { SceneEngine } = await import('../engine/scene-engine.js');
    engine = new SceneEngine(canvasRef, {
      onSelect: (sel) => select(sel ? sel.kind : null, sel ? sel.id : null),
      onSnapHint: (hint) => (hint ? showToast(hint, 999999) : clearTimeout(toastTimer) || setToast(null)),
      onDragStart: (label) => beginDrag(label),
      onPatch: (fn) => patchDrag(fn),
      onDragCommit: (summary) => {
        commitDrag();
        showToast(summary, 2600);
      },
      onExternalDrop: ({ x, z, payload }) => {
        if (payload.kind === 'silo') addSilo(payload.catalogId, x, z);
        else addSegment(payload.catalogId, x, z, 4000);
        engine.focusView();
      }
    });
    engine.sync(store.project, store.selected);
    setReady(true);

    // Solid 细粒度响应式 -> 引擎同步（引擎内部按签名决定是否重建）
    createEffect(() => {
      JSON.stringify(store.project);
      JSON.stringify(store.selected);
      engine.sync(store.project, store.selected);
    });

    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault(); redo();
      } else if (e.key === 'Delete' && store.selected.id) {
        removeSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      window.removeEventListener('keydown', onKey);
      engine.destroy();
    });
  });

  const onDragOver = (e) => {
    if (e.dataTransfer.types.includes('application/x-device')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropActive(true);
    }
  };
  const onDragLeave = () => setDropActive(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDropActive(false);
    const raw = e.dataTransfer.getData('application/x-device');
    if (!raw || !engine) return;
    const payload = JSON.parse(raw);
    const rect = canvasRef.getBoundingClientRect();
    engine.handleExternalDrop(e.clientX - rect.left, e.clientY - rect.top, payload);
  };

  return (
    <div class="viewport" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <canvas ref={canvasRef} />
      {!ready() && <div class="drop-hint" style={{ border: 'none', background: 'transparent' }}>三维引擎加载中…</div>}
      <div class="view-hint">
        左键拖辊子：改辊距（吸附安全区间）｜拖框架：移段｜拖蓝口：挪落料口（Shift 拖改口宽）<br />
        左键空白拖动：旋转视角｜右键拖动：平移｜滚轮：缩放｜Ctrl+Z / Ctrl+Y：撤销重做｜Delete：删除
      </div>
      {dropActive() && <div class="drop-hint">松开鼠标，设备落到此位置</div>}
      {toast() && <div class="snap-toast">{toast()}</div>}
    </div>
  );
}
