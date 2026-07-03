// Blob → <a download> クリックでローカル保存する最小ユーティリティ
// （S10 生成完了カードの「ローカル保存」。Drive 保存と同一内容を手元にも落とせるようにする）
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
  doc: Document = document,
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
