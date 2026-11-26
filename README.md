# RouteClear · 视障路线场景几何简化工具

一个面向关卡/技术美术工作流的桌面 Web 工具：把美术导出的原场景模型和材质导入 SolidJS + Three.js 编辑器，按策划路线拉出通行带，批量清理带外非交互装饰，用 Manifold-3D 合并门框/墙角凹槽并重建略厚的碰撞体，再用探针验证路线净空，最后导出简化几何、关卡碰撞数据和美术删除确认清单。

## 运行

```bash
npm install
npm run dev
```

打开终端输出的 `http://127.0.0.1:5173/`（若端口被占用，Vite 会自动换端口）。

生产构建与本地预览：

```bash
npm run build
npm run preview
```

核心几何规则测试：

```bash
npm run test:logic
```

如果本机安装了 Chrome 或 Edge，还可以运行完整浏览器流程检查（会自动启动 Playwright Core 连接本机浏览器）：

```bash
npm run build
npm run preview -- --port 4173
# 另一个终端：
npm run test:browser
```

## 30 秒复现策划给的第 7 拐角问题

内置示例就是需求中的试玩案例，不需要额外资源：

1. 点击右侧 **“沿路线跑探针”**。
   - 探针沿 7 个拐角的路线行进。
   - 会停在第 7 拐角门框处。
   - 画面标出红色卡点、竖向离地高度 `0.850 m`，右侧显示碰撞盒高度范围和来源。
2. 点击 **“选门框凹槽”**，会选中第 7 门框立梃和内侧凹槽。
3. 点击 **“合并凹槽并平直化”**。
   - Manifold-3D 对凹槽/门套盒体做 union + convex hull。
   - 生成一段青色平直简化几何。
   - 旧凹槽碰撞体随原对象隐藏/撤销快照保留。
   - 新碰撞体沿平面重做，并向通行面额外加厚 `4 cm`，避免玩家靠声效贴墙时卡进凹槽折面。
4. 再次点击 **“沿路线跑探针”**，探针一次走完全程。
5. 按 `Ctrl+Z` 撤销平直化，原几何和旧碰撞体一起回来，可直接对比；再 `Ctrl+Shift+Z` 重做。

也可以选择 **“选墙角凹槽”**，对第 3 拐角的墙面凹槽执行同一个平直化工具。

## 主要操作

- **导入美术场景**：左上角或左侧按钮支持多选 `.glb/.gltf/.obj`，可同时选择 `.bin`、贴图和 `.mtl`。推荐使用自包含 `.glb`。
- **拉通行带**：左侧点击“继续拉通行带”，在场景中左键添加控制点；宽度滑杆可调。策划说明文本可直接编辑。
- **框选删除**：使用“框选删除”工具或直接在选择模式的空白处左键拖框。与通行带相交、交互件、按钮、墙和锁定件会被保护，并在右侧列出原因。
- **批量清理**：可点“选中全部带外装饰”，再点右侧“批量删除并实时重算净宽”。删除后净宽测线和最小净宽立即更新。
- **撤销/重做**：删除批次、移动、加路线点、平直化、导入等都会在动作前保存 JSON 场景快照。连删十几件后按一次撤销可还原整批；如果是多次独立删除，则连续撤销会逐步还原，位置、旋转和碰撞盒均随快照恢复。
- **移动吸附**：只对简化生成段开放。拖动时吸附 `25 cm` 地面网格和相邻墙面；越过工作边界会在松手时弹回原位。
- **视角**：左键选择/框选/拖简化段，右键旋转，滚轮缩放。
- **快捷键**：`Ctrl/Cmd+Z` 撤销，`Ctrl+Shift+Z` 或 `Ctrl+Y` 重做，`Delete/Backspace` 删除选中件，`Esc` 清空选择。

## 净宽与探针规则

- 绿色线段是按路线采样的横断面净宽；红色线段是当前最小净宽位置。
- 净宽射线使用 2D OBB slab 求交，支持旋转墙段。
- 探针使用半径 `0.32 m` 的水平圆形碰撞和 `0.85 m` 中心高度；碰到启用的盒碰撞即停。
- 地面和 `2.05 m` 以上的横梁/门头不参与普通净宽统计，避免把头顶高位误算成地面通行宽度。

这些规则集中在 `src/core/geometry.ts`，可按项目的无障碍验收尺寸调整。

## 导出交接

右侧“导出交接”页提供：

1. **关卡交接 JSON**：`routeclear-level-handoff-*.json`
   - 路线点、通行带宽度、探针半径/高度。
   - Y-up、米制、世界坐标盒碰撞：`center/size/rotationY`。
   - 碰撞来源：`original | imported | rebuilt | thickened`，以及加厚值。
   - 工作边界、简化对象 ID、最近一次探针报告、被删美术件清单。
2. **简化场景 GLB**：`routeclear-simplified-scene-*.glb`
   - 由 Three.js `GLTFExporter` 从当前未删除、未被合并替代的 `modelRoot` 导出。
   - 保留导入材质和贴图；示例程序化材质也会导出。
3. **美术删除 CSV**：`deleted-art-for-review-*.csv`
   - 名称、分类、材质、尺寸、来源文件/节点、删除批次和时间。
   - 美术确认页也可复制 CSV 文本或单件恢复。

## 代码结构

```text
src/
  core/
    types.ts          # 可序列化场景、碰撞、路线、探针和导出契约
    demoScene.ts      # 七拐角复现场景、装饰件、第7门框凹槽
    geometry.ts       # OBB 碰撞、探针、净宽、吸附、边界等纯逻辑
    simplify.ts       # 平直化方案与加厚碰撞规划
  state/
    editor.ts         # Solid store、历史快照、撤销/重做和所有编辑动作
  io/
    importScene.ts    # GLB/glTF/OBJ/MTL/贴图多选导入
    exporters.ts      # JSON/CSV/GLB 导出
    assetLibrary.ts   # 非响应式 Three 资源 Map
  three/
    EditorViewport.ts # Three 场景、框选、指针移动、探针/净宽渲染
    manifoldService.ts# Manifold WASM 初始化、union/hull、几何转换
  components/
    LeftPanel.tsx
    RightPanel.tsx
scripts/
  test-logic.ts       # 纯逻辑验收：卡点、删除、平直化、撤销、吸附
  browser-check.mjs   # 可选的 Playwright + 本机 Chrome/Edge E2E 检查
```

## 实现说明

- 历史记录保存的是可 JSON 序列化的 `EditorState`；Three 对象、GPU 几何和导入根节点放在非响应式 Map 中，通过 ID 对应。
- 平直化不会物理销毁原对象，而是设置 `hiddenBySimplify` 并加入替代段；撤销快照会恢复原几何和原碰撞。
- 新碰撞盒不是简单放大原凹槽，而是按平直表面和路线方向，把额外厚度加到玩家一侧，背面保持贴合墙体。
- `manifold-3d/manifold.wasm` 通过 Vite 的 `?url` 资源和 `locateFile` 加载，生产构建会输出带哈希的 WASM 文件。
