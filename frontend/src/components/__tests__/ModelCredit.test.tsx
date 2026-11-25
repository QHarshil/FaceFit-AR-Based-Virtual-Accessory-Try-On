import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '../../test/fixtures';
import type { Product } from '../../types';
import ModelCredit, { licenseLabel } from '../ModelCredit';

const { attribution } = PRODUCTS[0] as Product;

describe('ModelCredit', () => {
  it('links the title, the author and the license', () => {
    render(<ModelCredit attribution={attribution} />);

    expect(screen.getByRole('link', { name: 'Glasses' })).toHaveAttribute(
      'href',
      attribution.sourceUrl,
    );
    expect(screen.getByRole('link', { name: 'AlbertVictory' })).toHaveAttribute(
      'href',
      attribution.authorUrl,
    );
    const license = screen.getByRole('link', { name: 'CC BY 4.0' });
    expect(license).toHaveAttribute('href', attribution.licenseUrl);
    expect(license).toHaveAttribute('rel', 'license noreferrer');
    expect(screen.getByText(/^Model:/)).toHaveTextContent(
      'Model: Glasses by AlbertVictory, CC BY 4.0',
    );
  });

  it.each([
    ['CC-BY-4.0', 'CC BY 4.0'],
    ['CC-BY-SA-4.0', 'CC BY SA 4.0'],
    ['CC0-1.0', 'CC0-1.0'],
    ['MIT', 'MIT'],
  ])('labels %s as %s', (license, label) => {
    expect(licenseLabel(license)).toBe(label);
  });
});
