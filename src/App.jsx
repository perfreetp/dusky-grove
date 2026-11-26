import { Show, createSignal } from 'solid-js';
import Wizard from './components/Wizard.jsx';
import LeftPanel from './components/LeftPanel.jsx';
import RightPanel from './components/RightPanel.jsx';
import Viewport from './components/Viewport.jsx';
import { store, undo, redo, canUndo, canRedo, histVersion, runCheck } from './store.js';
import { loadExampleProject, applyExampleFix } from './example.js';

export default function App() {
  // 读取历史版本号，让按钮禁用态跟随撤销/重做栈变化
  const version = () => histVersion();
  const [busy, setBusy] = createSignal(false);

  const loadExample = async () => {
    loadExampleProject();
    setBusy(true);
    setTimeout(async () => {
      await runCheck();
      setBusy(false);
    }, 400);
  };

  const applyFix = async () => {
    applyExampleFix();
    setBusy(true);
    setTimeout(async () => {
      await runCheck();
      setBusy(false);
    }, 300);
  };

  return (
    <Show when={!store.project} fallback={
      <div class="app">
        <header class="topbar">
          <span class="title">料仓与输送辊道三维布置工具</span>
          <span class="tag">{store.project.name}</span>
          <span class="meta">{store.project.designer ? `设计人：${store.project.designer}｜` : ''}{store.project.throughputTph} t/h</span>
          <span class="spacer" />
          <span style={{ display: 'none' }}>{version()}</span>
          <button title="撤销 (Ctrl+Z)" disabled={!canUndo()} onClick={undo}>↶ 撤销</button>
          <button title="重做 (Ctrl+Y)" disabled={!canRedo()} onClick={redo}>↷ 重做</button>
          <button onClick={applyFix} disabled={busy()} title="把第三段辊距从 60 调到 72 并重新检查">一键修复：60→72 重跑</button>
          <button class="ghost" onClick={loadExample} disabled={busy()}>{busy() ? '检查中…' : '重载 8t/h 教学示例'}</button>
        </header>
        <LeftPanel />
        <Viewport />
        <RightPanel />
      </div>
    }>
      <Wizard />
    </Show>
  );
}
