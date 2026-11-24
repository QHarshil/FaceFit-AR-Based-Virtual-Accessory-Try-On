import { describe, expect, it } from 'vitest';
import { noiseOnlyCoverage, populationCoverage } from './scaleExperiments.ts';

describe('interval coverage over synthetic subjects', () => {
  /*
   * Every subject draws its iris diameter from N(11.7, 0.5), the population
   * the interval assumes, plus the other unknowns the interval models: the
   * camera's focal length off the assumed one by a factor exp(N(0, 0.15)),
   * and the iris plane 3 mm (SD) off the assumed offset. 20 frames each.
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
