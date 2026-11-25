import type { Attribution } from '../types';

/** "CC-BY-4.0" reads as "CC BY 4.0"; other identifiers show as given. */
export const licenseLabel = (license: string): string => {
  const creativeCommons = /^CC-([A-Z-]+)-(\d+\.\d+)$/.exec(license);
  if (!creativeCommons) return license;
  const [, terms = '', version = ''] = creativeCommons;
  return `CC ${terms.replace(/-/g, ' ')} ${version}`;
};

interface ModelCreditProps {
  attribution: Attribution;
  className?: string;
}

/** CC BY credit for a 3D model: title, author and license, each linked to its source. */
function ModelCredit({ attribution, className }: ModelCreditProps) {
  const { title, sourceUrl, author, authorUrl, license, licenseUrl } = attribution;
  return (
    <p className={className ? `model-credit ${className}` : 'model-credit'}>
      Model:{' '}
      <a href={sourceUrl} rel="noreferrer">
        {title}
      </a>{' '}
      by{' '}
      <a href={authorUrl} rel="noreferrer">
        {author}
      </a>
      ,{' '}
      <a href={licenseUrl} rel="license noreferrer">
        {licenseLabel(license)}
      </a>
    </p>
  );
}

export default ModelCredit;
