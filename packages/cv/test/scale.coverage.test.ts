import { describe, expect, it } from 'vitest';
import { conversionCoverage, noiseOnlyCoverage, populationCoverage } from './scaleExperiments.ts';

describe('interval coverage over synthetic subjects', () => {
  /*
   * Every subject draws its iris diameter from N(11.7, 0.5), the population
   * the interval assumes, plus the other unknowns the interval models: the
   * camera's focal length off the assumed one by a factor exp(N(0, 0.15)),
   * the iris plane 3 mm (SD) off the assumed offset, and the rotation-centre
   * lever from N(10.5, 1.5). 20 frames each.
   * A nominal 95% interval covers the truth in 95% of subjects; over 1,000
   * subjects that rate has SD 0.7%, so it should fall in [0.93, 0.97]. Face
   * width's focal term is linearized and the population term dominates
   * every interval, so all three share the bound.
   */
  it('covers PD and face width at about 95% when the iris size follows the population', () => {
    const result = populationCoverage(1000, 7001);
    for (const rate of [result.near, result.distance, result.width]) {
      expect(rate).toBeGreaterThan(0.93);
      expect(rate).toBeLessThan(0.97);
    }
  });

  /*
   * The population term, 4.3%, swamps the distance-PD conversion SD, about
   * 0.5%, so the test above passes with or without it. With every iris
   * 11.7 mm and the population term off, the conversion carries weight: the
   * lever and fixation distance are drawn from the spreads the interval
   * states (see conversionCoverage). The noise term from 30 frames covers
   * about 94% on its own (as below) and the conversion is first order in a
   * lognormal distance, so over 600 subjects (SD 0.9%) the rate should fall
   * in [0.91, 0.97]. Without the conversion SD the interval holds only the
   * noise term, which is smaller than the conversion error, and coverage
   * must fall below 0.8.
   */
  it('covers distance PD at about 95% only with the conversion SD', () => {
    const withSd = conversionCoverage(600, 7010);
    expect(withSd.distance).toBeGreaterThan(0.91);
    expect(withSd.distance).toBeLessThan(0.97);
    const withoutSd = conversionCoverage(600, 7010, (frame) => ({ ...frame, distancePdCorrectionSdMm: 0 }));
    expect(withoutSd.distance).toBeLessThan(0.8);
  });

  /*
   * With every iris exactly 11.7 mm and the population term switched off,
   * only the noise term is left: the standard error of the median from 30
   * frames at 1 px and 700 to 850 mm. A z of 1.96 with an SD estimated from
   * 30 frames covers about 94% (Student t with 29 degrees of freedom), and
   * a positive sample autocorrelation of independent frames widens a few
   * intervals. Over 600 subjects the SD of the rate is 0.9%: [0.91, 0.985].
   */
  it('covers PD at about 95% from the noise term alone', () => {
    const result = noiseOnlyCoverage(600, 7002);
    expect(result.near).toBeGreaterThan(0.91);
    expect(result.near).toBeLessThan(0.985);
  });
});
