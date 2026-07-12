// entity_key の time セグメント（例: `30d` / `8w`）の best-effort パース（issue #60 要望 2）。
// extract-data skill のプロンプト例（`|time:30d`）に合わせ「数値 + 単位記号」の緩い規約のみを
// 対象にする。正式なフォーマット規定は無いため、規約外の自由記述（例: `baseline` / `術後6ヶ月`）は
// 失敗として空を返し、`timepoint` 列（entity_key 原文）から人間が読み取れることを最終防衛線にする

export interface ParsedTimepoint {
  /** 数値部分（原文の桁そのまま。単位換算はしない） */
  value: string;
  /** 単位記号（小文字化のみ。d/w/m/y 等の意味づけは行わない） */
  unit: string;
}

const EMPTY_TIMEPOINT: ParsedTimepoint = { value: '', unit: '' };

/** `30d` / `8 w` / `12.5m` のような「数値 + 英字単位」だけを受理する */
const TIMEPOINT_PATTERN = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/;

export function parseTimepoint(time: string | null): ParsedTimepoint {
  if (time === null) {
    return EMPTY_TIMEPOINT;
  }
  const match = TIMEPOINT_PATTERN.exec(time.trim());
  if (match === null) {
    return EMPTY_TIMEPOINT;
  }
  const value = match[1] as string;
  const unit = match[2] as string;
  return { value, unit: unit.toLowerCase() };
}
