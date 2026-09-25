# AI 交接说明

1. 物理单位固定为 SI；渲染比例不得写回 `core/`。
2. `core/src/solar_system.c` 是唯一物理推进实现。不要为前端复制另一套轨道计算。
3. 浏览器位置已改为 `web/src/ephemeris.ts` 的 Astronomy Engine 星历适配；`bodies.ts` 只提供常量/展示资料。它不是可修改质量的动力学，也不是 WASM。安装并验证 Emscripten 后再接通 C 实验模式，不能直接用固定星历覆盖实验后的状态。
4. 统一执行 `npm run check`（Node 22.18+、GCC、PowerShell）；包括 Web 回归、C 回归和构建。着色器修改必须在浏览器实际进入相关近景，TypeScript 构建不能验证 GLSL。
5. C 内核以太阳系质心 J2000 黄道坐标（+Z 黄北，行星逆时针顺行）、TDB 秒为时标，物理量用 GM 而非质量存储（`solar_body_mass_kg` 换算）。初值由 `node core/tools/fetch-horizons.ts` 从 JPL Horizons 生成 `core/src/solar_system_epoch.inc` 与 `core/tests/horizons_reference.inc`，不要手改；换历元需重新生成并复核测试限值。长时间推进用 `solar_system_advance`（默认 600 s 步长以解析木卫一）。坐标约定与网页星历适配层一致，显示时同样映射为 `(x, z, -y)`；网页使用 UTC，内核使用 TDB（本历元 TDB−UTC = 69.184 s）。GM ≤ 0 的天体是测试粒子（受引力、不施力）。内核尚未接入网页。
6. 用户后续选择了双层视图。概览距离压缩；近景只显示目标，太阳方向来自星历。概览默认锁定太阳，也可选择任意行星为中心；滚轮保持选定中心连续缩放，最近停在完整圆盘接近视口边缘处（不贴入表面）；只有鼠标左键平移才解除锁定，右键和触屏单指负责旋转。近景同样左键平移、右键旋转、滚轮无级缩放。不要重新把概览写成“严格同比例距离”，也不要在点标签时自动打开增强。
7. 动画期间不要执行 OrbitControls.update；只在开始清空阻尼、结束恢复。比例切换需要同时缩放近景相机/裁剪面，退出阈值与行星包围半径成比例。
8. 表面特效位于 `surface-effects.ts`，只在近景启用细节；星空与太阳星芒位于 `space-effects.ts`。视觉时钟与星历、自转分离。特效不是实时天气/磁流体/真实粒子模拟。隐藏页面暂停绘制；恢复时现实模式重新同步 UTC。
9. 目前仓库仍没有首次提交，原有文件暂存状态属于用户；本轮修改未自动 git add、commit 或 push。不能覆盖暂存版本来“清理”工作区。
10. 完整记录见 `docs/review-2026-09-21.md` 与 `docs/review-2026-09-23.md`。UI 样式集中在 `web/src/styles.css` 的设计令牌（`:root` 变量）中；`main.ts` 依赖的元素 ID 与 `data-*` 属性不要改名。启动预览后核实最新代码已加载，尤其依赖/配置改动后；不要用旧页面来验收新 GLSL。
