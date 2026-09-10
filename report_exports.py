from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any


BRL_FORMAT = 'R$ #,##0.00'
DATE_FORMAT = 'dd/mm/yyyy'
DATETIME_FORMAT = 'dd/mm/yyyy hh:mm'


def _value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    return value if value not in (None, "") else "-"


def generate_xlsx(report: dict, path: Path) -> Path:
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
        from openpyxl.utils import get_column_letter
        from openpyxl.worksheet.table import Table, TableStyleInfo
    except ImportError as exc:
        raise RuntimeError("A exportação XLSX requer openpyxl. Execute: pip install -r requirements.txt") from exc

    workbook = Workbook()
    workbook.remove(workbook.active)
    navy = "12304A"
    blue = "0757A8"
    pale_blue = "EAF3FB"
    gold = "D99A1B"
    white = "FFFFFF"
    line = Side(style="thin", color="D9E2E7")

    summary = workbook.create_sheet("Resumo")
    summary.sheet_view.showGridLines = False
    summary.merge_cells("A1:F1")
    summary["A1"] = report["title"]
    summary["A1"].font = Font(size=20, bold=True, color=white)
    summary["A1"].fill = PatternFill("solid", fgColor=navy)
    summary["A1"].alignment = Alignment(vertical="center")
    summary.row_dimensions[1].height = 34
    summary.merge_cells("A2:F2")
    summary["A2"] = report.get("subtitle", "")
    summary["A2"].font = Font(size=10, color="526575")
    summary["A2"].alignment = Alignment(wrap_text=True)
    row_index = 4
    for label, value in report.get("summary", []):
        summary.cell(row_index, 1, label)
        summary.cell(row_index, 2, _value(value))
        summary.cell(row_index, 1).font = Font(bold=True, color=navy)
        summary.cell(row_index, 1).fill = PatternFill("solid", fgColor=pale_blue)
        summary.cell(row_index, 1).border = Border(bottom=line)
        summary.cell(row_index, 2).border = Border(bottom=line)
        summary.cell(row_index, 2).alignment = Alignment(wrap_text=True, vertical="top")
        row_index += 1
    summary.column_dimensions["A"].width = 27
    summary.column_dimensions["B"].width = 62
    summary.freeze_panes = "A4"

    for section_index, section in enumerate(report.get("sections", []), 1):
        title = str(section["title"])[:31]
        base_title = title
        suffix = 2
        while title in workbook.sheetnames:
            title = f"{base_title[:27]} {suffix}"
            suffix += 1
        sheet = workbook.create_sheet(title)
        sheet.sheet_view.showGridLines = False
        columns = section["columns"]
        rows = section.get("rows", [])
        for col_index, column in enumerate(columns, 1):
            cell = sheet.cell(1, col_index, column["label"])
            cell.font = Font(bold=True, color=white)
            cell.fill = PatternFill("solid", fgColor=blue)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = Border(left=line, right=line, top=line, bottom=line)
        sheet.row_dimensions[1].height = 30

        for row_index, record in enumerate(rows, 2):
            for col_index, column in enumerate(columns, 1):
                cell = sheet.cell(row_index, col_index, _value(record.get(column["key"])))
                cell.alignment = Alignment(vertical="top", wrap_text=column.get("wrap", False))
                cell.border = Border(bottom=line)
                if row_index % 2 == 0:
                    cell.fill = PatternFill("solid", fgColor="F7FAFC")
                kind = column.get("kind")
                if kind == "currency" and isinstance(cell.value, (int, float)):
                    cell.number_format = BRL_FORMAT
                elif kind == "number" and isinstance(cell.value, (int, float)):
                    cell.number_format = '#,##0.##'
                elif kind == "date" and isinstance(cell.value, (date, datetime)):
                    cell.number_format = DATE_FORMAT
                elif kind == "datetime" and isinstance(cell.value, (date, datetime)):
                    cell.number_format = DATETIME_FORMAT

        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{max(1, len(rows) + 1)}"
        for col_index, column in enumerate(columns, 1):
            samples = [str(column["label"])] + [str(_value(record.get(column["key"]))) for record in rows[:200]]
            longest = max((len(sample) for sample in samples), default=10)
            preferred = column.get("width", 0)
            sheet.column_dimensions[get_column_letter(col_index)].width = min(48, max(preferred, min(longest + 2, 34)))

        if rows:
            table_name = f"LicitaUM{section_index}"
            table = Table(displayName=table_name, ref=f"A1:{get_column_letter(len(columns))}{len(rows) + 1}")
            table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True, showFirstColumn=False, showLastColumn=False)
            sheet.add_table(table)

    workbook.save(path)
    return path


def _pdf_text(value: Any) -> str:
    from xml.sax.saxutils import escape

    if isinstance(value, datetime):
        return value.strftime("%d/%m/%Y %H:%M")
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    if isinstance(value, (float, Decimal)):
        return f"{float(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return escape(str(_value(value))).replace("\n", "<br/>")


def _column_groups(columns: list[dict], maximum: int = 8) -> list[list[dict]]:
    if len(columns) <= maximum:
        return [columns]
    anchors = columns[:2]
    remaining = columns[2:]
    chunk_size = maximum - len(anchors)
    return [anchors + remaining[index:index + chunk_size] for index in range(0, len(remaining), chunk_size)]


def generate_pdf(report: dict, path: Path) -> Path:
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_LEFT
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import KeepTogether, LongTable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError as exc:
        raise RuntimeError("A exportação PDF requer reportlab. Execute: pip install -r requirements.txt") from exc

    page_size = landscape(A4)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("LicitaUMTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=colors.HexColor("#12304A"), alignment=TA_LEFT, spaceAfter=3 * mm)
    subtitle_style = ParagraphStyle("LicitaUMSubtitle", parent=styles["Normal"], fontSize=8.5, leading=11, textColor=colors.HexColor("#526575"), spaceAfter=5 * mm)
    section_style = ParagraphStyle("LicitaUMSection", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=colors.HexColor("#0757A8"), spaceBefore=3 * mm, spaceAfter=2 * mm)
    cell_style = ParagraphStyle("LicitaUMCell", parent=styles["Normal"], fontName="Helvetica", fontSize=6.4, leading=8, textColor=colors.HexColor("#10202A"))
    header_style = ParagraphStyle("LicitaUMHeader", parent=cell_style, fontName="Helvetica-Bold", textColor=colors.white, alignment=TA_LEFT)

    def footer(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#D9E2E7"))
        canvas.line(12 * mm, 9 * mm, page_size[0] - 12 * mm, 9 * mm)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#667787"))
        canvas.drawString(12 * mm, 5.5 * mm, "LicitaUM - Relatório gerado automaticamente")
        canvas.drawRightString(page_size[0] - 12 * mm, 5.5 * mm, f"Página {document.page}")
        canvas.restoreState()

    document = SimpleDocTemplate(str(path), pagesize=page_size, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=11 * mm, bottomMargin=13 * mm, title=report["title"], author="LicitaUM")
    story = [Paragraph(report["title"], title_style), Paragraph(report.get("subtitle", ""), subtitle_style)]

    summary_rows = []
    for label, value in report.get("summary", []):
        summary_rows.append([Paragraph(f"<b>{_pdf_text(label)}</b>", cell_style), Paragraph(_pdf_text(value), cell_style)])
    if summary_rows:
        summary_table = Table(summary_rows, colWidths=[48 * mm, page_size[0] - 24 * mm - 48 * mm], hAlign="LEFT")
        summary_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EAF3FB")),
            ("BOX", (0, 0), (-1, -1), .4, colors.HexColor("#D9E2E7")),
            ("INNERGRID", (0, 0), (-1, -1), .25, colors.HexColor("#D9E2E7")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.extend([summary_table, Spacer(1, 5 * mm)])

    available_width = page_size[0] - 24 * mm
    for section_index, section in enumerate(report.get("sections", [])):
        if section_index:
            story.append(PageBreak())
        story.append(Paragraph(section["title"], section_style))
        rows = section.get("rows", [])
        if not rows:
            story.append(Paragraph("Nenhum registro encontrado.", subtitle_style))
            continue
        groups = _column_groups(section["columns"])
        for group_index, columns in enumerate(groups, 1):
            if len(groups) > 1:
                story.append(Paragraph(f"{section['title']} - informações {group_index} de {len(groups)}", subtitle_style))
            width_units = [max(1, column.get("pdf_weight", 1)) for column in columns]
            unit_total = sum(width_units)
            col_widths = [available_width * unit / unit_total for unit in width_units]
            table_rows = [[Paragraph(_pdf_text(column["label"]), header_style) for column in columns]]
            for record in rows:
                values = []
                for column in columns:
                    value = record.get(column["key"])
                    if column.get("kind") == "currency" and isinstance(value, (int, float, Decimal)):
                        value = "R$ " + _pdf_text(value)
                    values.append(Paragraph(_pdf_text(value), cell_style))
                table_rows.append(values)
            table = LongTable(table_rows, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0757A8")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F8FA")]),
                ("GRID", (0, 0), (-1, -1), .25, colors.HexColor("#C9D5DB")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]))
            story.append(table)
            if group_index < len(groups):
                story.extend([PageBreak(), Paragraph(section["title"], section_style)])

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return path
