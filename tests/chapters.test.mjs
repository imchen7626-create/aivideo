import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitChapters } from '../src/core/pipeline/chapters.ts'

test('book title and repeated chapter headings remain with the real chapter', () => {
  const source = '《好想和你谈恋爱》\n\n第1章 重逢\n分镜脚本\n章节\n第1章 重逢\n人物小传\n林嘉清：护士\n周霄：银行职员\n分镜正文'
  const chapters = splitChapters(source)
  assert.equal(chapters.length, 1)
  assert.equal(chapters[0].title, '第1章 重逢')
  assert.equal(chapters[0].text, source)
})
test('different chapters split, and all source lines survive', () => {
  const source = '书名前言\n第 一 章 重逢\n第一章内容\n第二章 秘密\n第二章内容'
  const chapters = splitChapters(source)
  assert.equal(chapters.length, 2)
  assert.match(chapters[0].text, /书名前言/)
  assert.match(chapters[1].text, /第二章内容/)
})
test('nested markdown section headings do not split an explicit chapter', () => {
  const chapters = splitChapters('# 剧名\n## 第1章 重逢\n### 人物\n林夏\n### 分镜\n对白\n## 第2章 秘密\n正文')
  assert.equal(chapters.length, 2)
  assert.match(chapters[0].text, /林夏/)
})
test('unheaded scripts and blank source', () => {
  assert.equal(splitChapters('').length, 0)
  assert.equal(splitChapters('林夏：你回来了。\n陈默：是的。').length, 1)
})
