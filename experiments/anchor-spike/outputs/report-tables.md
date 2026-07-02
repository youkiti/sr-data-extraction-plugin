| 区分 | n | exact | normalized | fuzzy | failed | verbatim 率 | anchor 成功率 |
|---|---|---|---|---|---|---|---|
| ALL | 78 | 69 | 0 | 6 | 3 | 88.5% | 96.2% |
| level:arm | 24 | 21 | 0 | 2 | 1 | 87.5% | 95.8% |
| level:outcome_result | 22 | 19 | 0 | 2 | 1 | 86.4% | 95.5% |
| level:study | 32 | 29 | 0 | 2 | 1 | 90.6% | 96.9% |
| mode:pdf_native | 39 | 32 | 0 | 5 | 2 | 82.1% | 94.9% |
| mode:pdf_native|level:arm | 12 | 9 | 0 | 2 | 1 | 75.0% | 91.7% |
| mode:pdf_native|level:outcome_result | 11 | 9 | 0 | 1 | 1 | 81.8% | 90.9% |
| mode:pdf_native|level:study | 16 | 14 | 0 | 2 | 0 | 87.5% | 100.0% |
| mode:text_only | 39 | 37 | 0 | 1 | 1 | 94.9% | 97.4% |
| mode:text_only|level:arm | 12 | 12 | 0 | 0 | 0 | 100.0% | 100.0% |
| mode:text_only|level:outcome_result | 11 | 10 | 0 | 1 | 0 | 90.9% | 100.0% |
| mode:text_only|level:study | 16 | 15 | 0 | 0 | 1 | 93.8% | 93.8% |
| pdf:thermocov | 40 | 33 | 0 | 4 | 3 | 82.5% | 92.5% |
| pdf:thermocov|mode:pdf_native | 20 | 14 | 0 | 4 | 2 | 70.0% | 90.0% |
| pdf:thermocov|mode:text_only | 20 | 19 | 0 | 0 | 1 | 95.0% | 95.0% |
| pdf:udca | 38 | 36 | 0 | 2 | 0 | 94.7% | 100.0% |
| pdf:udca|mode:pdf_native | 19 | 18 | 0 | 1 | 0 | 94.7% | 100.0% |
| pdf:udca|mode:text_only | 19 | 18 | 0 | 1 | 0 | 94.7% | 100.0% |

## 非 exact 行の詳細

- udca_pdf_native f12_primary_outcome_result_arm outcome:primary|arm:2 → **fuzzy** (ai_page=6, matched_page=6, dist=4, ratio=0.074, extended=fuzzy)
  - quote: "Bilirubin at the discharge (mg/dl) SD ± mean 8.67±1.35"

- udca_text_only f12_primary_outcome_result_arm outcome:primary|arm:2 → **fuzzy** (ai_page=6, matched_page=6, dist=4, ratio=0.074, extended=fuzzy)
  - quote: "Bilirubin at the discharge (mg/dl) SD ± mean 8.67±1.35"

- thermocov_pdf_native f02_country study → **fuzzy** (ai_page=3, matched_page=3, dist=1, ratio=0.012, extended=fuzzy)
  - quote: "Three temporal COVID-19units in Mexico City, Jalisco, and Tabasco recruited patients"

- thermocov_pdf_native f03_sample_size_total study → **fuzzy** (ai_page=5, matched_page=5, dist=4, ratio=0.060, extended=fuzzy)
  - quote: "144 were randomized to thermotherapy (n=72) or standard care (n=72)"

- thermocov_pdf_native f10_arm_n_randomized arm:1 → **fuzzy** (ai_page=5, matched_page=5, dist=2, ratio=0.047, extended=fuzzy)
  - quote: "144 were randomized to thermotherapy (n=72)"

- thermocov_pdf_native f11_intervention_description arm:1 → **fuzzy** (ai_page=3, matched_page=3, dist=4, ratio=0.025, extended=fuzzy)
  - quote: "The intervention consisted of local thermotherapy via an electric heat pad (30 × 40cm) in the thorax continuously for 90min, twice daily (every 12h), for 5days."

- thermocov_pdf_native f10_arm_n_randomized arm:2 → **failed** (ai_page=5, matched_page=null, dist=17, ratio=0.362, extended=failed)
  - quote: "144 were randomized to ... standard care (n=72)"

- thermocov_pdf_native f13_ae_any_arm outcome:primary|arm:2 → **failed** (ai_page=2, matched_page=null, dist=18, ratio=0.269, extended=failed)
  - quote: "Seven (13.7%) patients in the control group ... had at least one AE"

- thermocov_text_only f04_population study → **failed** (ai_page=3, matched_page=null, dist=52, ratio=0.286, extended=failed)
  - quote: "Eligible participants were patients with symptoms of COVID-19... who were admitted to hospital upon a compatible clinical presentation, meeting criteria for mild or moderate COVID-19"

## 複数一致（matchCount > 1）: 12 行
- udca_pdf_native f02_country study: 2 箇所 (quote="17 Shahrivar Hospital in Rasht, Iran.")
- udca_text_only f02_country study: 2 箇所 (quote="neonatal ward of 17 Shahrivar Hospital in Rasht, Iran.")
- thermocov_pdf_native f09_arm_label arm:1: 2 箇所 (quote="thermotherapy n = 54")
- thermocov_pdf_native f09_arm_label arm:2: 2 箇所 (quote="control n = 51")
- thermocov_pdf_native f12_primary_outcome_result_arm outcome:primary|arm:2: 2 箇所 (quote="The primary outcome of disease progression occurred in 31.4%")
- thermocov_pdf_native f15_primary_outcome_p_value outcome:primary: 3 箇所 (quote="p = 0.54")
- thermocov_text_only f05_randomization_method study: 2 箇所 (quote="Patients were randomized in a 1:1 ratio through a centralize")
- thermocov_text_only f09_arm_label arm:1: 2 箇所 (quote="thermotherapy n = 54")
- thermocov_text_only f09_arm_label arm:2: 2 箇所 (quote="control n = 51")
- thermocov_text_only f12_primary_outcome_result_arm outcome:primary|arm:2: 2 箇所 (quote="31.4% (16/51) of patients in the control group")
- thermocov_text_only f13_ae_any_arm outcome:primary|arm:2: 2 箇所 (quote="Seven (13.7%) patients in the control group")
- thermocov_text_only f15_primary_outcome_p_value outcome:primary: 3 箇所 (quote="p = 0.54")

## quote なし（not_reported 等）: 2 行
- udca_pdf_native f14_primary_outcome_effect_estimate outcome:primary (not_reported=true, value=null)
- udca_text_only f14_primary_outcome_effect_estimate outcome:primary (not_reported=true, value=null)

## モード間の値比較（pdf_native vs text_only）
値完全一致: 30 / 40
- udca|f06_blinding|study: pdf_native="Parents/guardians were blinded" / text_only="single-blinded (parents/guardians were blinded)"
- udca|f09_arm_label|arm:1: pdf_native="intervention group" / text_only="intervention"
- udca|f09_arm_label|arm:2: pdf_native="control group" / text_only="control"
- thermocov|f03_sample_size_total|study: pdf_native="144" / text_only="105"
- thermocov|f04_population|study: pdf_native="hospitalized adult patients with mild-to-moderate COVID-19" / text_only="hospitalized adult patients with symptoms of COVID-19 with ≤5 days from symptom onset, meeting criteria for mild or moderate COVID-19"
- thermocov|f06_blinding|study: pdf_native="open-label; participants and medical staff were not blinded; data analyst was blinded" / text_only="Participants and medical staff were not blinded; data analyst was blinded."
- thermocov|f11_intervention_description|arm:1: pdf_native="local thermotherapy via an electric heat pad (30 × 40cm) in the thorax continuously for 90min, twice daily (every 12h), for 5days" / text_only="local thermotherapy via an electric heat pad (30 × 40 cm) in the thorax continuously for 90 min, twice daily (every 12 h), for 5 days."
- thermocov|f11_intervention_description|arm:2: pdf_native="standard in-hospital care" / text_only="standard in-hospital care according to national guidelines"
- thermocov|f12_primary_outcome_result_arm|outcome:primary|arm:1: pdf_native="25.9% (14/54)" / text_only="14/54 (25.9%)"
- thermocov|f12_primary_outcome_result_arm|outcome:primary|arm:2: pdf_native="31.4% (16/51)" / text_only="16/51 (31.4%)"