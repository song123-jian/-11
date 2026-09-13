let zipPromise

async function getZip() {
  zipPromise ||= import('jszip').then(({ default: JSZip }) => JSZip)
  return zipPromise
}

const templates = {
  meeting: {
    filename: '会议纪要模板.docx',
    title: '会议纪要',
    lines: ['会议主题：', '日期与时间：', '地点 / 会议方式：', '主持人：', '参会人员：', '记录人：', '', '一、会议目标', '', '二、讨论要点', '', '三、决策事项', '', '四、行动项（事项 / 负责人 / 截止日期）'],
  },
  expense: {
    filename: '报销清单模板.docx',
    title: '报销清单',
    lines: ['报销人：', '部门：', '报销期间：', '', '费用明细（日期 / 类别 / 说明 / 金额 / 凭证编号）', '', '合计金额：', '审批人：', '备注：'],
  },
  weekly: {
    filename: '项目周报模板.docx',
    title: '项目周报',
    lines: ['项目名称：', '报告周期：', '负责人：', '', '一、本周完成', '', '二、关键指标', '', '三、风险与阻塞', '', '四、下周计划', '', '五、需要协调事项'],
  },
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[character])
}

function paragraph(text, heading = false) {
  const properties = heading ? '<w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>' : ''
  return `<w:p><w:r>${properties}<w:t xml:space="preserve">${escapeXml(text || ' ')}</w:t></w:r></w:p>`
}

export async function createOfficeTemplate(type) {
  const template = templates[type]
  if (!template) throw new Error('未知办公模板')
  const JSZip = await getZip()
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const body = [paragraph(template.title, true), ...template.lines.map((line) => paragraph(line))].join('')
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`)
  return {
    blob: await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    filename: template.filename,
  }
}
