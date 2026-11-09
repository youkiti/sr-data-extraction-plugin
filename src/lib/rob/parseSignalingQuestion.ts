export interface SignalingQuestion {
  tool: 'RoB 2' | 'ROBINS-I' | 'QUADAS-3';
  code: string;
  question: string;
  condition: string | null;
}

/** 保存された抽出指示から設問を取り出す。事前設定の前置きがあっても扱う。 */
export function parseSignalingQuestion(instruction: string): SignalingQuestion | null {
  const match = /(RoB 2|ROBINS-I|QUADAS-3) signaling question ([0-9.]+): "(.+?)" Answer with/.exec(instruction);
  if (match === null) return null;
  const condition = /この設問は条件付きです（(.+?)）。条件を満たさない場合は/.exec(instruction);
  return {
    tool: match[1] as SignalingQuestion['tool'],
    code: match[2]!,
    question: match[3]!,
    condition: condition === null ? null : condition[1]!,
  };
}
