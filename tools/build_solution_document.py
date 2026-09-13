from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Callable, Iterable

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "文档办公与效率工具方案.docx"
DOCX_OUTPUT = ROOT / "output" / "docx" / "文档办公与效率工具完整解决方案_V2.0.docx"
ASSET_DIR = ROOT / "output" / "assets"

FONT_REGULAR = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "msyh.ttc"
FONT_BOLD = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "msyhbd.ttc"

NAVY = "19324D"
TEAL = "177E89"
GREEN = "3A7D44"
AMBER = "D48B22"
RED = "B84A45"
INK = "24313D"
MUTED = "607080"
PALE = "F2F6F7"
PALE_BLUE = "EAF1F6"
PALE_GREEN = "EAF4EC"
WHITE = "FFFFFF"


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top: int = 80, start: int = 100, bottom: int = 80, end: int = 100) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def prevent_row_split(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    if tr_pr.find(qn("w:cantSplit")) is None:
        tr_pr.append(OxmlElement("w:cantSplit"))


def repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_repeat_header(table) -> None:
    if table.rows:
        repeat_table_header(table.rows[0])
    for row in table.rows:
        prevent_row_split(row)


def set_east_asian_font(run, name: str, size: float | None = None, bold: bool | None = None) -> None:
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold


def add_field(run, instruction: str) -> None:
    fld_char_begin = OxmlElement("w:fldChar")
    fld_char_begin.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = instruction
    fld_char_separate = OxmlElement("w:fldChar")
    fld_char_separate.set(qn("w:fldCharType"), "separate")
    fld_char_end = OxmlElement("w:fldChar")
    fld_char_end.set(qn("w:fldCharType"), "end")
    run._r.extend((fld_char_begin, instr_text, fld_char_separate, fld_char_end))


def add_bullets(doc: Document, items: Iterable[str], style: str = "List Bullet") -> None:
    for item in items:
        p = doc.add_paragraph(style=style)
        p.add_run(item)


def add_numbered(doc: Document, items: Iterable[str]) -> None:
    add_bullets(doc, items, style="List Number")


def add_manual_numbered(doc: Document, items: Iterable[str]) -> None:
    for index, item in enumerate(items, start=1):
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.left_indent = Cm(0.65)
        paragraph.paragraph_format.first_line_indent = Cm(-0.65)
        paragraph.add_run(f"{index}. ")
        paragraph.add_run(item)


def add_table(doc: Document, headers: list[str], rows: list[list[str]], widths: list[float] | None = None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"
    for index, header in enumerate(headers):
        cell = table.rows[0].cells[index]
        cell.text = header
        set_cell_shading(cell, NAVY)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        for run in cell.paragraphs[0].runs:
            run.font.color.rgb = RGBColor(255, 255, 255)
            run.bold = True
    for row_index, values in enumerate(rows, start=1):
        cells = table.add_row().cells
        for column_index, value in enumerate(values):
            cells[column_index].text = value
            cells[column_index].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if row_index % 2 == 0:
                set_cell_shading(cells[column_index], PALE)
    if widths:
        for row in table.rows:
            for index, width in enumerate(widths):
                row.cells[index].width = Cm(width)
    set_repeat_header(table)
    doc.add_paragraph()
    return table


def add_callout(doc: Document, title: str, body: str, fill: str = PALE_BLUE) -> None:
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    set_cell_shading(cell, fill)
    set_cell_margins(cell, top=140, start=180, bottom=140, end=180)
    p = cell.paragraphs[0]
    title_run = p.add_run(f"{title}  ")
    title_run.bold = True
    title_run.font.color.rgb = RGBColor.from_string(NAVY)
    p.add_run(body)
    doc.add_paragraph()


def add_code_block(doc: Document, lines: list[str]) -> None:
    table = doc.add_table(rows=1, cols=1)
    cell = table.cell(0, 0)
    set_cell_shading(cell, "F4F5F6")
    set_cell_margins(cell, top=140, start=180, bottom=140, end=180)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    for index, line in enumerate(lines):
        run = p.add_run(line)
        run.font.name = "Consolas"
        run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        run.font.size = Pt(8.5)
        if index < len(lines) - 1:
            run.add_break()
    doc.add_paragraph()


def add_caption(doc: Document, text: str) -> None:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(8)
    run = p.add_run(text)
    run.italic = True
    run.font.color.rgb = RGBColor.from_string(MUTED)
    run.font.size = Pt(9)


def find_paragraph(doc: Document, prefix: str):
    for paragraph in doc.paragraphs:
        if paragraph.text.strip().startswith(prefix):
            return paragraph
    raise ValueError(f"未找到目标段落：{prefix}")


def insert_block_before(doc: Document, target, builder: Callable[[], None]) -> None:
    body = doc._element.body
    section_properties = body.sectPr
    last_existing = section_properties.getprevious()
    builder()
    node = last_existing.getnext()
    while node is not section_properties:
        next_node = node.getnext()
        target._p.addprevious(node)
        node = next_node


def load_fonts(base: int = 34):
    regular = ImageFont.truetype(str(FONT_REGULAR), base)
    small = ImageFont.truetype(str(FONT_REGULAR), int(base * 0.72))
    bold = ImageFont.truetype(str(FONT_BOLD if FONT_BOLD.exists() else FONT_REGULAR), base)
    title = ImageFont.truetype(str(FONT_BOLD if FONT_BOLD.exists() else FONT_REGULAR), int(base * 1.25))
    return regular, small, bold, title


def draw_arrow(draw: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], color: str, width: int = 5) -> None:
    draw.line((start, end), fill=color, width=width)
    x2, y2 = end
    x1, y1 = start
    if abs(x2 - x1) >= abs(y2 - y1):
        direction = 1 if x2 > x1 else -1
        points = [(x2, y2), (x2 - direction * 18, y2 - 11), (x2 - direction * 18, y2 + 11)]
    else:
        direction = 1 if y2 > y1 else -1
        points = [(x2, y2), (x2 - 11, y2 - direction * 18), (x2 + 11, y2 - direction * 18)]
    draw.polygon(points, fill=color)


def draw_centered(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, font, fill: str) -> None:
    left, top, right, bottom = box
    bbox = draw.multiline_textbbox((0, 0), text, font=font, spacing=8, align="center")
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    draw.multiline_text(
        ((left + right - width) / 2, (top + bottom - height) / 2),
        text,
        font=font,
        fill=fill,
        spacing=8,
        align="center",
    )


def create_architecture_diagram(path: Path) -> None:
    image = Image.new("RGB", (1800, 1020), "#FFFFFF")
    draw = ImageDraw.Draw(image)
    regular, small, bold, title = load_fonts(34)
    draw.text((80, 45), "本地优先的分层架构与集成边界", font=title, fill=f"#{NAVY}")
    draw.text((82, 108), "默认链路不出本机；云端能力必须经过显式授权与供应商适配层", font=small, fill=f"#{MUTED}")

    layers = [
        ("表现层", "Vue 3 · Pinia · Element Plus\n导航 / 全局搜索 / 工作区 / 任务中心", PALE_BLUE, NAVY),
        ("桥接层", "Tauri IPC 白名单\n请求校验 · 进度事件 · 取消 · 统一错误码", "E8F5F3", TEAL),
        ("核心服务层", "文档 · OCR · 图片 · 加密 · 网络\nRust 作业调度器 + 并发上限 + 超时", PALE_GREEN, GREEN),
        ("本地数据与插件", "SQLite / Store · 滚动日志 · 模型插件目录\n原子写入 · 哈希校验 · 可卸载", "FFF5E5", AMBER),
    ]
    left = 120
    right = 1260
    top = 180
    height = 145
    gap = 48
    for index, (name, details, fill, stroke) in enumerate(layers):
        y1 = top + index * (height + gap)
        y2 = y1 + height
        draw.rounded_rectangle((left, y1, right, y2), radius=18, fill=f"#{fill}", outline=f"#{stroke}", width=4)
        draw.text((left + 35, y1 + 28), name, font=bold, fill=f"#{stroke}")
        draw.multiline_text((left + 310, y1 + 26), details, font=regular, fill=f"#{INK}", spacing=8)
        if index < len(layers) - 1:
            draw_arrow(draw, ((left + right) // 2, y2 + 5), ((left + right) // 2, y2 + gap - 8), f"#{MUTED}", 4)

    ext_left, ext_right = 1360, 1720
    ext_boxes = [
        (220, 355, "系统能力", "文件选择 / 通知\nWebView2 / 更新器", PALE_BLUE, NAVY),
        (430, 585, "外部运行时", "LibreOffice\n按需启动 / 限时退出", "FFF5E5", AMBER),
        (640, 810, "可选云服务", "AI / 在线 OCR\n汇率 / IP", "FBEDED", RED),
    ]
    for y1, y2, heading, details, fill, stroke in ext_boxes:
        draw.rounded_rectangle((ext_left, y1, ext_right, y2), radius=16, fill=f"#{fill}", outline=f"#{stroke}", width=4)
        draw.text((ext_left + 30, y1 + 24), heading, font=bold, fill=f"#{stroke}")
        draw.multiline_text((ext_left + 30, y1 + 78), details, font=small, fill=f"#{INK}", spacing=7)
    draw_arrow(draw, (1265, 385), (1350, 300), f"#{NAVY}", 4)
    draw_arrow(draw, (1265, 535), (1350, 505), f"#{AMBER}", 4)
    draw_arrow(draw, (1265, 685), (1350, 725), f"#{RED}", 4)
    draw.text((1355, 850), "红色边界：联网前必须告知\n传输内容、供应商与用途", font=small, fill=f"#{RED}")
    image.save(path, quality=94)


def create_ui_wireframe(path: Path) -> None:
    image = Image.new("RGB", (1800, 1040), "#E9EEF1")
    draw = ImageDraw.Draw(image)
    regular, small, bold, title = load_fonts(32)
    draw.rounded_rectangle((55, 55, 1745, 985), radius=22, fill="#FFFFFF", outline=f"#{NAVY}", width=4)
    draw.rectangle((55, 55, 1745, 155), fill=f"#{NAVY}")
    draw.text((95, 83), "效率百宝箱", font=title, fill="#FFFFFF")
    draw.rounded_rectangle((560, 82, 1190, 135), radius=8, fill="#FFFFFF")
    draw.text((595, 93), "搜索功能、命令或最近任务", font=small, fill=f"#{MUTED}")
    draw.text((1580, 92), "任务中心", font=small, fill="#FFFFFF")

    draw.rectangle((55, 155, 360, 985), fill="#F5F7F8")
    nav_items = ["首页", "文档办公", "效率助手", "数据计算", "网络工具", "图片处理", "安全隐私", "定时关机"]
    for index, item in enumerate(nav_items):
        y = 190 + index * 78
        selected = index == 1
        if selected:
            draw.rounded_rectangle((82, y - 10, 334, y + 50), radius=8, fill="#DDECEF")
        draw.ellipse((102, y + 7, 122, y + 27), fill=f"#{TEAL if selected else MUTED}")
        draw.text((145, y), item, font=regular, fill=f"#{NAVY if selected else INK}")

    draw.text((415, 205), "文档办公", font=title, fill=f"#{NAVY}")
    draw.text((415, 265), "常用操作", font=small, fill=f"#{MUTED}")
    cards = [
        (415, 320, 770, 500, "PDF 合并", "拖入文件 · 调整顺序 · 导出"),
        (805, 320, 1160, 500, "Office 导出 PDF", "检测 LibreOffice 后开始转换"),
        (415, 535, 770, 715, "OCR 文字识别", "选择图片或 PDF 页面"),
        (805, 535, 1160, 715, "批量重命名", "预览冲突 · 确认后执行"),
    ]
    for left, top, right, bottom, heading, detail in cards:
        draw.rounded_rectangle((left, top, right, bottom), radius=12, fill="#FFFFFF", outline="#C7D1D8", width=3)
        draw.rounded_rectangle((left + 28, top + 28, left + 88, top + 88), radius=12, fill="#DDECEF")
        draw.text((left + 110, top + 32), heading, font=bold, fill=f"#{INK}")
        draw.text((left + 30, top + 116), detail, font=small, fill=f"#{MUTED}")

    draw.rounded_rectangle((1220, 190, 1690, 900), radius=12, fill="#F8FAFA", outline="#C7D1D8", width=3)
    draw.text((1260, 225), "任务中心", font=bold, fill=f"#{NAVY}")
    tasks = [
        ("合同合集.pdf", "合并中  72%", TEAL, 0.72),
        ("报销清单.xlsx", "等待转换", AMBER, 0.0),
        ("扫描件-03.png", "OCR 已完成", GREEN, 1.0),
    ]
    for index, (name, status, color, ratio) in enumerate(tasks):
        y = 310 + index * 165
        draw.text((1260, y), name, font=regular, fill=f"#{INK}")
        draw.text((1260, y + 50), status, font=small, fill=f"#{color}")
        draw.rounded_rectangle((1260, y + 95, 1645, y + 109), radius=7, fill="#DDE3E7")
        if ratio:
            draw.rounded_rectangle((1260, y + 95, int(1260 + 385 * ratio), y + 109), radius=7, fill=f"#{color}")

    draw.text((415, 805), "布局原则：全局入口固定，任务进度不阻塞工作区；破坏性操作先预览再确认。", font=regular, fill=f"#{INK}")
    draw.text((415, 860), "1080p / 2K 与 100% / 125% / 150% 缩放均保持可读；窄窗口收起任务中心。", font=small, fill=f"#{MUTED}")
    image.save(path, quality=94)


def create_performance_loop(path: Path) -> None:
    image = Image.new("RGB", (1800, 560), "#FFFFFF")
    draw = ImageDraw.Draw(image)
    regular, small, bold, title = load_fonts(32)
    draw.text((70, 40), "性能预算闭环", font=title, fill=f"#{NAVY}")
    steps = [
        ("1", "设定预算", "启动 / 内存 / 体积\n吞吐 / 峰值内存", NAVY),
        ("2", "同机测量", "Release 构建\n固定样本与计时边界", TEAL),
        ("3", "定位归因", "前端长任务\nIPC / I/O / 外部进程", AMBER),
        ("4", "最小优化", "懒加载 / 流式处理\n并发上限 / 资源释放", GREEN),
        ("5", "门禁留证", "基线对比\n超预算则阻断 RC", RED),
    ]
    box_w, box_h, gap = 285, 290, 55
    left = 70
    top = 155
    for index, (number, heading, detail, color) in enumerate(steps):
        x1 = left + index * (box_w + gap)
        x2 = x1 + box_w
        draw.rounded_rectangle((x1, top, x2, top + box_h), radius=18, fill="#F5F7F8", outline=f"#{color}", width=4)
        draw.ellipse((x1 + 28, top + 28, x1 + 88, top + 88), fill=f"#{color}")
        draw_centered(draw, (x1 + 28, top + 28, x1 + 88, top + 88), number, bold, "#FFFFFF")
        draw.text((x1 + 30, top + 120), heading, font=bold, fill=f"#{INK}")
        draw.multiline_text((x1 + 30, top + 180), detail, font=small, fill=f"#{MUTED}", spacing=8)
        if index < len(steps) - 1:
            draw_arrow(draw, (x2 + 9, top + box_h // 2), (x2 + gap - 12, top + box_h // 2), f"#{MUTED}", 4)
    image.save(path, quality=94)


def add_front_matter(doc: Document) -> None:
    heading = doc.add_paragraph("目录", style="Heading 1")
    heading.paragraph_format.page_break_before = True
    toc = doc.add_paragraph()
    add_field(toc.add_run(), 'TOC \\o "1-2" \\h \\z')
    page_break = doc.add_paragraph()
    page_break.add_run().add_break(WD_BREAK.PAGE)

    doc.add_heading("执行摘要", level=1)
    doc.add_paragraph(
        "本方案在 V1.2 评审稿基础上形成可立项、可实施、可验收的 V2.0 完整方案。"
        "产品定位保持为 Windows 优先、本地处理、轻量、无广告的桌面效率工具；V1.0 交付范围仍严格限定为 P0 与 P1，"
        "P2 仅作为 V1.1 及后续候选，不纳入 16 周承诺。"
    )
    add_callout(
        doc,
        "核心原则",
        "本地优先、云端显式授权；统一入口、两步可达；长任务可观察、可取消、可恢复；任何质量评分都不能抵消隐私、数据安全或发布门禁失败。",
        PALE_GREEN,
    )
    add_table(
        doc,
        ["维度", "V2.0 落地结论"],
        [
            ["功能范围", "七大模块构成当前路线；新增条形码生成、A4/A5/B4/B5 文档打印和定时关机基础版，16 周仅承诺 P0/P1，建立统一作业、文件安全与离线能力等通用需求；银行卡号信息查询明确排除。"],
            ["技术架构", "Tauri 2.x + Vue 3 + Pinia + Element Plus；敏感操作下沉 Rust；SQLite/Store 保存本地状态；模型插件按需安装。"],
            ["用户界面", "左侧模块导航、顶部全局搜索、中央任务工作区、可收起任务中心；桌面缩放与键盘操作纳入验收。"],
            ["集成策略", "通过适配层隔离 LibreOffice、本地模型、云端 AI、系统通知、更新服务和在线数据源，统一超时、取消、错误与审计。"],
            ["性能策略", "以启动、内存、安装包和大文件处理预算驱动实现；动态加载、流式 I/O、并发上限、外部进程生命周期和持续基线组成闭环。"],
            ["实施与评估", "四阶段 16 周；每阶段设置入口/出口条件；最终采用硬门禁 + 100 分评估矩阵，所有结论需附可复核证据。"],
        ],
        [3.0, 13.5],
    )
    doc.add_paragraph(
        "本方案是产品、设计、研发、测试与发布共同使用的基线文档。第 2 章定义做什么，第 3-4 章定义如何实现，"
        "第 5 章定义交付顺序，第 6 章定义如何验收；第 7-8 章分别约束风险与资源。"
    )


def add_functional_requirements(doc: Document) -> None:
    doc.add_heading("2.1 通用功能需求与工作流规范", level=2)
    doc.add_paragraph(
        "七大模块除各自功能外，必须共同遵循以下横向需求。它们属于 V1.0 完成定义，不得由模块自行省略。"
    )
    add_table(
        doc,
        ["编号", "需求", "实施规则", "验收要点"],
        [
            ["FR-G01", "统一发现", "全局搜索支持名称、别名、关键词与最近使用；首页提供固定常用入口。", "冻结清单中至少 90% 的 P0/P1 功能从首页或全局搜索不超过 2 个导航步骤。"],
            ["FR-G02", "统一作业状态", "耗时任务统一为等待、运行、成功、失败、已取消；显示进度、阶段和剩余项。", "任务状态可观察；可取消任务在 2 秒内进入取消中或已取消；重复事件不造成重复写入。"],
            ["FR-G03", "批量文件操作", "支持拖放、系统选择器、排序、移除、冲突策略和输出目录；执行前展示汇总。", "空输入、重复文件、同名输出、只读目录、空间不足和部分失败均有明确结果。"],
            ["FR-G04", "非破坏性默认值", "默认另存为并生成可预览结果；覆盖、删除或清理必须二次确认并提供恢复路径。", "未确认时不得改写源文件；失败后源文件保持可读，临时文件可识别并清理。"],
            ["FR-G05", "本地历史与设置", "只保存任务元数据、用户偏好和必要路径引用；密码、密钥、原文敏感内容不得持久化。", "关闭重启后普通设置可恢复；清除历史后数据库与界面一致；敏感字段搜索结果为空。"],
            ["FR-G06", "离线与联网告知", "功能入口标记离线、需联网或需插件；向第三方发送内容前说明供应商、数据、用途和取消方式。", "断网状态行为可预测；未授权时无内容请求；授权撤回后立即停止后续上传。"],
            ["FR-G07", "错误恢复", "错误消息包含发生事项、可能原因、影响范围和可执行恢复动作；支持安全重试。", "错误码稳定；超时、取消与失败可区分；重试不重复覆盖成功输出。"],
            ["FR-G08", "可访问与键盘", "核心操作可用键盘完成；焦点顺序、标签、对比度、缩放和减少动态效果符合设计规范。", "200% 文本缩放无关键内容遮挡；图标按钮有可访问名称；焦点可见且不陷入弹窗。"],
            ["FR-G09", "依赖检测", "启动后异步检测 WebView2、LibreOffice、模型插件和网络状态，不阻塞主窗口。", "缺失依赖提供版本、影响功能和修复入口；无依赖时其他模块正常可用。"],
            ["FR-G10", "隐私诊断", "默认仅本地滚动日志；诊断包先预览再导出，崩溃上报必须单独授权并匿名化。", "诊断包不含文档正文、口令、密钥和完整文件路径；关闭授权后不再上报。"],
        ],
        [1.5, 2.4, 6.4, 6.2],
    )

    doc.add_heading("2.2 图片处理增强需求", level=2)
    doc.add_paragraph(
        "图片增强能力作为图片处理模块的独立交付范围，优先保证本地可用、可取消、可复核和不覆盖原图；"
        "云端视觉模型不作为默认依赖，只有完成供应商能力探测和逐次授权后才允许扩展。"
    )
    add_table(
        doc,
        ["编号", "能力", "实现要求", "验收标准"],
        [
            ["FR-IMG-01", "AI 图片增强与抠图", "使用 Canvas Local Vision 本地算法完成亮度/对比度/饱和度增强；从边缘估计背景并支持透明、白、蓝、红底输出；限制长边和像素总量，显示阶段与进度。", "JPG/PNG/WebP 可处理；结果尺寸和格式正确；取消后无残留结果；原图哈希不变；界面明确说明未加载第三方深度模型。"],
            ["FR-IMG-02", "证件照裁剪与规格参考", "按常用小一寸、一寸、大一寸、二寸、护照/签证规格进行 Cover 裁剪；允许主体水平/垂直焦点与背景色选择；支持 64-4000 px 自定义规格；右侧展示毫米、像素、用途、背景色、来源和更新时间。", "输出像素精确匹配所选规格；非法自定义值被阻止；规格参考和“以机构最新要求为准”提示始终可见；复杂背景标记需人工复核。"],
            ["FR-IMG-03", "图片文字直接编辑", "在不覆盖源文件的画布副本上提供选区、透明/纯色消除、框选替换文字、添加文字、内部复制/粘贴、撤销/重做和 PNG 导出；大图按 2400 px 长边建立编辑副本。", "鼠标或触摸可完成选择与编辑；复制区域可在画布内粘贴；撤销/重做状态准确；导出结果可打开且源文件未修改。"],
            ["FR-IMG-04", "OCR 衔接与隐私", "文字编辑页可调用既有本地 Tesseract.js 提取文字；首次模型下载单独请求联网授权，识别图片不发送到供应商；失败、取消和无文字均有可执行提示。", "授权拒绝或离线时不发起请求；识别结果可复制并用于后续编辑；日志和任务历史不含图片正文或 API Key。"],
            ["FR-IMG-05", "性能与资源边界", "预览使用对象 URL 并在切换/卸载时释放；像素循环响应取消令牌；编辑历史最多保留 18 步；结果全部另存。", "固定样本下无页面冻结或无限增长；连续切换工具无对象 URL 泄漏；超过尺寸上限时给出恢复建议。"],
        ],
        [1.5, 2.6, 7.0, 5.4],
    )

    doc.add_heading("2.3 条形码与文档打印需求", level=2)
    doc.add_paragraph(
        "本次新增能力坚持本地优先：条形码在浏览器 Canvas/SVG 中生成，文档打印由工作区预览与系统打印对话框承接；"
        "纸张尺寸、范围和显示设置均采用显式枚举，用户选择后才写入本机设置。银行卡号信息查询不在本次范围内，不新增 BIN 数据、银行卡接口或银行卡号采集。"
    )
    add_table(
        doc,
        ["编号", "能力", "实现要求", "验收标准"],
        [
            ["FR-BAR-01", "条形码格式与校验", "支持 Code 128 与 EAN-13；EAN-13 接受 12 位自动计算校验位或 13 位校验，Code 128 限制为可打印 ASCII。", "空值、越界字符和错误校验位被拒绝；合法输入可稳定生成，不发起网络请求。"],
            ["FR-BAR-02", "本地输出", "提供 PNG 与 SVG 下载，允许调整条宽、条高、留白、前景色、背景色和底部编码文字；限制输出参数范围。", "预览尺寸与参数一致；下载文件可打开；对象 URL 在清空或卸载时释放。"],
            ["FR-PRINT-01", "纸张与方向", "文档打印工作区提供 A4（210×297 mm）、A5（148×210 mm）、B4（JIS，257×364 mm）、B5（JIS，182×257 mm），支持自动、纵向和横向。", "四种纸张显示准确毫米值；@page CSS 与选择一致；方向切换不造成布局溢出。"],
            ["FR-PRINT-02", "打印参数", "按参考系统对话框提供打印机、份数、颜色、当前/全部/自定义页码、奇偶页、逆序、一张多页/小册子、缩放、双面、页码、水印、页眉、裁剪标记和分割页面等选项。", "非法份数、比例和页码范围被归一化或提示；范围、奇偶和逆序计算结果可复核；浏览器模式不执行系统电源等无关动作。"],
            ["FR-PRINT-03", "预览与输出", "支持 PDF、图片和文本预览；PDF 使用页码导航，非 PDF 使用安全 HTML 打印副本；默认另存预览，不覆盖源文件。", "文件类型、损坏文件和空输入有明确提示；打印提交后显示纸张和页数摘要；取消或失败不改变源文件。"],
            ["FR-PRINT-04", "设置持久化", "以版本化 `print-settings` 键保存用户修改后的纸张、方向和打印参数；组件初始化只读取，不把默认值回写。", "用户选择 B4/B5 后刷新仍保持；挂载期间写入次数为 0；恢复默认仅由用户动作触发写入。"],
        ],
        [1.5, 2.6, 7.0, 5.4],
    )
    add_callout(
        doc,
        "范围排除",
        "银行卡号信息查询不实施，不采集或存储银行卡号，不接入 BIN 数据库、银行接口或第三方银行卡识别服务；网络工具仅交付二维码、条形码和既有网络诊断能力。",
        "FFF5E5",
    )

    doc.add_heading("2.4 模块完成定义", level=2)
    add_numbered(
        doc,
        [
            "范围冻结：P0/P1 表中以顿号或斜线分隔、能够独立产生用户结果的能力均作为独立验收项；产品负责人在第 1 周形成唯一清单并赋予需求编号。",
            "完整路径：每项能力必须覆盖入口、输入校验、处理中、取消、成功、失败、再次执行和结果定位，不以静态页面或占位入口计为完成。",
            "边界说明：依赖联网、LibreOffice 或模型插件的能力在入口处显示条件；依赖缺失不应导致应用整体不可用。",
            "证据闭环：每项需求至少关联一个自动化测试或人工检查用例，并在发布检查单中留下构建版本、样本、结果和负责人。",
            "范围纪律：P2 不进入 V1.0 发布门禁；如阶段一技术门禁不通过，只能调整未开始的 P1 范围或排期，不得降低已冻结的质量指标。",
        ],
    )


def add_architecture_and_ui(doc: Document, ui_image: Path, architecture_image: Path, performance_image: Path) -> None:
    doc.add_heading("4.3 用户界面设计", level=2)
    doc.add_paragraph(
        "界面面向高频、重复办公操作，采用安静、紧凑、可扫描的桌面工具布局。品牌表达服务于识别，不使用广告位、信息流、"
        "大面积装饰或与任务无关的推荐内容。"
    )
    doc.add_picture(str(ui_image), width=Inches(6.9))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_caption(doc, "图 1  桌面端主工作区线框：固定导航 + 全局搜索 + 任务工作区 + 可收起任务中心")

    doc.add_heading("4.3.1 信息架构与窗口布局", level=3)
    add_table(
        doc,
        ["区域", "内容与行为", "尺寸与适配规则"],
        [
            ["标题栏", "应用标识、全局搜索、任务中心入口、设置与窗口控制；保留 Tauri 拖拽区域。", "高度约 52-60 px；交互控件不得落入拖拽区；窄窗口保留搜索快捷入口。"],
            ["模块导航", "首页与 7 大模块；显示当前模块，支持键盘上下移动和折叠。", "展开宽度约 216 px，窄窗口收为图标栏；图标按钮必须带可访问名称。"],
            ["主工作区", "工具输入、参数、预览、执行与结果；单页只保留一个主要动作。", "内容宽度随窗口伸缩；表单标签左对齐；固定格式预览使用明确宽高与滚动边界。"],
            ["任务中心", "显示长任务状态、进度、取消、重试和输出位置；不阻塞其他工具。", "默认约 320 px，可收起；窗口宽度不足时转为抽屉；状态变化使用 aria-live 等价机制通知。"],
            ["消息与确认", "普通反馈就地展示；破坏性操作与云端传输使用模态确认。", "错误保持可复制；确认框默认焦点在安全动作；Esc 仅关闭可安全取消的对话框。"],
        ],
        [2.4, 8.2, 6.2],
    )

    doc.add_heading("4.3.2 工具页统一模板", level=3)
    add_bullets(
        doc,
        [
            "页头：功能名称、离线/联网/插件状态与不超过一行的能力边界，不展示营销式说明。",
            "输入区：文件拖放区或结构化表单；选择后立即校验类型、大小、权限、重复项和依赖状态。",
            "参数区：仅展示高频参数，高级参数折叠；默认值必须可逆、保守且不会覆盖原文件。",
            "预览区：批量重命名、脱敏、加水印、拼接等高风险操作必须显示变更前后对照或摘要。",
            "动作区：一个明确的主按钮；运行后原位显示进度与取消，禁止通过页面跳转隐藏任务状态。",
            "结果区：成功项、失败项、警告和输出位置分组呈现；支持打开目录、再次执行和导出错误清单。",
        ],
    )

    doc.add_heading("4.3.3 视觉与交互规范", level=3)
    add_table(
        doc,
        ["主题", "规范"],
        [
            ["字体层级", "优先系统中文字体（Microsoft YaHei / Segoe UI）；正文 14-16 px，辅助文字不低于 12 px；标题层级不超过三级。"],
            ["颜色", "中性浅色工作区配合深蓝主色、青绿交互色；成功/警告/失败同时使用图标和文字，不只依赖颜色。"],
            ["间距与密度", "采用 4/8 px 基准；卡片圆角不超过 8 px；重复工具入口紧凑排列，不使用嵌套卡片。"],
            ["控件", "图标按钮使用 Lucide/Tabler 并提供提示；模式用分段控件，二元设置用开关/复选框，数值用输入框或滑块。"],
            ["动效", "只使用 transform 与 opacity 的短动效；支持减少动态效果；进度动画不得造成布局抖动。"],
            ["响应式", "最低可用窗口 1024×640；覆盖 1080p/2K 与 100%/125%/150% 缩放；窄窗口按导航、任务中心、次要参数顺序收起。"],
            ["可访问性", "核心路径键盘可达；焦点可见；表单标签与错误关联；触摸目标约 44 px；对比度按 WCAG 2.2 AA 目标检查。"],
        ],
        [3.0, 13.8],
    )

    doc.add_heading("4.3.4 关键页面与状态", level=3)
    add_table(
        doc,
        ["页面", "默认状态", "关键异常状态", "主要验收"],
        [
            ["首页/全局搜索", "最近使用、收藏与 7 模块入口。", "无结果、依赖缺失、功能暂不可用。", "P0/P1 两步可达；键盘搜索、上下选择、Enter 打开。"],
            ["批量文件工具", "拖放区、文件清单、输出与冲突策略。", "格式不支持、同名冲突、磁盘不足、部分失败。", "顺序可调；执行前预览；失败不破坏源文件。"],
            ["计算工具", "输入、单位/规则版本、即时结果。", "空值、越界、精度不足、在线数据过期。", "公式与舍入规则可追溯；在线结果显示时间戳。"],
            ["网络工具", "二维码/条形码工作区，以及目标、端口、超时和开始动作。", "格式校验、DNS/权限/超时/IPv6 差异。", "条形码本地生成；网络诊断只检测用户指定目标，可取消且结果含耗时和提示；不提供银行卡号查询。"],
            ["文档打印", "纸张、方向、范围、缩放、双面和辅助选项；右侧固定比例预览。", "空文件、损坏 PDF、页码越界、系统打印不可用。", "A4/A5/B4/B5 毫米值与 @page 一致；B4/B5 选择刷新后保持；初始挂载不写设置。"],
            ["设置与插件", "隐私、更新、依赖和插件状态。", "下载中断、哈希失败、版本不兼容。", "模型独立安装/卸载；云端授权可撤回；更新签名不可关闭。"],
        ],
        [2.6, 4.6, 4.8, 5.0],
    )

    doc.add_heading("4.3.5 图片增强工作区设计", level=3)
    doc.add_paragraph(
        "图片处理增强沿用统一工具页模板，但针对预览和参数密度做专门布局：左侧保持输入/结果可见，右侧集中参数与规格信息，"
        "避免在编辑过程中频繁切换页面。所有状态均在当前工作区原位更新。"
    )
    add_table(
        doc,
        ["工作区", "界面组成", "关键交互与响应式规则"],
        [
            ["AI 图片能力", "原图预览、智能增强/AI 抠图分段控件、强度或背景阈值、透明/白/蓝/红底选择、本地引擎状态、结果预览与下载。", "运行按钮在未选图时禁用；显示 Canvas Local Vision 和不上传说明；窄窗口改为上下布局，结果区保持固定预览比例。"],
            ["证件照裁剪", "原图预览、规格选择、自定义像素、毫米/像素/用途数据卡、背景色、主体水平/垂直焦点、规格来源与更新时间。", "规格变更即时更新可用背景色；非法像素即时提示；规格说明在 640 px 窄视口仍可滚动查看，不遮挡主按钮。"],
            ["图片文字编辑", "文件入口、选择/消除/替换/添加文字/粘贴工具栏、撤销/重做、画布、编辑参数、状态播报、OCR 结果与导出。", "画布使用稳定宽高和触摸指针事件；工具按钮提供 aria-label；未载入图片时显示空态；复制/粘贴仅在内部画布副本执行。"],
        ],
        [2.8, 7.2, 6.4],
    )

    doc.add_heading("4.4 集成能力与接口规范", level=2)
    doc.add_picture(str(architecture_image), width=Inches(6.9))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_caption(doc, "图 2  本地优先分层架构：系统、外部运行时与云服务均通过明确边界接入")

    doc.add_heading("4.4.1 统一作业契约", level=3)
    doc.add_paragraph(
        "所有长耗时或敏感操作使用统一作业协议，前端不直接拼接命令行或访问任意文件。Tauri 命令按能力白名单暴露，"
        "请求进入 Rust 后完成路径规范化、类型/大小校验、权限检查和并发控制。"
    )
    add_code_block(
        doc,
        [
            "请求  ToolJobRequest  { requestId, operation, inputs[], options, deadlineMs }",
            "事件  ToolJobProgress { requestId, phase, completed, total, messageKey }",
            "结果  ToolJobResult   { requestId, status, outputs[], warnings[], metrics }",
            "错误  ToolJobError    { requestId, code, messageKey, retryable, detailsSafe }",
            "控制  cancel(requestId) / retry(requestId)；同一 requestId 必须幂等",
        ],
    )
    add_table(
        doc,
        ["契约规则", "要求"],
        [
            ["输入", "只接受结构化参数；路径转为规范绝对路径后验证允许范围；禁止把用户字符串直接拼入 shell。"],
            ["进度", "按稳定阶段标识上报，不高频发送逐字节事件；前端对事件节流，避免渲染放大。"],
            ["取消", "取消令牌贯穿队列、文件循环、网络请求和外部进程；不可安全中断的原子阶段必须明确标识。"],
            ["结果", "输出采用临时文件 + 校验 + 原子重命名；批处理允许部分成功，并返回逐项状态。"],
            ["错误", "错误码稳定、可本地化、可判断是否重试；detailsSafe 不得包含口令、密钥、正文或未经处理的完整路径。"],
            ["审计", "仅记录操作类型、持续时间、结果码、输入数量和脱敏后的性能指标；默认不记录内容。"],
        ],
        [3.0, 13.8],
    )

    doc.add_heading("4.4.2 集成矩阵", level=3)
    add_table(
        doc,
        ["集成对象", "接入方式", "故障隔离与降级", "安全/性能要求"],
        [
            ["LibreOffice", "Rust 适配器调用锁定版本 CLI；每个任务使用独立临时目录。", "未安装或版本不支持时禁用转换入口但不影响其他功能；超时终止子进程并保留诊断。", "参数数组传递、禁止 shell 拼接；按需启动，完成后回收；限制并发。"],
            ["Canvas Local Vision / 图片编辑", "浏览器 Canvas 本地启发式算法承载图片增强、边缘连通背景移除/替换、证件照裁剪和画布文字编辑；大图按边长与像素上限缩放。", "Canvas 不可用时安全降级并提示；复杂背景只标记为需人工复核，不伪装成深度模型结果。", "原图只读；结果另存；像素循环支持取消与阶段进度；不下载或执行未知模型代码。"],
            ["JsBarcode", "按需动态加载，用于 Code 128/EAN-13 的 Canvas 与 SVG 生成。", "库缺失或编码失败时显示可理解错误；网络不可用不影响已加载应用。", "格式、校验位、颜色和尺寸参数先在本地归一化；不发送条码内容；导出 Blob 后释放预览 URL。"],
            ["浏览器/Windows 系统打印", "工作区生成 @page 纸张 CSS；PDF 交给预览帧，图片/文本生成隐藏 HTML 打印帧并调用系统打印。", "打印对话框拒绝或浏览器不支持时保留预览并提供导出 HTML；Office 文件先提示导出 PDF。", "四种纸张和方向映射稳定；页码范围在提交前校验；打印参数不拼接命令，源文件不覆盖。"],
            ["print-settings 本地设置", "通过存储白名单的版本化 `print-settings` 键读写纸张、方向、范围和显示选项。", "存储不可用或数据损坏时回退 A4 默认；不影响当前会话预览。", "初始化只读；用户修改后规范化保存；刷新可恢复选择，未知字段不进入持久化值。"],
            ["本地 OCR 与可选云端视觉", "Tesseract.js 按需加载中文/英文模型；未来云端视觉通过显式 Provider 适配器接入。", "模型下载失败或供应商不可用时保留本地编辑；不自动切换供应商发送同一内容。", "OCR 首次下载和云端请求分别授权；日志隐藏图片正文与凭据；远程视觉能力默认关闭。"],
            ["汇率/IP/测速服务", "独立在线数据适配器，响应映射到稳定内部模型。", "缓存最近有效结果并显示时间戳；过期结果不可冒充实时值。", "连接/读取超时；证书校验；限制重试次数；取消传播。"],
            ["SQLite / tauri-plugin-store", "仓储层封装待办、历史、偏好和任务索引；迁移带版本号。", "事务失败回滚；启动迁移失败进入只读恢复提示。", "WAL 按实测决定；索引覆盖检索；敏感值不落库。"],
            ["Tauri Updater / Releases", "稳定、灰度、测试三个通道；清单和包均校验签名。", "下载或安装失败保留当前版本；提供明确重试和回滚包。", "签名验证不可关闭；私钥仅在受控 CI；限制更新包重定向来源。"],
            ["Windows 系统能力", "文件选择器、通知、剪贴板、截图和凭据库通过 Tauri 插件或最小平台封装。", "权限拒绝返回明确状态；功能级降级，不导致主进程退出。", "权限最小化；按需申请；多屏和缩放分别验证。"],
            ["Windows 电源动作", "Rust 侧固定映射 shutdown / restart / hibernate；前端只能提交动作枚举、触发时间和 requestId。", "浏览器模式仅预览；非 Windows 或系统拒绝时返回可理解错误；单个活动任务避免重复执行。", "不拼接 shell；默认保留 30 秒保存缓冲；取消令牌贯穿等待与执行切换。"],
        ],
        [2.6, 4.4, 5.0, 5.0],
    )

    doc.add_heading("4.4.2.1 定时关机基础版集成边界", level=4)
    doc.add_paragraph(
        "定时关机作为 Windows 桌面能力接入，不把系统命令暴露给前端。一次只保留一个活动任务，"
        "调度线程以不阻塞界面的短周期等待检查触发时间，状态按 scheduled、executing、executed、canceled、failed 流转。"
    )
    add_table(
        doc,
        ["接口", "输入与校验", "结果与取消"],
        [
            ["power_capabilities", "返回平台、是否支持调度、固定动作清单和 30 秒安全缓冲。", "浏览器或非 Windows 显示预览；不启动系统动作。"],
            ["schedule_power_action", "action 仅允许 shutdown/restart/hibernate；executeAtMs 必须晚于当前时间 30 秒且不超过 31 天；requestId 只允许受限字符。", "创建 scheduled 状态；线程进入触发点后原子切换 executing；重复活动任务拒绝创建。"],
            ["cancel_power_schedule", "按 requestId 校验当前任务；仅 scheduled 状态允许取消。", "设置取消令牌并返回 canceled；executing 后不再接受取消，避免动作竞态。"],
        ],
        [3.4, 7.0, 6.0],
    )
    add_bullets(
        doc,
        [
            "关机/重启使用 Windows 固定参数并保留 30 秒系统保存窗口；休眠在执行前等待同等缓冲后调用 /h。",
            "前端创建前显示动作、计划时间和安全缓冲确认；触发前提供取消，浏览器开发模式明确不执行真实电源动作。",
            "调度器不持久化任务，不支持周期、空闲、进程退出、负载阈值、托盘、自启、自定义脚本或强制关闭程序；这些能力不属于本次基础版验收。",
        ],
    )

    doc.add_heading("4.4.3 数据流与隐私分级", level=3)
    add_table(
        doc,
        ["数据等级", "示例", "允许处理位置", "控制要求"],
        [
            ["L1 普通元数据", "工具名称、耗时、成功/失败、输入数量。", "本地；经授权可匿名汇总。", "去标识化、可关闭、保留期明确。"],
            ["L2 普通内容", "非敏感图片、公开文档文本。", "默认本地；用户明确选择后可发送指定云服务。", "发送前展示供应商、内容范围与用途；传输加密。"],
            ["L3 敏感内容", "合同、票据、身份证件、财务数据。", "仅本地模型和本地服务。", "云端入口默认禁用；不写日志；临时文件受控并按策略清理。"],
            ["L4 密钥与口令", "API Key、加密口令、私钥。", "系统凭据库或仅内存。", "永不写数据库、日志、崩溃包或剪贴板历史；内存生命周期最短化。"],
        ],
        [2.4, 4.6, 4.8, 5.2],
    )

    doc.add_heading("4.5 数据模型与本地状态", level=2)
    add_table(
        doc,
        ["实体", "核心字段", "保留与约束"],
        [
            ["tool_definition", "id、module、name、aliases、priority、capabilities、dependency_flags", "随版本发布，只读；驱动导航、搜索和离线统计。"],
            ["job", "request_id、operation、status、created_at、finished_at、input_count、output_refs、error_code", "只存任务元数据；输出引用可失效；按用户设置清理。"],
            ["user_setting", "key、typed_value、updated_at", "白名单键；跨版本迁移；不保存密钥与口令。"],
            ["todo/note/reminder", "本地业务字段、排序、状态、提醒时间", "SQLite 事务；本机通知；V1.0 不做云同步。"],
            ["plugin_manifest", "id、version、platform、size、license、sha256、state", "下载前后校验；卸载时保留用户确认；禁止任意脚本入口。"],
            ["consent", "scope、provider、granted_at、revoked_at、policy_version", "按用途分级；可撤回；授权记录不包含传输内容。"],
            ["power_schedule（内存）", "request_id、action、execute_at_ms、status、cancel_token", "仅保留当前一次性任务；应用退出或任务终态后不恢复，不写入密钥或任意命令。"],
            ["print_settings", "paper_size、orientation、copies、page_range、scale、duplex、display_options", "仅保存用户打印偏好；schema 版本化；初始化只读，修改后规范化写入；不保存文档内容。"],
        ],
        [3.0, 8.2, 5.8],
    )

    doc.add_heading("4.6 性能优化策略实施方案", level=2)
    doc.add_picture(str(performance_image), width=Inches(6.9))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_caption(doc, "图 3  性能预算闭环：同一参考设备与固定样本上测量、归因、优化并形成发布证据")
    add_table(
        doc,
        ["优化面", "实施策略", "测量指标", "实施阶段/门禁"],
        [
            ["冷启动", "首屏只加载应用壳、导航索引和必要设置；模块页面动态导入；依赖/模型扫描延后；数据库迁移设超时并可进入恢复模式。", "进程创建至主窗口可交互 P50/P95；20 次重启；记录各阶段耗时。", "阶段一建基线；每个 RC 的 P95 ≤ 1.5 秒。"],
            ["空闲内存", "Pinia 只保留界面状态；任务结果分页；图片/PDF 预览释放对象 URL；模型和外部进程按需加载并退出；限制缓存条目。", "空闲 10 分钟每分钟采样；区分主进程、WebView 与外部进程。", "阶段一建基线；RC 主应用 P95 ≤ 80 MB。"],
            ["安装包", "只选 Element Plus 一个组件库并按需导入；Rust release 开启 LTO、strip 与 panic=abort（以兼容性验证为前提）；模型、LibreOffice、固定 WebView2 均外置。", "CI 记录基础包字节数、符号与依赖清单；披露完整依赖体积。", "每次 RC ≤ 30 MB；增长超过 5% 需说明来源。"],
            ["文件 I/O", "大文件使用流式读取、固定块大小和临时文件；输出完成校验后原子重命名；避免将二进制通过 JSON/IPC 整体传输。", "吞吐、峰值内存、磁盘临时空间与取消延迟。", "阶段一覆盖 PDF/图片；阶段二三扩展转换、压缩、OCR。"],
            ["CPU 与并发", "独立 CPU/I/O 队列；默认重任务并发不超过 max(1, 逻辑核数-1) 且设置上限；网络任务使用独立较高上限；前端事件节流。", "CPU 占用、队列等待、交互线程长任务、完成时间。", "阶段一调度器完成；RC 压力样本无界面冻结。"],
            ["图片与 OCR", "大图按 2400px 长边和像素上限缩放；AI 像素循环、证件照输出和文字编辑快照均分阶段执行；预览与对象 URL 及时释放；OCR 批次控制并可释放模型。", "峰值内存、每张耗时、模型加载时间、编辑撤销深度、失败恢复。", "阶段三按固定图片样本门禁；本地算法与 OCR 引擎分别披露，不把未加载模型计为可用能力。"],
            ["条形码与打印", "JsBarcode 按需加载；条码参数先归一化；打印预览固定比例并限制资源；打印设置只在用户修改后持久化。", "条码生成耗时、预览布局偏移、打印页码解析、设置写入次数。", "固定 Code 128/EAN-13 样本与四种纸张尺寸通过；首次挂载写入次数为 0；窄视口无横向溢出。"],
            ["前端渲染", "列表虚拟化阈值由实测设定；搜索索引预计算；进度事件 100-250 ms 合并刷新；图表与预览固定尺寸，避免布局抖动。", "交互延迟、长任务数量、布局偏移、帧率。", "阶段二起纳入关键页面性能检查。"],
            ["SQLite", "事务批量写入；为状态/时间/工具标识建立必要索引；历史分页；定期检查数据库大小，不在启动关键路径执行重维护。", "查询 P95、写入耗时、数据库体积、迁移时间。", "阶段二完成基线；RC 不允许未解释的慢查询回归。"],
            ["外部进程与网络", "LibreOffice 按需启动、限制并发、超时回收；HTTP 设置连接/读取超时、取消和有限退避；大下载断点续传。", "进程残留数、超时率、重试次数、下载恢复成功率。", "阶段二三完成；残留进程或无限重试阻断发布。"],
        ],
        [2.5, 7.1, 4.4, 3.8],
    )
    add_callout(
        doc,
        "性能实施纪律",
        "所有优化必须先有基线与可复现样本。不得以降低输出质量、跳过签名校验、关闭安全检查或隐藏外部依赖体积换取达标；未达到门禁时延期或调整未开始范围。",
        "FFF5E5",
    )


def add_implementation_details(doc: Document) -> None:
    doc.add_heading("5.5 工作包、交付物与阶段出口", level=2)
    add_table(
        doc,
        ["阶段", "关键工作包", "必须交付的证据", "主要责任"],
        [
            ["阶段一 MVP", "Tauri/Vue 脚手架、设计令牌、全局搜索、统一作业、设置/日志；P0；三项技术验证。", "P0 验收清单；启动/内存/体积基线；LibreOffice、更新签名、age 格式验证记录。", "技术负责人、Rust/Tauri 负责人、Vue 负责人、测试负责人"],
            ["阶段二 Beta 1", "Office 导出、压缩/解压、模板；A4/A5/B4/B5 文档打印；条形码生成；待办/番茄钟/便签/提醒；规则型计算；定时关机基础版。", "正常/边界/取消测试；锁定 LibreOffice 版本与 200 份样本报告；条码固定样本、四种纸张和持久化检查；规则版本与日期；电源动作 IPC 与竞态单测。", "模块负责人、产品负责人、测试负责人"],
            ["阶段三 Beta 2", "OCR 与插件管理；图片 AI 增强/抠图、证件照规格裁剪、画布文字编辑；网络；截图/水印/拼接；加密/解密/脱敏。", "图片固定样本（增强、均匀/复杂背景、证件照规格、文字编辑）及 OCR 独立测试集；取消、恢复、超时、多屏缩放与隐私检查证据。", "模块负责人、安全责任人、测试负责人"],
            ["阶段四 RC/V1.0", "只做集成、兼容性、性能、可访问性、签名、灰度与发布缺陷。", "第 6 章完整评估包；许可证清单；隐私政策；签名安装包与哈希；灰度结论。", "技术负责人、产品负责人、测试负责人、发布负责人"],
        ],
        [2.4, 6.2, 5.8, 3.6],
    )

    doc.add_heading("5.6 工程目录与模块边界建议", level=2)
    add_code_block(
        doc,
        [
            "apps/desktop/              Vue 3 表现层、Pinia、路由、设计令牌",
            "src-tauri/src/commands/    Tauri IPC 白名单与参数校验",
            "src-tauri/src/jobs/        作业队列、进度、取消、并发与错误模型",
            "src-tauri/src/services/    document / image / ocr / crypto / network",
            "src-tauri/src/adapters/    libreoffice / providers / updater / platform",
            "src-tauri/src/storage/     SQLite 仓储、迁移、设置与本地历史",
            "packages/contracts/        前后端共享契约生成源与错误码说明",
            "tests/fixtures/            冻结的转换、OCR、图片和异常样本清单",
            "docs/                      架构决策、隐私、许可证、运行手册与交接",
        ],
    )
    doc.add_paragraph(
        "边界要求：commands 只负责鉴权、校验与编排；services 不依赖 UI；adapters 封装外部进程和供应商；storage 不保存敏感正文；"
        "任何模块不得绕过统一作业层直接启动长任务。"
    )

    doc.add_heading("5.5.1 定时关机基础版实施步骤", level=3)
    add_manual_numbered(
        doc,
        [
            "界面与参数：在主导航增加定时关机入口，提供倒计时/定点时间分段选择、关机/重启/休眠动作选择、剩余时间和执行状态；输入只接受合法整数和本地时间。",
            "桌面桥接：在 Tauri 白名单注册 power_capabilities、power_schedule_status、schedule_power_action、cancel_power_schedule 四个命令；Rust 侧再次校验动作、requestId、时间窗口和运行平台。",
            "调度与安全：以独立线程等待触发时间，使用取消令牌和锁内状态转换避免旧任务覆盖新任务；关机/重启保留 30 秒系统保存窗口，默认不带强制参数。",
            "验收与交付：先执行 JavaScript 参数单测和 Rust 单测/格式检查，再构建前端与桌面壳；浏览器只验收预览和布局，不触发真实电源动作；真实关机仅在隔离设备上由人工确认。",
        ],
    )
    doc.add_heading("5.5.2 图片处理增强实施步骤", level=3)
    add_manual_numbered(
        doc,
        [
            "能力契约与边界：冻结 FR-IMG-01~05，统一输入类型、长边/像素上限、取消令牌、阶段进度、结果副本和错误提示；在界面标明本地处理与未加载第三方深度模型。",
            "本地 AI 管线：实现 Canvas Local Vision 的增强和边缘连通背景移除/替换；对透明 PNG、白/蓝/红底 JPG 分别验证；复杂背景只提供人工复核提示，不宣称通用语义分割精度。",
            "证件照规格与裁剪：维护版本化规格数据（毫米、像素、用途、背景色、来源、更新时间），实现 Cover 裁剪、焦点调整和 64-4000 px 自定义校验；输出像素必须与选择一致。",
            "文字编辑画布：建立不覆盖源文件的编辑副本，接入选区、透明/纯色消除、文字替换/添加、内部复制粘贴、撤销/重做和 PNG 导出；大图按 2400 px 长边缩放并限制历史快照。",
            "隐私与验收：OCR 仅在用户授权后按需下载模型，识别图片不上传；执行固定图片样本、取消/重试、对象 URL 释放、窄视口和控制台检查，保留原图哈希与输出尺寸证据。",
        ],
    )
    doc.add_heading("5.5.3 条形码与文档打印实施步骤", level=3)
    add_manual_numbered(
        doc,
        [
            "条形码服务：引入 JsBarcode 按需加载，统一 Code 128/EAN-13 输入校验、EAN-13 校验位计算和参数边界；编码失败只返回稳定的用户提示。",
            "条形码工作区：提供格式、内容、条宽/条高/留白、颜色和底部编码文字设置；生成后展示本地预览，并分别导出 PNG 与 SVG；清空或卸载时释放对象 URL。",
            "打印工作区：实现 PDF、图片和文本选择及安全预览，提供 A4、A5、B4（JIS）、B5（JIS）纸张枚举、自动/纵向/横向方向和参考系统对话框的范围、缩放、双面与辅助选项。",
            "打印提交：浏览器模式使用 @page CSS 与隐藏打印帧回退，桌面模式交给系统打印对话框；提交前解析页码、奇偶和逆序，显示纸张与页数摘要，Office 文件提示先导出 PDF。",
            "偏好与验收：以版本化 `print-settings` 键保存用户修改后的设置；组件挂载只读取不回写。执行四种纸张、横纵向、页码范围、损坏输入、刷新恢复和 640 px 窄视口检查，保留写入次数与控制台证据。",
        ],
    )
    doc.add_heading("5.7 发布、回滚与运行恢复", level=2)
    add_numbered(
        doc,
        [
            "候选构建：CI 生成 Windows x64 Release 安装包、SBOM/许可证清单、SHA-256 和签名更新清单；私钥只存在受控 CI 密钥环境。",
            "灰度发布：先进入测试通道，再进入小比例灰度；收集用户授权的匿名稳定性指标和人工反馈，不自动上传文档内容。",
            "正式发布：硬门禁与综合评分均通过后推广到稳定通道；发布页同时披露基础包、外部运行时、模型插件和支持版本。",
            "回滚：保留上一个已验证安装包和清单；发现阻断问题时停止当前通道、恢复上一版本，不回滚用户数据库结构，必要时使用向前兼容迁移。",
            "运行恢复：任务中断后将未完成作业标为 interrupted；只对可幂等且输出未提交的作业提供恢复，其他作业要求用户确认后重启。",
        ],
    )


def add_evaluation_details(doc: Document) -> None:
    doc.add_heading("6.1 验收流程与硬门禁", level=2)
    doc.add_paragraph(
        "验收采用“先硬门禁、后综合评分”。任一硬门禁失败时不得以其他维度高分抵消，也不得把样本不足表述为达标。"
    )
    add_table(
        doc,
        ["硬门禁", "通过条件", "失败处理"],
        [
            ["范围与功能", "冻结的全部 P0/P1 功能具备完整路径；条形码与 A4/A5/B4/B5 打印验收项通过；银行卡号信息查询未混入范围；P0 清单无阻断缺陷；P2 未混入 V1.0 承诺。", "修复阻断项或正式调整未开始范围与排期，重新形成版本基线。"],
            ["数据与隐私", "默认本地；云端显式授权；口令/密钥不持久化；覆盖/清理前可预览、确认并有恢复路径。", "立即阻断发布；完成根因分析、修复与受影响范围复验。"],
            ["签名与供应链", "安装包和更新清单签名有效；依赖/模型来源、版本、许可证和哈希完整；禁用不合规 AGPL 方案。", "停止发布或下载入口，修正依赖/签名后重新生成证据。"],
            ["性能与质量", "第 6 章量化指标达到目标；样本不足项只报告实际值且不宣称达标。", "延期发布或调整未开始功能；不得改变测量口径掩盖回归。"],
            ["可恢复性", "损坏、超时、取消、空间不足和外部进程失败不破坏源文件；回滚包可用。", "阻断相关模块或整个发布，视影响范围修复并重验。"],
        ],
        [3.0, 9.0, 4.8],
    )

    doc.add_heading("6.2 综合评估标准（100 分）", level=2)
    add_table(
        doc,
        ["维度", "权重", "评分依据", "满分条件"],
        [
            ["功能完整性", "35", "P0/P1 逐项验收、条形码 FR-BAR-01~02、打印 FR-PRINT-01~04、图片增强 FR-IMG-01~05、边界与取消流程、缺陷等级；定时关机覆盖预览、确认、取消和终态。", "冻结清单全部通过，无 P0/P1 阻断或严重缺陷；条码格式/下载、四种纸张和持久化正确；图片输出尺寸/格式和原图保护正确；电源动作不越过受控枚举。"],
            ["质量与稳定性", "20", "PDF/Office/OCR/图片固定样本成功率、错误处理、无崩溃会话实际样本。", "达到第 6 章所有质量目标；图片增强、抠图、证件照和文字编辑样本可复核；无崩溃会话样本达到 200 且 ≥99.9%。"],
            ["性能与体积", "15", "冷启动、空闲内存、基础包、关键大文件处理基线。", "三项硬指标达标且相对上一 RC 无未解释回归。"],
            ["体验与可访问性", "10", "两步可达、键盘、缩放、焦点、错误信息和关键页面视觉检查。", "导航目标达标；支持矩阵下无关键遮挡或不可操作问题。"],
            ["安全与隐私", "10", "权限、加密格式、日志/诊断、云端授权、依赖签名与恢复。", "安全测试通过，无高风险未关闭项；隐私政策与界面行为一致。"],
            ["集成与运维", "10", "依赖缺失、插件、网络、更新、发布与回滚演练。", "所有集成均有超时、取消、降级和可观测证据；回滚演练成功。"],
        ],
        [3.0, 1.5, 8.0, 5.0],
    )
    add_callout(
        doc,
        "发布判定",
        "所有硬门禁通过且综合得分不低于 85 分，才可发布 V1.0。统计型指标样本不足时，对应项按实际证据评分并明确“不判定达标”，不得补估或外推。",
        PALE_GREEN,
    )

    doc.add_heading("6.3 需求追踪与证据矩阵", level=2)
    add_table(
        doc,
        ["需求域", "设计/实现依据", "验证方式", "必须留存的证据"],
        [
            ["功能模块 P0/P1", "第 2 章模块表 + FR-BAR-01~02/FR-PRINT-01~04 + 冻结需求清单", "单元、集成、固定样本与关键路径人工检查", "需求编号、用例编号、构建版本、结果与缺陷链接；银行卡号查询排除记录"],
            ["条形码与打印", "第 2.3、4.3.4、4.4.2、5.5.3 节 + barcodeTools/printSettings", "Code 128/EAN-13 固定样本、四种纸张尺寸、范围解析、刷新持久化和窄视口检查", "参数/校验结果、PNG/SVG 文件、纸张 CSS、localStorage 写入次数、截图与控制台记录"],
            ["图片处理增强", "FR-IMG-01~05 + 第 4.3.5、4.4、4.6、5.5.2 节", "AI 增强/抠图、证件照规格、文字编辑、取消/隐私和窄视口定向检查", "输入样本、原图哈希、输出尺寸/格式、规格数据快照、控制台与截图证据"],
            ["通用工作流 FR-G01~10", "第 2.1 节 + 统一作业契约", "键盘路径、取消/重试、异常注入、隐私与离线测试", "步骤记录、错误码、日志脱敏检查、截图或测试报告"],
            ["用户界面", "第 4.3 节", "1080p/2K、100%/125%/150% 缩放；键盘与屏幕阅读器抽检", "设备、系统、视口、缩放、页面和最终截图"],
            ["集成能力", "第 4.4 节", "依赖存在/缺失/版本不兼容、超时、断网、哈希失败与回滚", "适配器版本、调用结果、降级表现与恢复记录"],
            ["性能", "第 4.6 节 + 第 6 章指标表", "同机 Release 基线、20 次启动、10 分钟内存、CI 包体统计", "原始采样、P50/P95、环境信息、基线差异和结论"],
            ["安全与合规", "第 3.4、4.4.3、7 章", "依赖许可证、更新签名、加密恢复、日志与诊断包检查", "SBOM/许可证清单、签名结果、恢复演练、隐私检查单"],
            ["定时关机", "第 4.4.2.1、5.5.1 + shutdownScheduler/IPC", "参数边界、确认/取消、Rust 状态竞态、浏览器预览和 Windows 隔离设备烟测", "请求/响应快照、单测结果、桌面版本/系统版本、无真实动作的浏览器证据；真实动作需隔离设备记录"],
        ],
        [3.0, 4.7, 5.6, 5.2],
    )

    doc.add_heading("6.4 评审输出模板", level=2)
    add_bullets(
        doc,
        [
            "结论：通过 / 有条件通过 / 不通过；“有条件通过”不得用于绕过硬门禁。",
            "范围：构建版本、提交标识、系统版本、参考设备、依赖和样本集版本。",
            "结果：每项指标的目标、实际值、样本量、测量时间和判定；失败项附复现条件。",
            "风险：仅记录有证据的残余风险、触发条件、影响范围、负责人和关闭条件。",
            "签署：产品、技术、测试和发布负责人分别确认范围、质量、隐私与发布状态。",
        ],
    )


def style_document(doc: Document) -> None:
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Microsoft YaHei"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal.paragraph_format.line_spacing = 1.35
    normal.paragraph_format.space_after = Pt(6)

    title = styles["Title"]
    title.font.name = "Microsoft YaHei"
    title._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    title.font.size = Pt(26)
    title.font.bold = True
    title.font.color.rgb = RGBColor.from_string(NAVY)

    for name, size, color in (("Heading 1", 16, NAVY), ("Heading 2", 13, TEAL), ("Heading 3", 11, GREEN)):
        style = styles[name]
        style.font.name = "Microsoft YaHei"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(color)
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.space_before = Pt(14 if name == "Heading 1" else 10)
        style.paragraph_format.space_after = Pt(6)

    if "Document Note" not in styles:
        note_style = styles.add_style("Document Note", WD_STYLE_TYPE.PARAGRAPH)
        note_style.font.name = "Microsoft YaHei"
        note_style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        note_style.font.size = Pt(9.5)
        note_style.font.color.rgb = RGBColor.from_string(MUTED)

    for section in doc.sections:
        section.top_margin = Cm(1.9)
        section.bottom_margin = Cm(1.8)
        section.left_margin = Cm(2.0)
        section.right_margin = Cm(2.0)
        section.header_distance = Cm(0.8)
        section.footer_distance = Cm(0.8)

        header = section.header
        header.is_linked_to_previous = False
        hp = header.paragraphs[0]
        hp.text = "文档办公与效率工具完整解决方案  ·  V2.0"
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        for run in hp.runs:
            set_east_asian_font(run, "Microsoft YaHei", 8.5)
            run.font.color.rgb = RGBColor.from_string(MUTED)

        footer = section.footer
        footer.is_linked_to_previous = False
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = fp.add_run("第 ")
        set_east_asian_font(run, "Microsoft YaHei", 8.5)
        add_field(fp.add_run(), "PAGE")
        run = fp.add_run(" 页 / 共 ")
        set_east_asian_font(run, "Microsoft YaHei", 8.5)
        add_field(fp.add_run(), "NUMPAGES")
        run = fp.add_run(" 页")
        set_east_asian_font(run, "Microsoft YaHei", 8.5)

    for paragraph in doc.paragraphs:
        for run in paragraph.runs:
            if paragraph.style.name == "Title":
                set_east_asian_font(run, "Microsoft YaHei", 26, True)
            elif paragraph.style.name.startswith("Heading"):
                set_east_asian_font(run, "Microsoft YaHei")
            elif run.font.name != "Consolas":
                set_east_asian_font(run, "Microsoft YaHei")

    for table_index, table in enumerate(doc.tables):
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = True
        set_repeat_header(table)
        for row_index, row in enumerate(table.rows):
            for cell in row.cells:
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                set_cell_margins(cell)
                if row_index == 0:
                    set_cell_shading(cell, NAVY)
                elif row_index % 2 == 0 and table_index != 0:
                    set_cell_shading(cell, PALE)
                for paragraph in cell.paragraphs:
                    paragraph.paragraph_format.space_after = Pt(2)
                    paragraph.paragraph_format.line_spacing = 1.15
                    for run in paragraph.runs:
                        set_east_asian_font(run, "Microsoft YaHei", 8.2)
                        if row_index == 0:
                            run.bold = True
                            run.font.color.rgb = RGBColor(255, 255, 255)


def update_cover_and_revision(doc: Document) -> None:
    doc.paragraphs[0].text = "文档办公与效率工具完整解决方案"
    doc.paragraphs[1].text = "—— 本地化、轻量、无广告的桌面端效率百宝箱"
    doc.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.paragraphs[1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.paragraphs[1].paragraph_format.space_after = Pt(18)

    metadata = doc.tables[0]
    updates = {
        "文档名称": "文档办公与效率工具完整解决方案",
        "版本": "V2.0",
        "日期": "2026-09-06",
        "状态": "实施方案（可立项评审）",
    }
    for row in metadata.rows:
        key = row.cells[0].text.strip()
        if key in updates:
            row.cells[1].text = updates[key]

    revision = doc.tables[1]
    row = revision.add_row().cells
    values = [
        "V2.0",
        "2026-09-06",
        "Codex（依据 V1.2 完善）",
        "新增执行摘要、通用功能需求、用户界面设计、统一集成契约、本地数据模型、性能优化实施方案、工作包与阶段出口、发布回滚、硬门禁与综合评估矩阵。",
    ]
    for index, value in enumerate(values):
        row[index].text = value

    core = doc.core_properties
    core.title = "文档办公与效率工具完整解决方案"
    core.subject = "功能需求、技术规范、实施步骤、评估标准、用户界面、集成能力与性能优化"
    core.keywords = "Tauri, Vue 3, Rust, 办公效率, 文档处理, 本地优先, 性能优化"
    core.comments = "基于 V1.2 评审修订稿形成的 V2.0 完整实施方案"


def replace_legacy_stability_thresholds(doc: Document) -> int:
    """Align inherited V1.2 stability gates with the current 200-session gate."""
    replacements = {"10,000": "200"}
    replaced = 0

    def update_paragraph(paragraph) -> None:
        nonlocal replaced
        original = paragraph.text
        updated = original
        for old, new in replacements.items():
            updated = updated.replace(old, new)
        if updated == original:
            return
        if paragraph.runs:
            paragraph.runs[0].text = updated
            for run in paragraph.runs[1:]:
                run.text = ""
        else:
            paragraph.text = updated
        replaced += 1

    def update_table(table) -> None:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    update_paragraph(paragraph)
                for nested in cell.tables:
                    update_table(nested)

    for paragraph in doc.paragraphs:
        update_paragraph(paragraph)
    for table in doc.tables:
        update_table(table)
    return replaced


def update_legacy_source_content(doc: Document) -> None:
    """Align inherited V1.2 scope text with the implemented seven-module route."""
    module_table = next(
        (
            table
            for table in doc.tables
            if table.rows and table.rows[0].cells[0].text.strip() == "模块"
        ),
        None,
    )
    if module_table is None:
        raise ValueError("未找到模块规划表")

    module_rows = [
        [
            "01 文档办公",
            "P0：PDF 合并/拆分、批量重命名\nP1：Office 导出 PDF、压缩/解压、办公模板、OCR 文字识别、A4/A5/B4/B5 文档打印\nP2：PDF 结构化导出 DOCX/XLSX（Beta）、AI 摘要/润色、样式统一",
            "Office 导出 PDF 依赖本机 LibreOffice；打印支持 PDF、图片和文本，Office 文件需先导出为 PDF；PDF 反向导出仅提取文本/表格，不承诺原版式还原",
            "P0：阶段一\nP1：阶段二/三\nP2：V1.1+",
        ],
        [
            "02 效率助手",
            "P1：待办清单、番茄钟、快捷便签、日历提醒\nP2：快捷键速查、会议纪要模板、白噪音/专注环境",
            "提醒采用本机通知；跨设备同步不在 V1.0 范围",
            "P1：阶段二\nP2：V1.1+",
        ],
        [
            "03 数据计算",
            "P0：单位换算、日期/年龄、百分比计算\nP1：汇率、房贷/个税、BMI\nP2：发票/票据识别录入",
            "汇率需联网取最新数据并显示时间戳；税费规则需标注适用地区和生效日期",
            "P0：阶段一\nP1：阶段二\nP2：V1.1+",
        ],
        [
            "04 网络工具",
            "P0：二维码生成/识别\nP1：条形码生成、网速测试、IP 查询、Ping、端口检测\nP2：短链接、局域网文件快传",
            "条形码仅在本地生成；外网类功能不计入离线能力；端口检测只允许用户指定的目标和端口；银行卡号信息查询不实施",
            "P0：阶段一\nP1：阶段三\nP2：V1.1+",
        ],
        [
            "05 图片处理",
            "P0：图片压缩、格式转换\nP1：截图/长截图、批量加水印、长图拼接、本地 AI 图片增强/抠图、证件照裁剪与规格参考、图片文字编辑\nP2：云端视觉模型与复杂对象移除（仅限自有内容）",
            "P1 图片能力默认使用 Canvas Local Vision 本地算法；不上传原图；证件照尺寸以办证机构最新要求为准；云端视觉与对象移除必须单独授权并提示使用边界",
            "P0：阶段一\nP1：阶段三\nP2：V1.1+",
        ],
        [
            "06 安全隐私",
            "P0：强密码生成、密码强度检测\nP1：文件加密/解密、敏感信息脱敏\nP2：隐私清理",
            "密码不持久化；加密使用成熟格式和库；覆盖原文件或清理前必须预览、确认并提供恢复路径",
            "P0：阶段一\nP1：阶段三\nP2：V1.1+",
        ],
        [
            "07 定时关机",
            "P1：倒计时关机、定点时刻关机、取消定时任务、关机/重启/休眠\nP2：周期/空闲触发、托盘、自启、智能负载触发",
            "仅 Windows 10/11 桌面版执行；浏览器仅预览；一次只运行一个活动任务；默认保留 30 秒安全缓冲，不支持强制关闭程序",
            "P1：阶段二/三\nP2：V1.1+",
        ],
    ]
    for row in list(module_table.rows)[1:]:
        module_table._tbl.remove(row._tr)
    for values in module_rows:
        cells = module_table.add_row().cells
        for index, value in enumerate(values):
            cells[index].text = value

    phase_table = next(
        (
            table
            for table in doc.tables
            if table.rows and table.rows[0].cells[0].text.strip() == "阶段"
        ),
        None,
    )
    if phase_table is None:
        raise ValueError("未找到阶段里程碑表")
    phase_rows = [
        [
            "阶段一（MVP）",
            "第 1-4 周",
            "脚手架、主窗口/导航/全局搜索、本地设置、签名更新校验；全部 P0：PDF 合并/拆分、批量重命名、单位/日期/百分比计算、二维码、图片压缩/格式转换、密码生成/强度检测",
            "P0 清单全部可用；参考设备形成启动/内存/体积基线；LibreOffice 调用、更新签名和加密格式验证可复现后方可进入阶段二",
        ],
        [
            "阶段二（Beta 1）",
            "第 5-8 周",
            "P1 第一批：Office 导出 PDF、压缩/解压、办公模板、A4/A5/B4/B5 文档打印、条形码生成；待办/番茄钟/便签/提醒；汇率、房贷/个税/BMI；定时关机基础版",
            "功能清单逐项通过正常、边界和取消测试；Office 导出固定样本报告；四种纸张/条码固定样本和持久化检查通过；电源动作 IPC 与竞态单测通过",
        ],
        [
            "阶段三（Beta 2）",
            "第 9-12 周",
            "P1 第二批：OCR；本地 AI 图片增强/抠图、证件照裁剪与规格参考、图片文字编辑；网络/IP/Ping/端口；截图/长截图/水印/长图拼接；文件加密/解密/脱敏",
            "图片固定样本（增强、均匀/复杂背景、证件照规格、文字编辑）与 OCR 测试集通过；取消、恢复、超时、多屏缩放和隐私检查证据齐全",
        ],
        [
            "阶段四（RC/V1.0）",
            "第 13-16 周",
            "只处理 P0/P1 集成、兼容性、性能、隐私、可访问性、安装签名、灰度发布和缺陷；不新增 P2",
            "第 6 章指标与发布检查单全部满足；样本不足的统计指标明确标注；未达到门禁则延期或调整未开始范围",
        ],
    ]
    for row in list(phase_table.rows)[1:]:
        phase_table._tbl.remove(row._tr)
    for values in phase_rows:
        cells = phase_table.add_row().cells
        for index, value in enumerate(values):
            cells[index].text = value

    replacements = {
        "PaddleOCR、Whisper、抠图模型": "PaddleOCR、抠图模型",
        "PaddleOCR、Whisper、抠图": "PaddleOCR、抠图",
        "PaddleOCR / Whisper / 抠图模型": "PaddleOCR / 抠图模型",
        "PaddleOCR / Whisper 代码与模型": "PaddleOCR / 抠图模型代码与模型",
        "PaddleOCR/Whisper/抠图模型": "PaddleOCR/抠图模型",
        "Whisper — github.com/openai/whisper": "可选本地模型来源（按插件清单核验）",
        "音视频转文字/字幕、音频格式转换/剪辑、视频封面提取": "图片编辑、批量处理",
        "Rust（五大原生模块）": "Rust（平台与原生能力模块）",
    }

    def replace_paragraph(paragraph) -> None:
        original = paragraph.text
        updated = original
        for old, new in replacements.items():
            updated = updated.replace(old, new)
        if updated == original:
            return
        if paragraph.runs:
            paragraph.runs[0].text = updated
            for run in paragraph.runs[1:]:
                run.text = ""
        else:
            paragraph.text = updated

    def visit_table(table) -> None:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    replace_paragraph(paragraph)
                for nested in cell.tables:
                    visit_table(nested)

    for paragraph in doc.paragraphs:
        replace_paragraph(paragraph)
    for table in doc.tables:
        visit_table(table)

    for table in doc.tables:
        for row in table.rows:
            if row.cells and row.cells[0].text.strip() == "学生/内容创作者":
                row.cells[1].text = "OCR 文字识别、截图长截图、图片处理、番茄钟与专注白噪音"


def build() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    DOCX_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)

    ui_image = ASSET_DIR / "ui-shell-wireframe.png"
    architecture_image = ASSET_DIR / "integration-architecture.png"
    performance_image = ASSET_DIR / "performance-budget-loop.png"
    create_ui_wireframe(ui_image)
    create_architecture_diagram(architecture_image)
    create_performance_loop(performance_image)

    doc = Document(SOURCE)
    update_legacy_source_content(doc)
    replaced_thresholds = replace_legacy_stability_thresholds(doc)
    if replaced_thresholds != 3:
        raise ValueError(
            f"expected three legacy stability thresholds, replaced {replaced_thresholds}"
        )
    update_cover_and_revision(doc)

    insert_block_before(doc, find_paragraph(doc, "1 项目背景"), lambda: add_front_matter(doc))
    insert_block_before(doc, find_paragraph(doc, "3 技术选型"), lambda: add_functional_requirements(doc))
    insert_block_before(
        doc,
        find_paragraph(doc, "5 实施计划"),
        lambda: add_architecture_and_ui(doc, ui_image, architecture_image, performance_image),
    )
    insert_block_before(doc, find_paragraph(doc, "6 预期效果"), lambda: add_implementation_details(doc))
    insert_block_before(doc, find_paragraph(doc, "7 风险分析"), lambda: add_evaluation_details(doc))

    find_paragraph(doc, "5.7 发布、回滚与运行恢复").paragraph_format.page_break_before = True

    style_document(doc)
    doc.settings.update_fields_on_open = True
    doc.save(DOCX_OUTPUT)

    digest = hashlib.sha256(DOCX_OUTPUT.read_bytes()).hexdigest().upper()
    print(f"DOCX={DOCX_OUTPUT}")
    print(f"SHA256={digest}")
    print(f"ASSETS={ASSET_DIR}")


if __name__ == "__main__":
    build()
