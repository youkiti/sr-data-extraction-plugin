---
scene: "06"
slug: schema
---

## cue 01
Schema design is where you build the list of fields to extract — the header row of your
coding sheet. AI drafts it from the protocol and sample papers, and you review it in this
table editor.

## cue 02
Fields with entity_level "study" hold a single value for the whole trial: country, design,
enrollment period, follow-up duration, funding source, and so on.

## cue 03
Also at the study level are population fields, such as total sample size, mean age, and
percentage female.

## cue 04
Fields with entity_level "arm" hold one value per group: arm name, arm N, and intervention
— repeated once for each arm, whether the trial has two or three.

## cue 05
Fields with entity_level "outcome_result" hold one value per outcome: outcome name,
timepoint, event counts, mean and SD, and effect size.

## cue 06
There's no cap on the number of fields — 10 to 40 is just how many AI proposes at once.
Risk-of-bias templates like RoB 2 or ROBINS-I can also be pre-loaded.

## cue 07
You can browse past versions, and after revising the protocol, ask AI to re-draft and
review the diff as added, changed, or removal candidates.
