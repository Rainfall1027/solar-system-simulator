# 数据来源与精度边界（2026-09-21）

## 采用数据

- 行星质量、直径/半径与半长轴：NASA NSSDC [Planetary Fact Sheet – Metric](https://nssdc.gsfc.nasa.gov/planetary/factsheet/)。阶段 1 为便于基础模型阅读保留了适合展示的有效数字。
- 地球平均半径：NASA NSSDC [Earth Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html)。
- 天文单位与万有引力常数：JPL [Astrodynamic Parameters](https://ssd.jpl.nasa.gov/astro_par.html)。
- 未来精密位置、速度初值：JPL [Horizons System](https://ssd.jpl.nasa.gov/horizons/)。
- 行星表面纹理与土星环纹理：Solar System Scope [Solar Textures](https://edu.solarsystemscope.com/textures/)，CC BY 4.0；已在应用详情面板中保留署名。
- 地球夜间灯光：NASA Earth Observatory [Earth at Night / Black Marble 2016](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/)。使用去云后的夜间辐亮度合成图作为城市灯光遮罩；它反映实际夜间人类活动分布，是人口与城市密度的观测代理，但不能解释成逐城市人口数据库。
- 月球颜色与高程：NASA Scientific Visualization Studio [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720)，由 LRO WAC 影像和 LOLA 激光测高数据生成。颜色贴图负责反照率，高程贴图只用于微弱表面凹凸。
- 地球法线与云图、木卫一/二/三/四贴图：来自 [Celestia Content](https://github.com/CelestiaProject/CelestiaContent) 的公开资源及其逐项署名文件；其中木卫一、木卫三等资源追溯至 NASA/JPL/USGS/Galileo 数据。仓库中的派生缩放版本保持原始署名要求，发布前仍应随发行包保留完整 third-party notices。
- 小行星碎片的 `asteroid-carbonaceous.jpg` 与 `asteroid-stony.jpg` 是使用内置图像生成工具制作的原创示意纹理，分别参考 NASA [贝努表面观测](https://www.nasa.gov/missions/nasas-osiris-rex-unlocks-more-secrets-from-asteroid-bennu/)与 [爱神星风化层说明](https://science.nasa.gov/photojournal/the-color-of-regolith/) 的暗色碎石、灰褐岩屑特征。它们不是探测器拍摄的实际小行星贴图，也不对应带内某颗已编目的天体；四类外形和凹凸着色同样是视觉模拟。
- 柯伊伯带范围与形态：NASA Science [Kuiper Belt Facts](https://science.nasa.gov/solar-system/kuiper-belt/facts/)。主带从海王星附近约 30 AU 延伸到约 50 AU，整体是有厚度的盘状冰质小天体区。网页中的实例化小天体及亚像素标记是稀疏示意；使用前述原创碎石纹理再调色，不对应已编目柯伊伯带天体，模型大小也不是物理比例。
- 奥尔特云位置与形态：NASA Science [Oort Cloud Facts](https://science.nasa.gov/solar-system/oort-cloud/facts/)。整体尚未直接成像确认，内缘估计约 2,000–5,000 AU、外缘可能达 10,000–100,000 AU。内外分区约 20,000 AU 的用法见 [Brasser 等人的动力学模型](https://www.sciencedirect.com/science/article/abs/pii/S001910350800105X)，并非清晰的实测边界。网页把较扁平的内奥尔特云（希尔斯云）与更接近球状的外奥尔特云分开画成稀疏点群；具体密度是概念性表达。显示距离高度压缩，绝非可见的发光星云或实体球面。

## C 内核数据（2026-09-23）

- 初值：[JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) API 1.2，太阳系质心 `500@0`、`REF_PLANE=ECLIPTIC`、`REF_SYSTEM=ICRF`、`TIME_TYPE=TDB`、几何位置；历元 2026-09-21 00:00 TDB，另取 1 天与 30 天后状态作回归参考。天体编号：10、199、299、399、4、599、6、7、8、301、501–504。
- GM：Horizons 物理数据（DE440 / JUP365）；火星、土星、天王星、海王星用系统值（DE440）。
- J2：地球 1.0826359×10⁻³（IERS 2010，R=6378.1366 km）；木星 1.46965×10⁻²（Juno，Iess et al. 2018，R=71492 km）。自转轴：IAU WGCCRE 2015 J2000 值（未含岁差项）。

## 当前数据状态

阶段 1 的质量、半径和半长轴是物理量。C 内核的相位与速度仍用于可重复的近圆参考场景，并非真实日期的状态矢量。2026-09-21 起，浏览器改为以下独立星历数据层；不能将两者混称为已经连通的实时 C 模拟。

## 浏览器星历

- [Astronomy Engine](https://github.com/cosinekitty/astronomy)，npm 固定版本 `2.1.19`，MIT；[API 参考](https://github.com/cosinekitty/astronomy/blob/master/source/js/README.md)。作者说明其使用 VSOP87/NOVAS 模型，并与独立来源对照，设计精度约一角分。此处不将其等同于航天导航用高精度数值星历。
- `HelioState` / `HelioVector` 取得太阳中心几何状态；月球和伽利略卫星分别使用 `GeoMoonState` 与 `JupiterMoons`，再叠加到父天体的日心状态。EQJ 经 `Rotation_EQJ_ECL` 转为 J2000 黄道系。原单位 AU、AU/日，转换为米后再用于展示；行星使用每日缓存，卫星使用 15 分钟缓存并做 Hermite 插值。
- 现实模式使用操作系统当前 UTC。系统时间不正确时，画面对应的日期也会不正确；不需要从服务器下载每一帧数据。
- 白色轨道是周边一个公转周期的星历采样，不是质量变化后的预测轨迹。

## JPL 交叉校验

查询日期：2026-09-21。参考时刻：`2026-09-21T00:00:00Z`。太阳中心 `500@10`，`TIME_TYPE=UT`，`REF_PLANE=ECLIPTIC`，`REF_SYSTEM=ICRF`，`VEC_CORR=NONE`，原输出 `KM-S`。

来源：[Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html)。该次服务返回签名版本 `1.2`，文档页面版本为 `1.3`，保留实际响应版本。水星/地球查询天体中心 199/399，木星/海王星查询系统质心 5/8，对照范围不能解释为卫星级定位精度。

完整数值见 `web/tests/horizons-reference.json`；相对位置矢量误差：水星 `1.52e-5`，地球 `6.44e-6`，木星 `2.20e-5`，海王星 `7.53e-5`，均小于测试预算 `3e-4`。可用 `node web/tests/verify-horizons.ts` 串行重新查询，正常测试使用离线记录，避免依赖网络。

[NASA API 使用政策](https://ssd-api.jpl.nasa.gov/doc/index.php)禁止普通网页直接嵌入这些 API；因此浏览器不直接请求该服务。

## 视觉与素材边界

行星云层的平流、太阳等离子体、气态条带、大气散射与星环粒子均为程序视觉效果，不是实时遥感、气象或磁流体数据。地球灯光遮罩来自真实夜光观测，但画面没有实时天气或逐户灯光。太阳表面的既有 `sun-surface.png` 为定制素材，其原始来源/生成记录待补齐；不能用行星纹理的 CC BY 4.0 声明替代它的来源。

自转周期为参考恒星自转周期，金星和天王星使用负号标记逆行；当前没有严格的自转轴倾角和纹理经度配准。后续 C/WASM 接入应选择同一 UTC/TDB 历元，保存九天体完整位置/速度并转换到已约定的坐标系。
