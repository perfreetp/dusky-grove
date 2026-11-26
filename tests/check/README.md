# 校核脚本

| 文件 | 内容 |
| --- | --- |
| `physics.mjs` | 平衡条件 ΣR = W、吊点受拉约束、按刚度分配（R_i = k_i·v_i）、峰值随载荷迁移、净空判定、绳索限力与动力学稳定性 |
| `cantilever.mjs` | 与解析解/独立参考值对照：简支梁 PL³/48EI、静定梁反力 2/3 与 1/3；Betti 互等；连续梁上支座负反力引发的松弛 |
| `test_ui.py` | 无头浏览器交互：真实指针拖动、偏载与中跨预置、剖切/限值滑块、抛接动画、移动端横向溢出 |

运行：

```bash
node tests/check/physics.mjs
node tests/check/cantilever.mjs
python tests/check/test_ui.py     # 需要 playwright（python）
```
