/**
 * 贴进来的已经是分镜或剧本（较长，或带镜号、景别、首帧/运镜等分镜术语）：
 * 应按原文改编，而不是当作一句话创意让 AI 另写故事。
 */
export function looksLikeScript(text: string): boolean {
  const t = text.trim()
  return (
    t.length >= 200 ||
    /分镜|首帧|景别|运镜|机位|镜头\s*[0-9一二三四五六七八九十]|第\s*[0-9一二三四五六七八九十]+\s*[镜场幕]|(?:^|\n)\s*(?:镜头|场景|Shot)?\s*\d+\s*[.、:：]/i.test(t)
  )
}

/** 描述里写了台词：引号、“某某说：”这类引语，或明确提到对白、台词。 */
export function hasDialogue(text: string): boolean {
  return /[“”"「」『』]|[说喊叫问答道讲][：:]|台词|对白|说道|喊道|大喊|喊着|说着|说了句|问道/.test(text)
}

/**
 * 用户想改一段已有的视频（MV、电影、原片里换人、“其余不变”），而生产台只能按文字重新生成画面：
 * 创建前要先说清楚，避免花钱生成一段和预期不沾边的新内容。
 */
export function referencesExistingVideo(text: string): boolean {
  return /(MV|mv|原片|原视频|电影|视频|片段|广告|名场面|镜头)[^。！？\n]{0,40}(换成|替换成?|改成|换掉)|(别的|其他|其余)(的)?(都)?(不用动|不要动|不变|保持不变)/.test(
    text,
  )
}
