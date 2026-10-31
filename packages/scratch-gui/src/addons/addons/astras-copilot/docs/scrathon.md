# Scrathon 语言规范 (Scrathon Language Specification)

- **版本**: v1.0
- **定位**: 专为 AstraEditor / Scratch 体系设计的严格强类型、Pythonic 代码式积木语言
- **目标**: 为大模型代码生成、积木反编译阅读以及文本化编程提供零歧义、低 Token 消耗、完全匹配底层 Opcode 的 DSL 协议

---

## 目录
1. 语言概述与设计哲学
2. 词法与排版规约
3. 严格类型标签系统（`${t:v}`）
4. 目标与扩展导入声明
5. 事件与帽子积木（Hat Blocks）
6. 自定义积木（Procedures / 函数定义与调用）
7. 控制流与 C 形积木（Control Flow）
8. 变量、列表与数据容器（Data & Variables）
9. 表达式与运算符（Operators）
10. 官方核心积木 API 映射规范
11. 外置扩展积木调用规范
12. 编译期诊断与错误规约
13. 综合工程示例项目
14. 编译器流水线设计参考

---

## 1. 语言概述与设计哲学

Scrathon 是一门以 Python 语法形态为载体、直接面向 Scratch 运行时与图形块体系的领域特定语言（DSL）。

其核心设计哲学包含以下四条准则：

1. **结构直观（Pythonic Structure）**：利用 4 空格缩进天然对齐 Scratch C 形积木的堆叠嵌套，利用 `@` 装饰器天然对齐帽子积木（Hat Blocks）与过程定义。
2. **完全匹配（Strict Matching）**：消除所有可能带来歧义的模糊匹配。积木调用、扩展方法必须 1:1 严格对齐官方注册表或底层 Opcode，无对应的调用直接触发编译错误。
3. **强类型定界（Explicit Typed Sigil）**：所有插入插槽的数值、菜单、布尔、颜色均通过 `${类型:内容}` 显式包裹，与底层阴影积木（Shadow Blocks）保持 1:1 物理映射，彻底消灭歧义。
4. **双向无损互转（Bidirectional Homomorphism）**：Scrathon 代码不仅能单向编译为 Scratch XML / Blocks，工作区现存的积木也能够 100% 反编译为干净的 Scrathon 代码。

---

## 2. 词法与排版规约

### 2.1 缩进与换行
- 必须严格采用 **4 个空格** 进行代码缩进，禁止使用制表符（Tab）。
- 缩进深度增加代表进入 C 形控制积木内部分支（`SUBSTACK` 或 `SUBSTACK2`）。
- 缩进深度回退代表闭合当前积木分支，接续外层的下一个积木（`next` 关系）。
- 语句以换行符分隔，单行只允许一条积木指令。

### 2.2 注释
- 使用 `#` 进行注释，支持整行独立注释与语句行尾注释。
- 编译器会保留有意义的行注释，并可选择将其转换为 Scratch 工作区中的积木附着注释（Block Comments）。

### 2.3 标识符与命名
- 变量名、列表名、广播名允许中英文字符、数字与下划线。
- 建议函数名遵循 `snake_case` 命名风格。

---

## 3. 严格类型标签系统（`${t:v}`）

Scratch 底层的插槽具备严格的物理形态区分（圆角数值插槽、六边形布尔插槽、下拉菜单、色块拾取器等）。在 Scrathon 中，所有插槽入参必须由大括号定界符显式标注类型。

### 3.1 类型标签一览表

| 标签 | 类型全称 | Scratch 底层对应 | 阴影生成规则 | 语法示例 |
| :---: | :--- | :--- | :--- | :--- |
| **`n`** | **Number** (数值) | `math_number` / `math_integer` | 生成数值型阴影积木 | `${n:10}`, `${n:-3.14}`, `${n:hp + 5}` |
| **`s`** | **String** (字符串) / **Broadcast** (广播名) | `text` 阴影 / `event_broadcast_menu` 阴影 | 生成文本阴影；广播插槽自动映射到广播消息 ID | `${s:"Game Over"}`, `${s:"game_start"}` |
| **`b`** | **Boolean** (布尔) | 六角菱形插槽 | 无阴影，插槽必须填入布尔求值积木 | `${b:True}`, `${b:hp > 0}`, `${b:touching(${m:"edge"})}` |
| **`c`** | **Color** (颜色) | `colour_picker` 拾色块 | 生成十六进制色块阴影 | `${c:"#FF5722"}`, `${c:"#00FF00"}` |
| **`m`** | **Menu** (下拉菜单) | 字段专属下拉项 | 生成目标积木绑定的 Field / Menu | `${m:"mouse-pointer"}`, `${m:"mysound"}` |
| **`v`** | **Variable** (变量名) | 变量引用字段 | 自动映射到变量 ID；无前缀=全局，`local:`=角色私有 | `${v:"score"}` / `${variable:"score"}`, `${v:local:"hp"}` |
| **`l`** | **List** (列表名) | 列表引用字段 | 自动映射到列表 ID；无前缀=全局，`local:`=角色私有 | `${l:"inventory"}` / `${list:"inventory"}`, `${l:local:"backpack"}` |

> 变量与列表必须显式区分：`${v:"..."}` / `${variable:"..."}` 是变量，`${l:"..."}` / `${list:"..."}` 是列表。`${n:...}` 始终是数值标签，不能用于名字；`${n:list"..."}` 会直接报错并提示正确写法。

> 广播名统一使用 `${s:"..."}`；编译器会根据目标插槽自动生成 `event_broadcast_menu` 阴影并绑定广播 ID。旧的 `${msg:"..."}` 写法仍然兼容，但反编译输出始终为 `${s}`。

### 3.2 强校验规则
- 若积木插槽期望类型为 `${c:...}`（颜色），传入 `${n:...}` 或 `${s:...}` 均属于编译期类型冲突错误。
- `${b:...}` 内部必须是布尔字面量（`True`/`False`）、比较表达式或布尔 Reporter 积木，不得将数值作为布尔隐式转换。
- **变量与列表是动态 Reporter**：`${v:...}` / `${l:...}` 可以直接填入任意数值、字符串、颜色插槽，编译器会保留 `local:` / `global:` 作用域，不再需要写成 `${n:变量名}`。
  ```python
  move(${v:local:"speed"})          # 数值插槽直接使用局部变量
  say(${l:"inventory"})             # 字符串插槽直接使用列表内容
  touching_color(${v:"playerColor"}) # 颜色插槽直接使用变量
  ```
- 变量/列表**不能**填入布尔插槽和下拉菜单字段：布尔插槽请写比较表达式或 `${b:...}`，菜单请写 `${m:...}`。
- 旧写法 `${n:name}` / `${s:name}` 仍然兼容，但其中的 `name` 不带作用域，等价于全局变量；要首次创建或引用角色私有变量，请使用 `${v:local:"name"}` / `${l:local:"name"}`。

### 3.3 特殊插槽（音符 / 矩阵 / 扩展菜单）

部分扩展积木的参数不是普通数值插槽，而是 Scratch 的特殊输入控件。Scrathon 会根据扩展元数据自动选择正确的阴影类型：

- **音符**：音乐扩展的 `music.playNoteForBeats` 等音符输入使用 `${n:60}`，会生成 `<shadow type="note"><field name="NOTE">60</field></shadow>`，保留点击弹出钢琴键盘与手动输入数值的能力。
- **矩阵**：micro:bit 的矩阵输入使用 `${s:"..."}`，会生成 `matrix` 阴影并写入 `MATRIX` 字段。
- **扩展下拉菜单**：乐器、鼓、语音等菜单使用 `${m:"..."}`，会自动生成对应的 `<扩展>_menu_<菜单名>` 阴影并写入正确的字段。

---

## 4. 目标与扩展导入声明

Scrathon 脚本首部允许声明目标角色作用域与所需加载的外置扩展。

### 4.1 角色目标声明（`target`）
```python
# 声明当前脚本将注入到角色 "Player" 的独立工作区中
target "Player"

# 若针对舞台编写背景与全局逻辑，则指向舞台
target "Stage"
```
*注：若脚本省略 `target` 声明，编译器默认作用于当前编辑器处于焦点状态的角色。*

### 4.2 扩展模块导入声明（`import`）
```python
import pen
import music
import text2speech
```
*注：编译器在静态解析到 `import <ext>` 时，会自动校验当前 VM 运行时中是否已加载对应扩展；若未加载，将自动触发底层 `vm.extensionManager.loadExtensionIdSync` 完成静默加载。*

---

## 5. 事件与帽子积木（Hat Blocks）

帽子积木通过标准 Python 装饰器（`@`）实现，用于修饰独立的事件响应代码块。

### 5.1 常用事件定义表

```python
# 1. 绿旗点击事件
@when_flag_clicked
def on_start():
    ...

# 2. 按键按下事件（参数必须为菜单项 ${m:...}）
@when_key_pressed(${m:"space"})
def on_jump():
    ...

# 3. 角色被点击事件
@when_this_sprite_clicked
def on_click():
    ...

# 4. 接收到广播事件（参数使用字符串广播名 ${s:...}）
@when_broadcast(${s:"game_over"})
def on_game_over():
    ...

# 5. 舞台背景切换事件
@when_backdrop_switches(${m:"backdrop2"})
def on_scene_change():
    ...

# 6. 响度或计时器大于阈值事件
@when_greater_than(${m:"TIMER"}, ${n:5})
def on_timeout():
    ...
```

---

## 6. 自定义积木（Procedures / 函数定义与调用）

Scratch 中的自定义积木（My Blocks）在底层由定义帽子积木（`procedures_definition`）、原型阴影（`procedures_prototype`）、形参读取（`argument_reporter_*`）和过程调用（`procedures_call`）复合构成。

### 6.1 函数定义规范
- 必须使用 `@custom_block` 装饰器修饰。
- 装饰器支持关键字参数 `warp=True|False`（是否勾选“运行时不刷新屏幕”）。
- 装饰器首个参数可传入**多段标签模板字符串**，其中使用 `${类型:形参名}` 对应形参。
- 函数形参列表必须严格声明参数类型：`${n:name}`、`${s:name}`、`${b:name}`。

```python
# 示例 1：基础自定义函数（无穿插标签，默认顺序拼接）
@custom_block(warp=True)
def dash(${n:distance}, ${b:invincible}):
    if ${b:invincible}:
        set_ghost_effect(${n:50})
    move(${n:distance})
    set_ghost_effect(${n:0})

# 示例 2：带穿插文字标签的多段自定义函数
@custom_block("向右冲刺 ${n:distance} 步，开启无敌: ${b:invincible}", warp=True)
def custom_dash(${n:distance}, ${b:invincible}):
    ...
```

### 6.2 形参在函数体内的读取
函数体内读取外部传入的形参时，编译器自动映射到专用的形参读取块：
- `${n:distance}` 或 `${s:distance}` ➔ 编译为 `argument_reporter_string_number`
- `${b:invincible}` ➔ 编译为 `argument_reporter_boolean`

### 6.3 过程调用（Invocation）
调用函数时必须与定义阶段声明的实参类型完全吻合：
```python
# 正确调用
custom_dash(${n:50}, ${b:True})

# 错误调用示例（编译期就地拦截并报错）：
# custom_dash(${s:"50"}, ${b:True})  # 报错：参数 1 期望数值类型 ${n:...}，实际传入字符串 ${s:...}
```

---

## 7. 控制流与 C 形积木（Control Flow）

Scratch 的分支与循环积木均拥有垂直包含块的结构（C-Blocks），Scrathon 使用冒号 `:` 与 4 格缩进表达。

### 7.1 控制流语法定义

```python
# 1. 无限循环 (control_forever)
forever:
    move(${n:5})
    bounce_on_edge()

# 2. 计数循环 (control_repeat)
repeat(${n:10}):
    change_x(${n:5})
    wait(${n:0.05})

# 3. 条件循环 (control_repeat_until)
repeat_until(${b:touching(${m:"edge"})}):
    move(${n:3})

# 4. 单分支条件 (control_if)
if ${b:hp < 20}:
    say(${s:"血量过低！"}, ${n:1})

# 5. 双分支条件 (control_if_else)
if ${b:score >= 100}:
    broadcast(${s:"stage_clear"})
    stop(${m:"all"})
else:
    change_var(${v:"score"}, ${n:10})

# 6. 多分支条件（elif 编译为 else 分支里的嵌套 if/else）
if ${b:score >= 100}:
    broadcast(${s:"stage_clear"})
elif ${b:score >= 50}:
    say(${s:"Good!"})
elif ${b:score >= 10}:
    say(${s:"Keep going"})
else:
    say(${s:"Try again"})

# 7. 等待特定时长 (control_wait)
wait(${n:0.5})

# 8. 等待条件成立 (control_wait_until)
wait_until(${b:key_pressed(${m:"any"})})

# 9. 终止脚本 (control_stop)
stop(${m:"this script"})  # 可选: "all", "this script", "other scripts in sprite"
```

---

## 8. 变量、列表与数据容器（Data & Variables）

Scrathon 提供对 Scratch 全局/局部变量与列表的精确操作。

### 8.1 变量作用域（全局 / 私有）

- `${v:"name"}`：**全局变量**（舞台所有角色共享）。不存在时自动在舞台上创建。
- `${v:local:"name"}`：**当前角色的私有变量**。不存在时自动在当前角色上创建。
- `${v:global:"name"}`：显式指定全局，等价于不写前缀。
- 列表同理：`${l:"name"}` / `${l:local:"name"}` / `${l:global:"name"}`。
- 完整单词别名：`${variable:"name"}` = `${v:"name"}`，`${list:"name"}` = `${l:"name"}`；作用域前缀同样可用，例如 `${list:local:"backpack"}`。
- `local:` 只能用于 `${v:...}` / `${l:...}` / `${variable:...}` / `${list:...}`；`${n:...}` 是数值标签，不能用于变量名或列表名。
- 在舞台上使用 `local:` 会报错；舞台没有私有作用域。
- 反编译时，角色私有变量输出为 `${v:local:"..."}`，全局变量输出为 `${v:"..."}`。
- `${v:...}` / `${l:...}` 本身就是 Reporter，可直接填入数值、字符串、颜色插槽；无需再嵌套进 `${n:...}` / `${s:...}`。

> 注意：不带前缀现在明确表示**全局变量**。若要引用当前角色已有的同名私有变量，必须写 `${v:local:"..."}`。

### 8.2 变量操作
```python
# 全局变量设值 (data_setvariableto)
set_var(${v:"score"}, ${n:0})

# 当前角色私有变量设值
set_var(${v:local:"hp"}, ${n:100})

# 变量累加 (data_changevariableby)
change_var(${v:"score"}, ${n:1})

# 变量 / 列表直接作为值使用
move(${v:local:"speed"})
say(${l:"inventory"})

# 显示与隐藏变量监视器
show_variable(${v:"score"})
hide_variable(${v:"score"})
```

### 8.3 列表操作
```python
# 添加项到全局列表末尾 (data_addtolist)
list_add(${l:"inventory"}, ${s:"Iron Sword"})

# 当前角色的私有列表
list_add(${l:local:"backpack"}, ${s:"Potion"})

# 删除列表指定项或清空 (data_deleteoflist / data_deletealloflist)
list_delete(${l:"inventory"}, ${n:1})
list_delete_all(${l:"inventory"})

# 插入项到指定位置 (data_insertatlist)
list_insert(${l:"inventory"}, ${n:1}, ${s:"Wooden Shield"})

# 替换指定项 (data_replaceitemoflist)
list_replace(${l:"inventory"}, ${n:1}, ${s:"Steel Shield"})

# 读取列表项作为 Reporter 积木
say(list_item(${l:"inventory"}, ${n:1}))
```

---

## 9. 表达式与运算符（Operators）

复杂的表达式直接嵌套在 `${n:...}`、`${s:...}` 或 `${b:...}` 内部，由编译器递归构建对应的嵌套 Reporter 节点。

### 9.1 数值运算符（嵌入在 `${n:...}` 中）
- 基础四则运算：`+`, `-`, `*`, `/` ➔ 分别编译为 `operator_add`, `operator_subtract`, `operator_multiply`, `operator_divide`
- 取余：`%` ➔ 编译为 `operator_mod`
- 四舍五入：`round(expr)` ➔ 编译为 `operator_round`
- 随机数生成：`random(${n:min}, ${n:max})` ➔ 编译为 `operator_random`
- 数学函数：`math(${m:func}, ${n:val})` ➔ 编译为 `operator_mathop`（支持 `sqrt`, `sin`, `cos`, `abs` 等）

### 9.2 布尔关系运算符（嵌入在 `${b:...}` 中）
- 大于、小于、等于：`>`, `<`, `==` ➔ 编译为 `operator_gt`, `operator_lt`, `operator_equals`
- 逻辑与：`and` ➔ 编译为 `operator_and`
- 逻辑或：`or` ➔ 编译为 `operator_or`
- 逻辑非：`not` ➔ 编译为 `operator_not`
- 字符串包含：`contains(${s:str1}, ${s:str2})` ➔ 编译为 `operator_contains`

### 9.3 字符串拼接（嵌入在 `${s:...}` 中）
- 字符串合并：`join(${s:str1}, ${s:str2})` ➔ 编译为 `operator_join`
- 提取第 N 个字符：`letter_of(${n:pos}, ${s:str})` ➔ 编译为 `operator_letter_of`
- 字符串长度：`length_of(${s:str})` ➔ 编译为 `operator_length`

---

## 10. 官方核心积木 API 映射规范

以下指令名称为系统标准保留字，与 Scratch 核心积木实现严格 1:1 物理映射：

### 10.1 运动分类 (Motion)
- `move(${n:steps})` ➔ `motion_movesteps`
- `turn_right(${n:degrees})` ➔ `motion_turnright`
- `turn_left(${n:degrees})` ➔ `motion_turnleft`
- `go_to_xy(${n:x}, ${n:y})` ➔ `motion_gotoxy`
- `go_to(${m:target})` ➔ `motion_goto`
- `glide_to_xy(${n:secs}, ${n:x}, ${n:y})` ➔ `motion_glidesecstoxy`
- `set_x(${n:x})` ➔ `motion_setx`
- `change_x(${n:dx})` ➔ `motion_changexby`
- `set_y(${n:y})` ➔ `motion_sety`
- `change_y(${n:dy})` ➔ `motion_changeyby`
- `bounce_on_edge()` ➔ `motion_ifonedgebounce`
- `set_rotation_style(${m:style})` ➔ `motion_setrotationstyle`

### 10.2 外观分类 (Looks)
- `say_for_secs(${s:text}, ${n:secs})` ➔ `looks_sayforsecs`
- `say(${s:text})` ➔ `looks_say`
- `think_for_secs(${s:text}, ${n:secs})` ➔ `looks_thinkforsecs`
- `think(${s:text})` ➔ `looks_think`
- `switch_costume(${m:costume})` ➔ `looks_switchcostumeto`
- `next_costume()` ➔ `looks_nextcostume`
- `switch_backdrop(${m:backdrop})` ➔ `looks_switchbackdropto`
- `next_backdrop()` ➔ `looks_nextbackdrop`
- `change_size_by(${n:delta})` ➔ `looks_changesizeby`
- `set_size_to(${n:percent})` ➔ `looks_setsizeto`
- `set_effect(${m:effect}, ${n:value})` ➔ `looks_seteffectto`
- `change_effect_by(${m:effect}, ${n:delta})` ➔ `looks_changeeffectby`
- `clear_graphic_effects()` ➔ `looks_cleargraphiceffects`
- `show()` ➔ `looks_show`
- `hide()` ➔ `looks_hide`
- `go_to_layer(${m:"front" | "back"})` ➔ `looks_gotofrontback`

### 10.3 声音分类 (Sound)
- `play_sound_until_done(${m:sound})` ➔ `sound_playuntildone`
- `start_sound(${m:sound})` ➔ `sound_play`
- `stop_all_sounds()` ➔ `sound_stopallsounds`
- `change_volume_by(${n:delta})` ➔ `sound_changevolumeby`
- `set_volume_to(${n:volume})` ➔ `sound_setvolumeto`

### 10.4 侦测分类 (Sensing)
- `touching(${m:target})` ➔ `sensing_touchingobject`（布尔值）
- `touching_color(${c:color})` ➔ `sensing_touchingcolor`（布尔值）
- `distance_to(${m:target})` ➔ `sensing_distanceto`（数值）
- `ask_and_wait(${s:prompt})` ➔ `sensing_askandwait`
- `key_pressed(${m:key})` ➔ `sensing_keypressed`（布尔值）
- `mouse_down()` ➔ `sensing_mousedown`（布尔值）
- `mouse_x()` / `mouse_y()` ➔ `sensing_mousex` / `sensing_mousey`

---

## 11. 外置扩展积木调用规范

对于官方扩展及第三方扩展积木，Scrathon 实行 **“命名空间 + 确定性 Opcode 完全对齐”** 规则：
调用格式为：`模块名.Opcode(${类型:值}, ...)`

### 11.1 画笔扩展 (`pen`) 示例
```python
import pen

pen.clear()
pen.penDown()
pen.penUp()

# 1. 设置色块 (setPenColorToColor 严格接受颜色 ${c:...})
pen.setPenColorToColor(${c:"#00E5FF"})

# 2. 设置分量数值 (setPenColorParamTo 严格接受菜单 ${m:...} 与数值 ${n:...})
pen.setPenColorParamTo(${m:"brightness"}, ${n:100})

# 3. 改变分量数值 (changePenColorParamBy 严格接受菜单 ${m:...} 与增量 ${n:...})
pen.changePenColorParamBy(${m:"saturation"}, ${n:10})

# 4. 设置笔触粗细 (setPenSizeTo 严格接受数值 ${n:...})
pen.setPenSizeTo(${n:4})
```

### 11.2 音乐扩展 (`music`) 示例
```python
import music

# 击打乐器：乐器代号与拍数
music.playDrumForBeats(${m:1}, ${n:0.25})

# 休止指定拍数
music.restForBeats(${n:0.5})

# 演奏音符：MIDI 音高 (0~127) 与拍数
music.playNoteForBeats(${n:60}, ${n:0.5})

# 设定乐器编号
music.setInstrument(${m:1})
```

### 11.3 文字朗读扩展 (`text2speech`) 示例
```python
import text2speech

text2speech.speakAndWait(${s:"欢迎来到 AstraEditor！"})
text2speech.setVoice(${m:"ALTO"})
text2speech.setLanguage(${m:"zh-cn"})
```

---

## 12. 编译期诊断与错误规约

在严格匹配原则下，编译器会在词法、语法与符号分析阶段实行就地拦截，输出确定性诊断信息。

### 12.1 诊断错误分类
1. **`SyntaxError` (语法结构错误)**：缺少冒号 `:`、缩进未对齐 4 的倍数、大括号定界符 `${` 未闭合。
2. **`UnknownInstructionError` (未知积木错误)**：调用了不存在的积木指令或拼写错误的 Opcode。
3. **`TypeMismatchError` (插槽类型冲突错误)**：实参标签与积木插槽的定义冲突（例如向 `${c:...}` 插槽传入了 `${n:50}`）。
4. **`ArgumentCountError` (参数个数错误)**：传入实参数量少于或多于目标积木所定义的必需输入数量。
5. **`UnimportedModuleError` (模块未导入错误)**：调用扩展方法时未在文件前部声明 `import <ext>`。

### 12.2 错误输出格式规范
编译器必须明确输出发生错误的行号、错误片段及修复建议，例如：

```text
[Scrathon CompileError]
File: "Sprite1.py", Line 14, Column 5
Code: pen.setPenColorToColor(${n:50})
      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
TypeMismatchError:
  Block 'pen_setPenColorToColor' slot 'COLOR' expects a color token (${c:...}),
  but received a number token (${n:...}).

Correct Syntax:
  pen.setPenColorToColor(${c:"#FF0000"})
```

---

## 13. 综合工程示例项目

以下为一个完整的、可直接被编译器编译并在 Scratch 工作区中无损呈现的 Scrathon 脚本：

```python
target "Player"
import pen
import music

# -------------------------------------------------------------
# 1. 自定义积木定义：带类型参数与无刷新屏幕 (Warp)
# -------------------------------------------------------------
@custom_block("绘制多边形，边数 ${n:sides}，边长: ${n:length}，颜色: ${c:line_color}", warp=True)
def draw_polygon(${n:sides}, ${n:length}, ${c:line_color}):
    pen.setPenColorToColor(${c:line_color})
    pen.penDown()
    repeat(${n:sides}):
        move(${n:length})
        turn_right(${n:360 / sides})
    pen.penUp()

# -------------------------------------------------------------
# 2. 绿旗主入口脚本
# -------------------------------------------------------------
@when_flag_clicked
def main():
    # 数据与环境初始化
    set_var(${v:"score"}, ${n:0})
    show_variable(${v:"score"})
    clear_graphic_effects()
    set_size_to(${n:100})
    go_to_xy(${n:0}, ${n:0})
    
    # 画布初始化
    pen.clear()
    pen.setPenSizeTo(${n:3})
    
    # 调用自定义函数绘制一个天蓝色六边形
    draw_polygon(${n:6}, ${n:60}, ${c:"#00E5FF"})
    
    say_for_secs(${s:"图形绘制完毕！按空格键跳跃。"}, ${n:2})
    
    # 核心常驻循环
    forever:
        move(${n:4})
        bounce_on_edge()
        
        # 碰撞与拾取逻辑
        if ${b:touching(${m:"_mouse_"})}:
            change_var(${v:"score"}, ${n:1})
            start_sound(${m:"pop"})
            
        wait(${n:0.02})

# -------------------------------------------------------------
# 3. 按键控制与广播触发
# -------------------------------------------------------------
@when_key_pressed(${m:"space"})
def on_jump():
    # 跳跃模拟
    repeat(${n:8}):
        change_y(${n:10})
    repeat(${n:8}):
        change_y(${n:-10})
        
    # 分数过关校验
    if ${b:${v:"score"} >= 10}:
        broadcast(${s:"stage_clear"})

# -------------------------------------------------------------
# 4. 广播事件监听
# -------------------------------------------------------------
@when_broadcast(${s:"stage_clear"})
def on_clear():
    say(${s:"恭喜通关！"})
    music.playNoteForBeats(${n:72}, ${n:0.5})
    stop(${m:"all"})
```

---

## 14. 编译器流水线设计参考

在实现 Scrathon 编译器与反编译器时，推荐按三阶段流水线推进：

1. **词法阶段 (Tokenizer / Lexer)**：
   - 维护缩进栈（Indent Stack），将空格缩进转化为 `INDENT` 与 `DEDENT` 标记；
   - 提取并严格验证 `${类型:内容}` 词元。
2. **语法与抽象语法树阶段 (AST Parser)**：
   - 解析 `@装饰器` 并识别帽子积木；
   - 识别 `@custom_block` 并构建过程定义节点（含 Mutation 元数据）；
   - 将 C 形块分支构建为 `body: [...]` 树形节点，消灭底层的 `next` 递归负担。
3. **XML 发射阶段 (Scratch-Blocks XML Emitter)**：
   - 将 AST 映射为符合 `scratch-blocks` 规范的原生 XML；
   - 自动装配对应插槽的阴影积木（`<shadow type="math_number">` 等）；
   - 最终提交至 `Blockly.Xml.domToWorkspace`，原子化完成工作区渲染并保留 Ctrl+Z 撤销能力。
