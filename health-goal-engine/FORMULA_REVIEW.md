# BODY 150 — decisions and independent review (2026-10-09)

User clarification: preserve the submitted formulas exactly; no existing body-fat reference or definition of muscle_mass_kg is available. This is an experimental engine only, without UI, database, actual personal measurements or prize awards.

## Independent formula checks
- BUILD weight55 / BMI18 => gain7%, weight58.85, BMI19.26; muscle40 at age25 =>41.6.
- CUT weight80 / BMI27 / fat30 with SYNTHETIC test upper25 => loss7.5%, weight74.
- BMI18.499999 weight55 =>58.3000011 versus BMI18.5 =>55 if composition healthy: ~3.3kg jump.
- BMI24.999999 weight80/highfat =>80 versus BMI25/highfat =>76 at minimum5%: ~4kg jump.
- BUILD muscle40 at39 =>41.6, at40=>41.2, at65=>40.8. Original age-bin discontinuities retained.

## Unresolved policy and fairness findings
1. Four output fields must always exist, but cannot be numerically calculated without required measurements/reference. Blocked output has four explicit null fields, never invented targets.
2. The submitted example lacks sex/bodyfat; it demonstrates weight/BMI/muscle arithmetic but cannot be a complete personal plan.
3. RECOMP versus MAINTAIN_PLUS has no supplied muscle-normality threshold. Absolute muscle kg cannot establish high/low muscle across heights, sexes or incompatible BIA definitions. Classification heuristic is explicit and provisional.
4. BMI may remain <18.5 or >25 at day150 under capped percentage changes; bodyfat may remain beyond the supplied reference. Move toward is not identical to reach zone; changing targets to zone boundaries would violate original formulas.
5. The assertion that fat targets cannot exceed reference conflicts with examples of gradual improvement (35->31.5 may still exceed upperreference). Test DIRECTION and bounded adjustment rather than force destination inside zone.
6. BODY FAT measured via BIA and muscle mass do not determine all body mass. Require muscle <= computed lean mass, but do not equate lean mass with muscle. Flags cannot be resolved by silently rewriting targets.
7. Maintenance zones mean baseline can already earn full weight/BMI/fat components. In MAINTAIN_PLUS this may be60 points before muscle growth; older CUT musclemaintenance can earn40 baseline. This is an intended preservation incentive yet not evidence of equal attainable difficulty across cohorts.
8. Weight15% and BMI10% still count the same weight change twice, combined25%; preserves requested weights but does not remove correlation.
9. Overshoot caps at100 only removes extra points. It does not prove safety; flag overshoot and require clinical policy before live reward use. Extreme movements/implausible measurements may require review, not inferred diagnosis.
10. At-start muscle growth differs per mode/age. Engine tests arithmetic consistency; actual 150day feasibility requires prospective measurements and subgroup analysis.
11. Continuous maintenance taper, minimum valid final days, anomaly review protocol and severe-risk review are provisional policies absent from supplied formulas. Must be explicit, versioned and configurable, not presented as supplied or clinically validated rules.
12. Small target changes near reference boundaries can be smaller than measurement uncertainty, producing unstable percentage progress even with correctly capped scores. Report this rather than claim unfairness solved.

## References and limits
- [WHO BMI-for-age](https://www.who.int/tools/growth-reference-data-for-5to19-years/indicators/bmi-for-age) defines sex/age growth z-score interpretation; adult BMI cannot be silently used for the youth branch. The game chooses age<20 blocked pending a youth policy.
- [Gallagher et al. 2000](https://pubmed.ncbi.nlm.nih.gov/10966886/) developed provisional body-fat ranges based on BMI with 1626 adults, BMI<=35. It does not validate this game's fixed150day formulas or supply a universally accepted threshold for every player. No table was copied into live configuration.
- [NIDDK older adult guidance](https://www.niddk.nih.gov/health-information/weight-management/healthy-eating-physical-activity-for-life/health-tips-older-adults) notes older adult healthy weight can differ and emphasizes individual assessment. Keeping the requested18.5/25 rules in code does not establish clinical appropriateness for65+; those require review.

References support design limitations, not the custom gain/loss/muscle percentages. No clinical fairness or safety claim is made.

