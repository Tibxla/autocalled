import { describe, expect, it } from 'vitest';
import { pistesSouples } from './pistes';

describe('pistesSouples', () => {
  it('laisse céder les pistes fixes et bornées, garde fractions et auto', () => {
    expect(pistesSouples('52px 230px 130px 200px minmax(0,1fr) 44px')).toBe(
      'minmax(0,52px) minmax(0,230px) minmax(0,130px) minmax(0,200px) minmax(0,1fr) minmax(0,44px)',
    );
    expect(pistesSouples('minmax(10rem,14rem) minmax(0,1fr) 7rem auto 1.5fr')).toBe('minmax(0,14rem) minmax(0,1fr) minmax(0,7rem) auto 1.5fr');
    expect(pistesSouples('2.5rem minmax(9rem,16rem) 10rem')).toBe('minmax(0,2.5rem) minmax(0,16rem) minmax(0,10rem)');
  });
});
