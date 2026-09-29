
```md
# Solar System Simulator

> **Legacy Web Prototype · Archived**
>
> This repository contains the original browser-based prototype that eventually evolved into **SEREN**, an Unreal Engine-based astronomical visualization project developed by **Nocturne Interactive**.
>
> Active development of this web version has ended.
>
> The repository will remain public as an open-source record of the project's early experiments in astronomical ephemerides, planetary visualization, real-scale rendering, interaction design, and numerical simulation.

---

## Overview

这是一个基于浏览器运行的交互式太阳系可视化项目。

项目展示：

- 太阳
- 八大行星
- 月球
- 四颗伽利略卫星

并包含：

- UTC 星历
- 天体追焦
- 双层视图
- 真实半径 / 视觉增强模式
- 低干扰轨道显示
- 分层行星材质
- 地球夜光与大气层
- 行星表面流动效果
- 天象演示
- 纯净观测模式

该项目最初用于探索：

- 太阳系交互设计
- 天体尺度表达
- 行星视觉系统
- 星历驱动动画
- 轨道与时间系统
- 天文现象可视化
- 浏览器端实时 3D 渲染

它也是后来 **SEREN** 项目的技术与产品原型。

---

# Project Status

## Legacy / Archived

此 Web 版本已经停止主动开发。

目前：

- 不再计划加入大型新功能
- 不保证修复已有 Bug
- 部分功能仍属于实验性质
- 某些计划中的系统并未完成
- 项目保留用于学习、研究、展示和历史归档

代码仍然公开，可以自由阅读和研究。

本仓库记录的是项目早期阶段，因此其中部分架构、算法和视觉方案已经被后续设计取代。

---

# Successor Project

本项目已经迁移至新的 Unreal Engine 架构。

正式后继项目为：

# SEREN

**Developed by Nocturne Interactive**

SEREN 将重新实现并扩展本项目所探索的核心概念，包括：

- 真实尺度太阳系
- 更高精度的天体位置系统
- 恒星与行星视觉系统
- 物理一致的天体遮挡
- 恒星亚像素成像
- 天文现象模拟
- 天体光照与曝光系统
- 大尺度空间渲染
- 面向科普教育和天文爱好者的交互模式

SEREN 目前处于独立开发阶段，并采用新的技术架构。

本 Web 仓库不会与 SEREN 保持功能同步。

---

# Features

## Solar System

当前浏览器版本包含：

- 太阳
- 水星
- 金星
- 地球
- 火星
- 木星
- 土星
- 天王星
- 海王星
- 月球
- Io
- Europa
- Ganymede
- Callisto

天体位置主要由自然星历系统驱动。

---

## Ephemeris & Time

项目支持 UTC 星历时间系统。

底部时间控制栏提供：

- 播放 / 暂停
- 返回当前时间
- 时间倍率调节
- 静止模式

速度滑块最左侧表示：

```text
0 × time
```

此时：

- 星历时间停止推进
- 天体保持当前状态
- 不会自动返回真实 UTC

点击：

```text
现在
```

系统会将模拟时间平滑过渡回真实当前 UTC。

天体会沿轨道连续移动到对应位置，而不是瞬间跳转。

完成同步后，系统恢复此前的播放 / 暂停状态与时间倍率。

---

# Scale Modes

项目提供两种主要尺度模式。

## Real Scale

使用真实天体半径比例。

为了让整个太阳系能够在有限屏幕中观察，概览模式中的天体距离进行了显示层压缩。

因此：

> 屏幕上的概览距离不能作为真实物理距离测量依据。

---

## Visual Enhancement

视觉增强模式保留天体的星历方向，但：

- 放大天体尺寸
- 调整视觉距离
- 避免相邻行星系统重叠
- 保持外侧行星间距逐渐增加
- 卫星紧凑环绕母星

在进入行星系统近景后才会显示对应卫星标签。

该模式主要用于可视化，而不是物理尺度测量。

---

# Camera & Navigation

## Solar System View

默认情况下，相机锁定太阳。

用户可以通过：

```text
视角中心
```

选择：

- 太阳
- 八大行星
- 卫星系统
- 自由浏览

---

## Mouse

支持：

- 左键拖动：平移
- 右键拖动：绕目标旋转
- 中键拖动：缩放

进入自由浏览后，相机将解除天体中心锁定。

---

## Trackpad

macOS 与 Windows 触控板支持：

- 双指捏合：缩放
- 双指移动：旋转
- Shift + 双指移动：概览平移

斜向双指移动可以同时改变水平和垂直视角。

普通滚动不会触发缩放。

---

## Focus

点击天体名称或天体本身后：

1. 天体首先成为当前锁定中心
2. 相机随后进入近景
3. 缩放与旋转继续围绕该天体进行

退出近景可以使用：

```text
Esc
```

或继续缩小。

系统随后恢复之前保存的太阳系概览距离，并保持最后查看的天体作为视角中心。

---

# Astronomical Events

项目内置六类天象演示：

- 日环食
- 日全食
- 月全食
- 水星凌日
- 木星冲日
- 火星冲日

系统会将星历时间移动到对应天象发生时刻，并进入相关观测位置。

其中：

- 太阳位置来自星历
- 月球位置来自星历
- 行星位置来自星历

但：

- 地面
- 海面
- 大气
- 月食红色
- 部分视觉表现

属于实时视觉渲染，并非真实观测图像。

太阳日珥与木星大红斑仍通过近天体视角展示。

---

# Planet Rendering

近景行星包含不同程度的视觉增强。

实现内容包括：

- 凹凸 / 法线地形
- 粗糙度差异
- 独立云层
- 太阳方向约束的大气边缘
- 夜间城市灯光
- 表面流动效果
- 行星环粒子

---

## Earth

地球暗面使用：

**NASA Black Marble**

夜间灯光观测数据。

云层、大气以及表面视觉效果与星历系统相互独立。

---

## Jupiter

木星大红斑保持原始贴图形态。

运动效果主要通过局部纹理平流实现，而不是改变大红斑本身的结构。

---

# Satellite Rotation

月球与四颗伽利略卫星使用同步自转近似。

定义：

```text
Longitude 0
```

作为平均星下点方向。

该方向始终朝向母星。

---

# Interface

主要界面分为：

```text
太阳系观测
引力实验
天文奇观
```

三类工作区。

---

## Left Panel

包含：

- 天体目录
- 搜索
- 行星
- 卫星层级

地球与木星可以展开对应卫星。

---

## Right Panel

显示：

- 当前视角中心
- 天体基本参数
- 天文数据

---

## Bottom Controls

包含：

- 播放 / 暂停
- 当前时间
- 时间倍率
- 真实比例
- 视觉增强
- 图层控制
- 纯净模式

---

# Clean View

按：

```text
U
```

进入或退出纯净模式。

也可以通过：

```text
Esc
```

恢复界面。

桌面端可以双击画布空白区域恢复。

触摸设备同样支持双击恢复。

---

# Time Display

右上角界面时钟显示：

```text
UTC+8
```

即北京时间。

数据工作区中的天文时间仍统一使用：

```text
UTC
```

---

# Numerical Simulation

浏览器当前运行版本主要使用：

**Astronomy Engine**

提供自然星历位置。

此外，项目中还存在一套独立的：

```text
C17 N-body simulation kernel
```

用于研究更高精度的天体动力学系统。

---

## N-body System

包含：

- 太阳
- 八大行星
- 月球
- 四颗伽利略卫星

共：

```text
14 celestial bodies
```

模型包含：

- Newtonian gravity
- Earth J2 oblateness
- Jupiter J2 oblateness
- 4th-order symplectic integration
- JPL Horizons initial conditions

---

## Numerical Validation

在约 30 天的测试时间范围内，与 JPL Horizons 进行数值比较。

典型误差约为：

| Object | Approximate error |
|---|---:|
| Major planets | ≲ 1 km |
| Mercury | ~9 km |
| Io | ~80 km |

这些数据来自项目开发阶段的数值回归测试。

该 C17 N-body 系统：

> **目前尚未接入 Web 前端。**

因此浏览器版本仍主要依赖 Astronomy Engine。

---

# Known Limitations

当前版本仍存在一些未完成内容。

包括：

- C17 N-body 内核尚未连接 Web 渲染系统
- 质量倍率实验未完成
- 引力势平面未完成
- 星际旅行工具未完成
- 金星暂无独立高质量纹理
- 部分天体自转轴尚未进行高精度标定
- 纹理经度没有全部完成天文级校准
- 部分视觉效果属于艺术化表达

因此：

> 本项目中的星历计算与视觉模拟不应被视为专业实时天文观测数据。

---

# Development

## Requirements

需要：

```text
Node.js 22.18+
npm
```

开发过程中主要使用：

```text
Node.js 24
```

Windows 下运行 C 数值测试还需要：

- GCC
- PowerShell

并确保 GCC 已加入：

```text
PATH
```

---

# Running on macOS

```sh
cd ~/"solar system stimulator"
npm ci
npm run dev
```

随后打开终端中显示的本地地址。

---

# Running on Windows

PowerShell：

```powershell
Set-Location 'D:\solar system stimulate'
npm ci
npm run dev
```

请确保首先进入项目目录。

不要直接在：

```text
C:\Users\...
```

中执行 npm 命令。

---

# Testing

运行：

```powershell
npm run check
```

该命令执行：

- 前端回归测试
- C 数值测试
- TypeScript 检查
- Production build

---

# Production Build

构建输出：

```text
web/dist
```

可以使用：

```sh
npm run preview
```

预览生产版本。

---

# Diagnostics

添加 URL 参数：

```text
?diagnostics=1
```

可以显示：

- Frame interval
- Draw calls
- Rendering diagnostics

默认情况下这些信息不会显示在普通界面中。

---

# Documentation

更多技术记录：

- [验收清单](docs/acceptance.md)
- [本轮检查记录](docs/review-2026-09-21.md)
- [架构决策](docs/decisions.md)
- [数据来源](docs/data-sources.md)

根目录中的早期规划文档记录了项目最初的设计方向。

随着开发推进，部分需求已经发生变化。

后续确认的产品行为应以：

```text
docs/decisions.md
```

为主要依据。

---

# Historical Note

这个仓库代表了项目从一个浏览器太阳系实验逐渐发展为完整天文可视化项目的早期阶段。

许多后来进入 SEREN 的设计思想，都曾在这里进行第一次实验。

包括：

- 星历驱动天体运动
- 真实尺度表达
- 行星视觉系统
- 天体追焦
- 时间控制
- 天象演示
- 大尺度空间交互

因此，本仓库将继续保留。

它不是 SEREN 当前技术架构的实现，也不会继续与 SEREN 同步。

它只是记录了：

> **Where SEREN began.**

---

## SEREN

An astronomical visualization project by:

**Nocturne Interactive**

---

*This repository is preserved for educational, experimental, and archival purposes.*
```
