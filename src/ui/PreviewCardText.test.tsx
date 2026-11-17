import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { provisionalCards } from '@/data/provisionalCards';
import { required } from '@/utils/required';
import { PreviewCardText } from './PreviewCardText';

describe('readable preview transcriptions', () => {
  it('keeps partial and unknown text visibly distinct from reviewed readings', () => {
    const base = required(provisionalCards[0]);
    const unknown = { ...base, guardian: { ...base.guardian, rulesText: '' },
      provisional: { source: 'trailer', uncertainFields: ['name', 'rulesText'], notes: [] } };
    const html = renderToStaticMarkup(<PreviewCardText card={unknown} />);
    expect(html).toContain('Title unconfirmed.');
    expect(html).toContain('Ability text has not been confirmed');
    expect(html).toContain('Partial or unconfirmed transcription');
    const confirmed = { ...base, guardian: { ...base.guardian, rulesText: 'Reviewed ability.' },
      provisional: { source: 'trailer', uncertainFields: [], notes: [] } };
    expect(renderToStaticMarkup(<PreviewCardText card={confirmed} />)).toContain('Reviewed ability.');
  });
  it('does not add a trailer reading panel to released artwork', () => {
    expect(renderToStaticMarkup(<PreviewCardText card={{ ...required(provisionalCards[0]), provisional: undefined }} />)).toBe('');
  });
});
