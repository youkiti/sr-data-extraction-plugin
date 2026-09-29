# 図と数値の公開ベンチマーク探索（issue #265 段階 1）

- **実施日**: 2026-09-29
- **探索**: codex CLI（GPT-6-Astra、reasoning effort high、Web 検索あり、読み取り専用 sandbox）に候補を探させた（issue #265 の指定どおり）。codex は 18 候補を挙げた
- **確認**: 候補ごとに、Claude が原文（論文・リポジトリ・ライセンス）を確かめてから採否を決めた。確認の方法と限界は §1
- **結論**: 採否の判定には**公開ベンチを使わない**。**結果が図にしか無い RCT 15〜20 本を集め、人が WebPlotDigitizer で読んだ値を正解にする非公開ベンチ**を作る（§4）。採用基準は [PREREGISTRATION.md](PREREGISTRATION.md)

---

## 1. 確認の方法と限界

この作業環境のネットワーク制限で、arxiv.org・pmc.ncbi.nlm.nih.gov・huggingface.co・zenodo.org・github.com（ページ）・chartinfo.github.io などへの直接アクセスは拒否された。確認は次の 2 つで行った。

- **R（原本）**: `raw.githubusercontent.com` からリポジトリの README・DESCRIPTION・LICENSE を直接取得して読んだ
- **W（検索）**: Web 検索の結果に出る原文ページの記載（論文ページ・データセットページ・PubMed 等）で確かめた

どちらでも確かめられなかった事項は「**未確認**」と書き、codex の報告だけに基づく事項はそう明記した。段階 2 で候補を実際にダウンロードして使う場合は、その時点で原本のライセンス表示を読み直すこと。

## 2. 何を探したか（条件）

1. 医学論文（できれば RCT）のチャート画像と、その**数値の正解**（点ごとの値、群ごとの平均・ばらつき）の組
2. 再配布、または手元での利用が許されるライセンス
3. 私たちの用途（RCT の結果の図: 平均 ± SE/SD の折れ線、エラーバー付き棒グラフ、KM 曲線）に近いこと

## 3. 候補と採否

「近さ」は私たちの用途（医学 RCT の結果の図から群別の値とばらつきを読む）への近さ（5 = 最も近い）。「確認」は §1 の R / W。

### 3.1 医学・生物医学・SR 方法論の候補

| # | 名称 | URL | ライセンス（利用の可否） | 図の出どころ・規模 | 正解の粒度 | 近さ | 確認 | 採否と理由 |
|---|---|---|---|---|---|---|---|---|
| 1 | **CHART-Infographics UB-PMC**（ICPR 2020 版。ICDAR 2019〜2023 の競技用） | [TC-11 データセット](https://tc11.cvc.uab.es/datasets/ICPR2020-CHART-Info_1)、[競技ページ](https://chartinfo.github.io/index_2020.html)、[論文（NSF PAR）](https://par.nsf.gov/biblio/10292332) | **CC BY-NC-SA 3.0**（TC-11 の記載）。非商用・継承条件つきで手元での評価には使える。元の論文の図は PMC OA 由来（論文ごとのライセンスは未確認） | PubMed Central OA の論文の図。学習 15,636 枚 + テスト 7,287 枚（全タスク合計）。データ抽出の正解が付いているのはその一部 | データ系列ごとの (x, y) 点列（Task 6b）。**エラーバーの端・SD/SE/CI の意味の注記は無い**（codex も未確認） | 3 | W | **不採用（判定用）/ 開発中の参考にだけ使ってよい**。医学論文の図だが RCT の結果の図に限らず（基礎研究の図が多い）、ばらつきの意味の正解が無い。ライセンスが非商用・継承（CC BY-NC-SA 3.0）で、条件を守れば再配布はできるが、MIT のこのリポジトリに混ぜると条件の管理が要るので取り込まない |
| 2 | **KMDATA**（Fell, Redd ら 2021, *Database*） | [論文](https://academic.oup.com/database/article/doi/10.1093/database/baab037/6309184)、[リポジトリ](https://github.com/raredd/kmdata) | パッケージは **MIT + file LICENSE**（DESCRIPTION を R で確認）。元の論文（NEJM・Lancet 等の腫瘍 RCT）の**図の画像そのものは同梱されていない**と判断（README は「digitized KM curves」と再構成 IPD のみを説明。codex の「図を同梱」という報告は原本で確認できなかった）。画像は各誌の著作権のもとにある | 乳・肺・前立腺・大腸がんの第 III 相 RCT 153 本、KM 曲線 304 組（2014〜2016 年出版） | DigitizeIt で人が読んだ KM 曲線の座標と、Guyot 法で再構成した IPD（**元の IPD ではない**）。平均・ばらつきは無い | 4 | R・W | **不採用（判定用）/ KM 曲線の参考にだけ使える**。KM 曲線に限られ、図の画像を自分で論文から取る必要がある。正解も人の読み取り（私たちの非公開ベンチと同じ性質）で、公開ベンチを使う利点が薄い |
| 3 | **IPDfromKM**（Liu ら 2021, *BMC Med Res Methodol*） | [論文](https://link.springer.com/article/10.1186/s12874-021-01308-8)、[CRAN](https://cran.r-project.org/web/packages/IPDfromKM/IPDfromKM.pdf) | パッケージは GPL-2（codex の報告。CRAN の記載は未確認） | 同梱の例は頭頸部がんの RCT 1 本（2 群）の KM 曲線 | 人が読んだ座標と number at risk | 2 | W（論文・CRAN の存在のみ） | **不採用**。例が 1 本だけでベンチにならない |
| 4 | **Graph2Data の評価**（Cramond ら 2019, *Wellcome Open Research*） | [データ（Zenodo 1482487）](https://zenodo.org/records/1482487)、[ツール（Zenodo 1484506）](https://zenodo.org/records/1484506) | Zenodo のデータは CC BY 4.0（codex の報告。Claude は未確認） | **合成**の図 23 枚（棒・折れ線・散布・ドット・箱ひげ。前臨床・公衆衛生の図を真似て作成） | 作図に使った架空の値（点ごと） | 3 | W（Zenodo の 2 レコードの存在と内容の説明） | **不採用（判定用）/ 開発中の点の誤差の目安に使える**。合成の図で、実際の論文の図のくせ（重なった点、小さい文字、凡例の位置）が無い。23 枚と少ない |
| 5 | **SurvdigitizeR**（2024, *BMC Med Res Methodol*） | [論文（PMC11245803）](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11245803/)、[リポジトリ](https://github.com/Pechli-Lab/SurvdigitizeR) | コードは MIT（DESCRIPTION を R で確認）。検証用の 60 枚の画像と正解が公開されているかは**未確認** | 主に**シミュレーション**の KM 曲線（codex の報告: 60 枚・120 本） | 真の生存確率（時点ごと） | 2 | R・W | **不採用**。検証データの公開が確認できず、合成で KM 曲線のみ |
| 6 | **KM-GPT**（2025） | [論文（PMC12458341）](https://pmc.ncbi.nlm.nih.gov/articles/PMC12458341/)、[arXiv 2509.18141](https://arxiv.org/abs/2509.18141) | データのライセンスは**未確認** | 合成の KM 曲線（codex の報告: 540 枚）+ 実際の試験の図（数本） | 合成は真の IPD、実試験は過去の人の読み取り | 3 | W（論文の存在と内容） | **不採用**。データの一括公開が確認できない。KM 曲線のみ |
| 7 | **EpiCurveBench**（Berkane ら 2025→2026） | [arXiv 2605.27195](https://arxiv.org/abs/2605.27195)、[medRxiv 版（PMC12687812）](https://pmc.ncbi.nlm.nih.gov/articles/PMC12687812/)、[データ（Hugging Face）](https://huggingface.co/datasets/tberkane/EpiCurveBench)、[コード](https://github.com/tberkane/EpiCurveBench) | 論文は「openly licensed」の画像と記載（W）。データセットのライセンス表示（codex の報告では Apache-2.0）は**未確認**（コードのリポジトリの `main` ブランチ直下に LICENSE ファイルは見つからなかった = R） | CDC・WHO・各国の報告書などの**流行曲線** 1,000 枚（14 疾患・37 か国） | 900 枚は元の表の数値、100 枚は **WebPlotDigitizer で人が読んだ値**。時系列の点ごと | 3 | R・W | **不採用（判定用）/ 開発中の点の誤差の目安に最も向く**。医学の図で、正解が点ごとにあり、人の読み取りの部分集合もある。ただし流行曲線（密な棒・折れ線）で、RCT の群比較・エラーバーとは形が違う |
| 8 | **KMGen**（Jiang ら 2026, PMLR 340） | [arXiv 2608.22618](https://arxiv.org/abs/2608.22618)、[コード](https://github.com/chufangao/kmgen) | コードは MIT（LICENSE を R で確認）。ベンチの画像と正解のライセンス・公開は**未確認**（README は 1 行のみ） | 合成の KM 曲線 32 枚 + 腫瘍 RCT 3 本 | 合成は描画に使った階段関数、実試験はスポンサー提供の IPD | 3 | R・W | **不採用**。ベンチの公開を確認できず、KM 曲線のみ |
| 9 | **Jelicic Kadic ら 2016**（*J Clin Epidemiol*） | [PubMed 26780258](https://pubmed.ncbi.nlm.nih.gov/26780258/) | データの公開は**未確認** | 2009〜2014 年の RCT の図 | 正確度の基準は、RCT の著者に問い合わせて得た**作図に使った元の数値**。評価したのは 2 人が手作業と Plot Digitizer で独立に読んだ値（2 人の一致率は手作業 51%、ソフト 53.5%） | 5 | W | **不採用（データ未公開）/ gold の作り方の参考にする**。RCT の図を 2 人が独立に読む手順は、私たちの非公開ベンチの作り方（PREREGISTRATION.md §2.1）と同じ発想 |
| 10 | **Drevon ら 2017**（*Behavior Modification*） | [論文](https://journals.sagepub.com/doi/10.1177/0145445516673998) | データの公開は**未確認** | 単一事例研究（心理・教育）の図 36 枚、18 研究、3,596 点 | 2 人が WebPlotDigitizer で読んだ値 | 2 | W | **不採用**。医学 RCT ではなく、データも未公開。WebPlotDigitizer の人同士の一致を示した先行研究として引用だけする |

### 3.2 一般のチャート読み取りベンチ

いずれも医学論文の図ではなく、RCT の図に特有の要素（エラーバーの意味、群の凡例、時点の軸）の正解を持たない。判定には使わない。

| # | 名称 | URL | ライセンス | 図の出どころ・規模 | 正解の粒度 | 近さ | 確認 | 採否と理由 |
|---|---|---|---|---|---|---|---|---|
| 11 | ChartQA（2022） | [リポジトリ](https://github.com/vis-nlp/ChartQA)、[データ](https://huggingface.co/datasets/ahmed-masry/ChartQA) | **GPL-3.0**（LICENSE を R で確認。Hugging Face の表示も GPL-3.0 = W） | Statista・Pew・OWID・OECD の Web の図 約 2 万枚（棒・折れ線・円） | 元の表（CSV）。ばらつきの欄は無い | 2 | R・W | 不採用。医学の図ではない |
| 12 | PlotQA（2020） | [リポジトリ](https://github.com/NiteshMethani/PlotQA) | データセットは **CC BY 4.0**、モデルとコードは MIT（README の LICENSE 節を R で確認） | 実データから描いた**合成**の図 約 22 万枚（棒・折れ線・点線） | 系列ごとの x/y 数値 | 2 | R | 不採用。合成で、ばらつきの正解が無い |
| 13 | DVQA（2018） | [リポジトリ](https://github.com/kushalkafle/DVQA_dataset) | **CC BY-NC 4.0**（LICENCE を R で確認） | 合成の棒グラフ 30 万枚 | 元の表 | 1 | R | 不採用。合成の棒グラフのみ |
| 14 | FigureQA（2017） | [論文](https://arxiv.org/abs/1710.07300) | 未確認 | 合成の図 10 万枚超 | 作図の元データ（QA の答えは yes/no） | 1 | codex の報告のみ | 不採用。合成で、用途から遠い |
| 15 | ChartX（2024） | [リポジトリ](https://github.com/InternScience/ChartVLM)、[データ](https://huggingface.co/datasets/InternScience/ChartX) | リポジトリは **CC BY 4.0**（LICENSE を R で確認）。Hugging Face の表示（codex の報告では Apache-2.0）は未確認 | 生成した図 6,000 枚、18 種（箱ひげ図を含む。題材に医療を含む） | CSV の元データ | 2 | R | 不採用。生成した図で、医学論文ではない |
| 16 | ChartBench（2023/2024） | [論文](https://arxiv.org/abs/2312.15915)、[リポジトリ](https://github.com/DataArcTech/ChartBench) | 未確認（codex もリポジトリの MIT バッジを根拠にしなかった） | 約 6.6 万枚、エラーバー付き折れ線を含む | QA。エラーバーの数値の正解は未確認 | 2 | codex の報告のみ | 不採用。ライセンスと正解の粒度が確認できない |
| 17 | CharXiv（2024） | [論文](https://arxiv.org/abs/2406.18521) | 質問は CC BY-SA 4.0、図の著作権は元の著者（codex の報告） | arXiv の図 約 2,300 枚 | 記述・推論の QA。点ごとの数値は無い | 1 | codex の報告のみ | 不採用。数値の正解が無い |
| 18 | ExcelChart400K（ChartOCR, 2021） | [論文](https://www.microsoft.com/en-us/research/uploads/prod/2020/12/WACV_2021_ChartOCR.pdf) | 未確認（codex の報告ではデータ MIT・コード BSD-3） | Web 上の Excel の図 約 39 万枚 | 図の要素の位置と数値 | 1 | codex の報告のみ | 不採用。医学の図ではない |

### 3.3 候補に入れなかったもの（codex の補足から）

- **DePlot / MatCha**: モデルと評価の手法で、独立したデータセットではない（ChartQA・PlotQA を使っている）
- **Guyot ら 2012**: KM 曲線からの IPD 再構成の元論文。6 組の検証は報告値との比較で、図と正解の組の公開は確認できない
- **CochraneForest**（ACL 2025 / EMNLP 2025）: フォレストプロット 202 枚の注釈だが、図の画像と数値の組の公開を確認できない。フォレストプロットは SR の図で、RCT 本体の結果の図ではない
- **PlotPick**（arXiv 2605.06021、Claude が追加で確認）: VLM で図から表を起こすツールの論文。評価は ChartX と PlotQA で、医学の新しいデータセットは作っていない（W）
- **PlotExtract**（Polak & Morgan 2025、arXiv 2503.12326）: 材料科学の図が対象（W）

## 4. 結論: 非公開ベンチを作る

**公開ベンチは採否の判定に使わない。結果が図にしか無い RCT を 15〜20 本集め、人が WebPlotDigitizer で読んだ値を正解にする非公開ベンチを作る。**

理由:

1. **平均 ± ばらつきの正解を持つ公開ベンチが無い。** RCT の結果の図で一番多いのは「群ごとの平均 ± SE/SD の折れ線」と「エラーバー付き棒グラフ」だが、ばらつきの**意味**（SD か SE か 95% CI か）と端点の値を正解として持つ公開データは見つからなかった（UB-PMC も点列だけ）。ばらつきの指標の取り違えは効果量の標準誤差を大きくずらすので、ここを測れないベンチでは採否を決められない
2. **医学の実データの候補は KM 曲線か流行曲線に偏る。** KMDATA・KM-GPT・KMGen・SurvdigitizeR は KM 曲線だけ、EpiCurveBench は流行曲線だけ。UB-PMC は PMC の図だが RCT の結果の図に絞れない
3. **本番と同じ条件で測れない。** 図読み取りモードは「PDF のページ画像から図を見つけ、読み、抽出に渡し、quote を照合する」一続きの処理で、評価したいのは最後の抽出の正確度（図にしか無い項目で NR → 正解になるか）。切り出し済みの図画像のベンチでは、図の検出・抽出への受け渡し・テキスト優先の規約が測れない
4. **ライセンスの制約。** UB-PMC は CC BY-NC-SA 3.0、DVQA は CC BY-NC 4.0、ChartQA は GPL-3.0。手元での評価には使えるが、MIT のこのリポジトリに取り込むには条件の管理が要る。いずれにしても判定用には使わないので、取り込まない
5. **正解の性質は非公開ベンチと変わらない。** 医学の実データの候補の正解の多くは、人がデジタイザで読んだ値（KMDATA は DigitizeIt、EpiCurveBench の 100 枚は WebPlotDigitizer）。自分たちで 2 人独立に読んで作る gold と性質は同じで、対象を RCT の結果の図に合わせられる分、非公開ベンチの方が目的に合う

公開ベンチの使いどころ（判定には入れない）:

- 段階 2 の開発中に、`digitize-figure` の点の誤差の目安を手早く見る用途に、**EpiCurveBench**（人の読み取りの 100 枚と、元の表がある 900 枚）と **Graph2Data の合成の図**が向く。KM 曲線は **KMDATA** の座標を、論文から取った図と組み合わせて使える
- 使う場合はその時点でライセンス表示を原本で読み直し、データはリポジトリにコミットしない

## 5. 非公開ベンチの作り方（要点）

詳細は [PREREGISTRATION.md](PREREGISTRATION.md) §2.1。

- 結果が図にしか無い RCT 15〜20 本（born-digital PDF）。図の種類を散らす（平均 ± SE/SD の折れ線、エラーバー付き棒グラフ、KM 曲線、その他）
- 2 人が独立に WebPlotDigitizer で読み、平均を gold にする（Jelicic Kadic ら 2016 と同じく、2 人の独立読み取り）。人同士の差を必ず報告する
- なるべく PMC OA の CC BY 論文から選ぶ。そうしておけば、将来 PDF と gold を公開ベンチにする選択肢が残る（公開するかはオーナーの判断）
- PDF・gold・run の記録はコミットしない（`experiments/extraction-benchmark-real/` と同じ運用）
