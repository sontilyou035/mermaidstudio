# Mermaid Studio

A visual Mermaid editor: drop blocks onto a canvas, serialize to Mermaid / Markdown, and save locally. This context covers the editor's own concepts.

## Language

**剧本 (Timeline)**:
A time-ordered sequence of events attached to one diagram, used to demonstrate how data changes over a page flow.
_Avoid_: 时间轴, 动画, 演示脚本

**事件 (Event)**:
One page operation (menu click, button press, etc.) that starts at a point on the 剧本 and lasts a duration.
_Avoid_: 操作, 步骤, action

**变更 (Change)**:
A single field value produced by an 事件: one table node, one field, one new value.
_Avoid_: 差异, diff, 修改

**值覆盖层 (Value Overlay)**:
Runtime values shown on table nodes during 回放; never written into the diagram document.
_Avoid_: 数据快照, 影子数据

**播放头 (Playhead)**:
The current playback moment of the 剧本, shown as a movable vertical marker.
_Avoid_: 光标, 进度条

**回放 (Playback)**:
The process of advancing the 播放头 so that 事件 fire and 变更 apply.
_Avoid_: 播放, 动画演示

**核心表 (Core Table)**:
A table kept by 裁剪; only its 变更 take part in 回放 and export. Unchecked tables stay in the 剧本 as dimmed data and are filtered out on export.
_Avoid_: 主表, 主要表

**裁剪 (Pruning)**:
The human step after import that drops 变更 on non-core tables and deletes whole 事件 from the 剧本.
_Avoid_: 删减, 过滤

**审阅 (Review)**:
The panel view where 裁剪 happens: core-table checkboxes, event deletion and restore.
_Avoid_: 审核, 检查

**待确认项 (Open Item)**:
A question on the diagram that has no decision yet. Each one is drawn as a dashed edge and listed one-for-one in the 存疑清单.
_Avoid_: 待定项, 疑问点, 未决项

**存疑清单 (Open-Item List)**:
The per-diagram list of 待确认项, one row per dashed edge, each row carrying an unchecked box. It is a view of 待确认项, not a separate concept.
_Avoid_: 待办清单, TODO 列表

**关系图谱 (Relation Graph)**:
The main-view alternative that arranges the same 节点 and 连线 by proximity instead of by direction, for reviewing how tables relate. It is a read-only view of the diagram: it never owns node positions, and its 焦点邻域 is dimming, not hiding.
_Avoid_: 依赖图, 知识图谱, 力导向图

**焦点邻域 (Focus Neighborhood)**:
The part of a 关系图谱 within a given number of 跳 of one chosen node. Everything outside it stays on screen, dimmed.
_Avoid_: 子图, 局部图, ego 网络

**跳 (Hop)**:
One 连线 step in a 关系图谱; the distance between two nodes there is counted in 跳.
_Avoid_: 层, 度, 距离
