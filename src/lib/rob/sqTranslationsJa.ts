/**
 * signaling question（SQ）英語原文 → 日本語訳の対応表。
 * 判定カードで原文の下に添える参考訳で、AI への指示や保存値には使わない。
 * キーは src/features/schema/presets/robTemplates.ts の各 SQ 定義の `question` と一字一句同じにする
 * （同じ番号でも RoB 2 の assignment 版と adhering 版、ROBINS-I、QUADAS-3 で原文が違うため、番号ではなく原文で引く）。
 * 訳は Claude が作成した参考訳で、公式の日本語版ではない。
 */
export const SQ_TRANSLATIONS_JA: Readonly<Record<string, string>> = {
  // --- RoB 2（assignment 版・共通） ---
  'Was the allocation sequence random?': '割り付けの順番は無作為だったか？',
  'Was the allocation sequence concealed until participants were enrolled and assigned to interventions?':
    '参加者の登録と介入への割り付けが終わるまで、割り付けの順番は隠されていたか？',
  'Did baseline differences between intervention groups suggest a problem with the randomization process?':
    '介入群の間のベースラインの違いは、無作為化の過程に問題があったことを示唆するか？',
  'Were participants aware of their assigned intervention during the trial?':
    '試験中、参加者は自分に割り付けられた介入を知っていたか？',
  "Were carers and people delivering the interventions aware of participants' assigned intervention during the trial?":
    '試験中、ケアの担当者や介入の実施者は、参加者に割り付けられた介入を知っていたか？',
  'Were there deviations from the intended intervention that arose because of the trial context?':
    '試験という状況のために、意図した介入からの逸脱が生じたか？',
  'Were these deviations likely to have affected the outcome?': 'それらの逸脱はアウトカムに影響した可能性が高いか？',
  'Were these deviations from intended intervention balanced between groups?':
    '意図した介入からのそれらの逸脱は、群の間で釣り合っていたか？',
  'Was an appropriate analysis used to estimate the effect of assignment to intervention?':
    '介入への割り付けの効果を推定するのに、適切な解析が用いられたか？',
  'Was there potential for a substantial impact (on the result) of the failure to analyse participants in the group to which they were randomized?':
    '参加者を無作為化された群で解析しなかったことが、結果に大きく影響した可能性はあるか？',
  'Were data for this outcome available for all, or nearly all, participants randomized?':
    'このアウトカムのデータは、無作為化された参加者の全員またはほぼ全員で得られていたか？',
  'Is there evidence that the result was not biased by missing outcome data?':
    '結果がアウトカムデータの欠測によって偏っていないという根拠はあるか？',
  'Could missingness in the outcome depend on its true value?': 'アウトカムの欠測は、その真の値に依存しうるか？',
  'Is it likely that missingness in the outcome depended on its true value?':
    'アウトカムの欠測が、その真の値に依存していた可能性は高いか？',
  'Was the method of measuring the outcome inappropriate?': 'アウトカムの測定方法は不適切だったか？',
  'Could measurement or ascertainment of the outcome have differed between intervention groups?':
    'アウトカムの測定や確認の仕方は、介入群の間で違っていた可能性があるか？',
  'Were outcome assessors aware of the intervention received by study participants?':
    'アウトカムの評価者は、参加者が受けた介入を知っていたか？',
  'Could assessment of the outcome have been influenced by knowledge of intervention received?':
    '受けた介入を知っていたことが、アウトカムの評価に影響した可能性はあるか？',
  'Is it likely that assessment of the outcome was influenced by knowledge of intervention received?':
    '受けた介入を知っていたことが、アウトカムの評価に影響した可能性は高いか？',
  'Were the data that produced this result analysed in accordance with a pre-specified analysis plan that was finalized before unblinded outcome data were available for analysis?':
    'この結果を生んだデータは、盲検化されていないアウトカムデータが解析に使えるようになる前に確定した、事前の解析計画に沿って解析されたか？',
  'Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible outcome measurements (e.g. scales, definitions, time points) within the outcome domain?':
    '評価している数値の結果は、そのアウトカム領域にある複数の適格な測定（尺度・定義・時点など）の中から、結果をもとに選ばれた可能性が高いか？',
  'Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible analyses of the data?':
    '評価している数値の結果は、データの複数の適格な解析の中から、結果をもとに選ばれた可能性が高いか？',
  // --- RoB 2（adhering 版 D2） ---
  'Were important non-protocol interventions balanced across intervention groups?':
    'プロトコル外の重要な介入は、介入群の間で釣り合っていたか？',
  'Were there failures in implementing the intervention that could have affected the outcome?':
    'アウトカムに影響しうる、介入の実施の失敗があったか？',
  "Was there non-adherence to the assigned intervention regimen that could have affected participants' outcomes?":
    '参加者のアウトカムに影響しうる、割り付けられた介入の計画への不遵守があったか？',
  'Was an appropriate analysis used to estimate the effect of adhering to the intervention?':
    '介入を遵守した場合の効果を推定するのに、適切な解析が用いられたか？',
  // --- ROBINS-I ---
  'Is there potential for confounding of the effect of intervention in this study?':
    'この研究では、介入の効果に交絡が生じている可能性があるか？',
  "Was the analysis based on splitting participants' follow up time according to intervention received?":
    '解析は、参加者の追跡期間を受けた介入ごとに分けたものだったか？',
  'Were intervention discontinuations or switches likely to be related to factors that are prognostic for the outcome?':
    '介入の中止や切り替えは、アウトカムの予後因子と関連していた可能性が高いか？',
  'Did the authors use an appropriate analysis method that controlled for all the important confounding domains?':
    '著者は、重要な交絡の領域をすべて調整する適切な解析方法を用いたか？',
  'Were confounding domains that were controlled for measured validly and reliably by the variables available in this study?':
    '調整された交絡の領域は、この研究で得られた変数によって妥当かつ信頼できる形で測定されていたか？',
  'Did the authors control for any post-intervention variables that could have been affected by the intervention?':
    '著者は、介入の影響を受けうる介入開始後の変数で調整したか？',
  'Did the authors use an appropriate analysis method that controlled for all the important confounding domains and for time-varying confounding?':
    '著者は、重要な交絡の領域すべてと時間依存性の交絡を調整する適切な解析方法を用いたか？',
  'Was selection of participants into the study (or into the analysis) based on participant characteristics observed after the start of intervention?':
    '研究（または解析）への参加者の選択は、介入開始後に観察された参加者の特性にもとづいていたか？',
  'Were the post-intervention variables that influenced selection likely to be associated with intervention?':
    '選択に影響した介入開始後の変数は、介入と関連していた可能性が高いか？',
  'Were the post-intervention variables that influenced selection likely to be influenced by the outcome or a cause of the outcome?':
    '選択に影響した介入開始後の変数は、アウトカムまたはアウトカムの原因の影響を受けていた可能性が高いか？',
  'Do start of follow-up and start of intervention coincide for most participants?':
    'ほとんどの参加者で、追跡の開始と介入の開始は一致しているか？',
  'Were adjustment techniques used that are likely to correct for the presence of selection biases?':
    '選択バイアスを補正できそうな調整の手法が用いられたか？',
  'Were intervention groups clearly defined?': '介入群は明確に定義されていたか？',
  'Was the information used to define intervention groups recorded at the start of the intervention?':
    '介入群を定義するのに使った情報は、介入の開始時点で記録されていたか？',
  'Could classification of intervention status have been affected by knowledge of the outcome or risk of the outcome?':
    '介入の状態の分類は、アウトカムやそのリスクを知っていたことの影響を受けた可能性があるか？',
  'Were there deviations from the intended intervention beyond what would be expected in usual practice?':
    '通常の診療で予想される範囲を超えた、意図した介入からの逸脱があったか？',
  'Were these deviations from intended intervention unbalanced between groups and likely to have affected the outcome?':
    '意図した介入からのそれらの逸脱は、群の間で偏っており、アウトカムに影響した可能性が高いか？',
  'Were important co-interventions balanced across intervention groups?': '重要な併用介入は、介入群の間で釣り合っていたか？',
  'Was the intervention implemented successfully for most participants?': 'ほとんどの参加者で、介入はうまく実施されたか？',
  'Did study participants adhere to the assigned intervention regimen?':
    '参加者は、割り付けられた介入の計画を遵守したか？',
  'Was an appropriate analysis used to estimate the effect of starting and adhering to the intervention?':
    '介入を開始し遵守した場合の効果を推定するのに、適切な解析が用いられたか？',
  'Were outcome data available for all, or nearly all, participants?':
    'アウトカムのデータは、参加者の全員またはほぼ全員で得られていたか？',
  'Were participants excluded due to missing data on intervention status?':
    '介入の状態のデータの欠測のために除外された参加者がいたか？',
  'Were participants excluded due to missing data on other variables needed for the analysis?':
    '解析に必要なほかの変数のデータの欠測のために除外された参加者がいたか？',
  'Are the proportion of participants and reasons for missing data similar across interventions?':
    'データが欠測した参加者の割合と欠測の理由は、介入の間で似ているか？',
  'Is there evidence that results were robust to the presence of missing data?':
    '結果がデータの欠測に対して頑健だったという根拠はあるか？',
  'Could the outcome measure have been influenced by knowledge of the intervention received?':
    'アウトカムの測定は、受けた介入を知っていたことの影響を受けた可能性があるか？',
  'Were the methods of outcome assessment comparable across intervention groups?':
    'アウトカムの評価方法は、介入群の間で同等だったか？',
  'Were any systematic errors in measurement of the outcome related to intervention received?':
    'アウトカムの測定の系統的な誤差は、受けた介入と関連していたか？',
  'Is the reported effect estimate likely to be selected, on the basis of the results, from multiple outcome measurements within the outcome domain?':
    '報告された効果推定値は、そのアウトカム領域にある複数の測定の中から、結果をもとに選ばれた可能性が高いか？',
  'Is the reported effect estimate likely to be selected, on the basis of the results, from multiple analyses of the intervention-outcome relationship?':
    '報告された効果推定値は、介入とアウトカムの関係についての複数の解析の中から、結果をもとに選ばれた可能性が高いか？',
  'Is the reported effect estimate likely to be selected, on the basis of the results, from different subgroups?':
    '報告された効果推定値は、異なるサブグループの中から、結果をもとに選ばれた可能性が高いか？',
  // --- QUADAS-3 ---
  'Was a single-gate design used?': '単一ゲートのデザインが用いられたか？',
  'Were participants prospectively enrolled?': '参加者は前向きに登録されたか？',
  'Was a consecutive or random sample of participants included?': '参加者は連続または無作為の標本として組み入れられたか？',
  'Is the study group a representative sample of the intended-use population?':
    '研究の対象者は、検査を使う予定の集団を代表する標本か？',
  'Was the index test conducted and interpreted according to the recommended instructions?':
    'インデックス検査は、推奨される手順に沿って実施・判定されたか？',
  'Were the index test results interpreted without knowledge of the reference standard results?':
    'インデックス検査の結果は、参照基準の結果を知らずに判定されたか？',
  'Were the index test results interpreted with the same information as would be available when the test is used in practice?':
    'インデックス検査の結果は、実際の診療で検査を使うときに得られるのと同じ情報で判定されたか？',
  'If an index test threshold was used, was it standard or pre-specified?':
    'インデックス検査に閾値を用いた場合、それは標準のもの、または事前に定めたものだったか？',
  'Does the reference standard adequately identify those with and without the target condition?':
    '参照基準は、目標疾患のある人とない人を十分に見分けられるか？',
  'Was the target condition assessed in all participants?': '目標疾患は、すべての参加者で評価されたか？',
  'Was the target condition assessed in the same way in all participants?':
    '目標疾患は、すべての参加者で同じ方法で評価されたか？',
  'Did the reference standard avoid incorporating the index test?': '参照基準は、インデックス検査を含まないようにしていたか？',
  'Was the reference standard conducted and interpreted according to the recommended instructions?':
    '参照基準は、推奨される手順に沿って実施・判定されたか？',
  'Were the reference standard results interpreted without knowledge of the index test results?':
    '参照基準の結果は、インデックス検査の結果を知らずに判定されたか？',
  'If a reference standard threshold was used, was it standard or pre-specified?':
    '参照基準に閾値を用いた場合、それは標準のもの、または事前に定めたものだったか？',
  'Was there an appropriate time interval between index test and reference standard?':
    'インデックス検査と参照基準の間の時間の間隔は適切だったか？',
  'Were all participants included in the analysis?': 'すべての参加者が解析に含まれたか？',
  'Were missing data handled appropriately?': '欠測データは適切に扱われたか？',
  'Does the unit of analysis match the ideal test accuracy trial?': '解析の単位は、理想的な検査精度の試験と一致しているか？',
  'Were the estimates of sensitivity and specificity calculated appropriately?':
    '感度と特異度の推定値は適切に計算されたか？',
};
